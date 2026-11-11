// Primeira instalação: baixa o cliente completo (partes .zip listadas em
// update.json -> client.parts, publicadas por tools/release.js) e extrai na pasta do
// jogo. Cada parte vai para "<nome>.download", com retomada (HTTP Range) e conferência
// de tamanho e MD5 antes de extrair.
use crate::updater::{self, http, md5_file};
use crate::{config, sys};
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;

// Tentativas por parte; cada nova tentativa continua de onde parou
const MAX_ATTEMPTS: u32 = 5;
// Sem receber dados por este tempo, a conexão é refeita
const IDLE_TIMEOUT: Duration = Duration::from_secs(60);
// Intervalo mínimo entre eventos de progresso enviados à janela
const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);
// Peso do download no progresso geral (o resto é a extração)
const DOWNLOAD_WEIGHT: f64 = 0.8;

// Erro com código para a janela mostrar o texto traduzido
pub struct InstallError {
    pub message: String,
    pub code: Option<&'static str>,
    pub params: Option<Value>,
}

impl From<String> for InstallError {
    fn from(message: String) -> Self {
        InstallError { message, code: None, params: None }
    }
}

struct Part {
    name: String,
    url: String,
    size: u64,
    hash: String,
}

pub fn game_exists(game_dir: &Path) -> bool {
    game_dir.join(config::GAME_EXECUTABLE).exists()
}

fn check_free_space(game_dir: &Path, client: &Value, parts: &[Part]) -> Result<(), InstallError> {
    let largest = parts.iter().map(|p| p.size).max().unwrap_or(0);
    let total: u64 = parts.iter().map(|p| p.size).sum();
    let installed = client.get("installedSize").and_then(Value::as_u64).filter(|&n| n > 0).unwrap_or(total);
    let needed = installed + largest;
    if let Some(free) = sys::free_disk_space(game_dir) {
        if free < needed {
            let size = format!("{:.1}", needed as f64 / 1024f64.powi(3));
            return Err(InstallError {
                message: format!("Not enough disk space ({size} GB needed)"),
                code: Some("NO_SPACE"),
                params: Some(json!({ "size": size })),
            });
        }
    }
    Ok(())
}

// Grava a URL em file_path a partir do byte "start" (anexa ao arquivo)
async fn fetch_to_file(url: &str, file_path: &Path, start: u64, on_bytes: &mut (dyn FnMut(u64) + Send)) -> Result<(), String> {
    let mut request = http().get(url);
    if start > 0 {
        request = request.header("Range", format!("bytes={start}-"));
    }
    let response = request.send().await.map_err(|e| e.to_string())?.error_for_status().map_err(|e| e.to_string())?;

    // Servidor sem suporte a Range: recomeça do zero
    let mut downloaded = if start > 0 && response.status().as_u16() != 206 { 0 } else { start };
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(downloaded > 0)
        .truncate(downloaded == 0)
        .open(file_path)
        .await
        .map_err(|e| e.to_string())?;

    let mut stream = response.bytes_stream();
    loop {
        let chunk = tokio::time::timeout(IDLE_TIMEOUT, stream.next())
            .await
            .map_err(|_| "Download stalled".to_string())?;
        let Some(chunk) = chunk else { break };
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        on_bytes(downloaded);
    }
    file.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}

// Baixa (ou continua) uma parte até ela bater com o tamanho e o MD5 do manifesto
async fn download_part(part: &Part, file_path: &Path, on_bytes: &mut (dyn FnMut(u64) + Send)) -> Result<(), String> {
    let mut attempt = 1;
    loop {
        let mut start = tokio::fs::metadata(file_path).await.map(|m| m.len()).unwrap_or(0);
        if start > part.size {
            let _ = tokio::fs::remove_file(file_path).await;
            start = 0;
        }
        on_bytes(start);

        if start < part.size {
            if let Err(error) = fetch_to_file(&part.url, file_path, start, on_bytes).await {
                crate::logger::log_event("warning", format!("[DataManager] {}: attempt {attempt} failed: {error}", part.name));
                if attempt >= MAX_ATTEMPTS {
                    return Err(error);
                }
                tokio::time::sleep(Duration::from_secs(attempt as u64 * 3)).await;
                attempt += 1;
                continue;
            }
        }

        let size = tokio::fs::metadata(file_path).await.map(|m| m.len()).unwrap_or(0);
        if size == part.size {
            let path = file_path.to_path_buf();
            let hash = tokio::task::spawn_blocking(move || md5_file(&path)).await.map_err(|e| e.to_string())?;
            if hash.ok().as_deref() == Some(part.hash.as_str()) {
                return Ok(());
            }
        }

        crate::logger::log_event("warning", format!("[DataManager] {}: size or MD5 mismatch, downloading again", part.name));
        let _ = tokio::fs::remove_file(file_path).await;
        if attempt >= MAX_ATTEMPTS {
            return Err(format!("Downloaded file is corrupted: {}", part.name));
        }
        attempt += 1;
    }
}

fn extract_zip(zip_path: &Path, game_dir: &Path, on_progress: &mut dyn FnMut(usize, usize, &str)) -> Result<(), String> {
    let zip_name = zip_path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let file = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(std::io::BufReader::new(file)).map_err(|e| e.to_string())?;
    let total = archive.len();
    for index in 0..total {
        let mut entry = archive.by_index(index).map_err(|e| e.to_string())?;
        // Nomes em UTF-8, como o tar.exe do Windows grava (tools/release.js)
        let name = String::from_utf8_lossy(entry.name_raw()).to_string();
        let dest = updater::resolve_game_path(game_dir, &name).ok_or_else(|| format!("Invalid path in {zip_name}: {name}"))?;
        if entry.is_dir() {
            std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
        } else {
            if let Some(dir) = dest.parent() {
                std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            }
            let mut out = std::fs::File::create(&dest).map_err(|e| format!("{name}: {e}"))?;
            std::io::copy(&mut entry, &mut out).map_err(|e| format!("{name}: {e}"))?;
        }
        on_progress(index + 1, total, &name);
    }
    Ok(())
}

async fn install(game_dir: PathBuf, send: &(dyn Fn(Value) + Send + Sync)) -> Result<(), InstallError> {
    if game_exists(&game_dir) {
        send(json!({ "type": "data-exists", "message": "Game data already installed!" }));
        return Ok(());
    }

    let manifest = updater::fetch_manifest().await?;
    let client = manifest.client.unwrap_or(Value::Null);
    let mut parts = Vec::new();
    for entry in client.get("parts").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]) {
        // URL relativa ao update.json (ex.: ../client-2026.10.22/AsgardMU-Client.part1.zip)
        parts.push(Part {
            name: entry.get("name").and_then(Value::as_str).unwrap_or("client.zip").to_string(),
            url: updater::resolve_url(entry.get("url").and_then(Value::as_str).unwrap_or(""))?,
            size: entry.get("size").and_then(Value::as_u64).unwrap_or(0),
            hash: entry.get("hash").and_then(Value::as_str).unwrap_or("").to_string(),
        });
    }
    if parts.is_empty() {
        return Err(InstallError {
            message: "The game client is not published yet".to_string(),
            code: Some("NO_CLIENT"),
            params: None,
        });
    }

    tokio::fs::create_dir_all(&game_dir).await.map_err(|e| e.to_string())?;
    check_free_space(&game_dir, &client, &parts)?;

    let total_bytes: u64 = parts.iter().map(|p| p.size).sum::<u64>().max(1);
    let mut done_bytes = 0u64; // partes já baixadas e extraídas

    send(json!({ "type": "download-start", "message": "Starting game data download...", "progress": 0, "overall": 0 }));

    for part in &parts {
        let zip_path = game_dir.join(format!("{}.download", part.name));
        crate::logger::log_event("info", format!("[DataManager] {}", part.url));

        let mut last_sent: Option<Instant> = None;
        let mut speed_bytes = 0u64;
        let mut speed_time = Instant::now();
        let mut speed = 0f64;
        let mut on_bytes = |bytes: u64| {
            let now = Instant::now();
            if last_sent.map(|t| now - t < PROGRESS_INTERVAL).unwrap_or(false) && bytes < part.size {
                return;
            }
            let elapsed = (now - speed_time).as_secs_f64();
            if elapsed >= 1.0 {
                speed = bytes.saturating_sub(speed_bytes) as f64 / 1024.0 / 1024.0 / elapsed;
                speed_bytes = bytes;
                speed_time = now;
            }
            last_sent = Some(now);
            let downloaded = done_bytes + bytes;
            send(json!({
                "type": "download-progress",
                "message": "Downloading game data...",
                "progress": (downloaded as f64 / total_bytes as f64 * 100.0).floor(),
                "overall": (done_bytes as f64 + bytes as f64 * DOWNLOAD_WEIGHT) / total_bytes as f64 * 100.0,
                "downloaded": downloaded,
                "total": total_bytes,
                "speed": speed
            }));
        };
        download_part(part, &zip_path, &mut on_bytes).await?;

        send(json!({
            "type": "extract-start",
            "message": "Starting data extraction...",
            "progress": 0,
            "overall": (done_bytes as f64 + part.size as f64 * DOWNLOAD_WEIGHT) / total_bytes as f64 * 100.0
        }));

        // A extração roda fora do executor; o progresso volta por um canal
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Value>();
        let part_size = part.size as f64;
        let base = done_bytes as f64;
        let zip = zip_path.clone();
        let dir = game_dir.clone();
        let task = tokio::task::spawn_blocking(move || {
            let mut last: Option<Instant> = None;
            extract_zip(&zip, &dir, &mut |current, total, name| {
                let now = Instant::now();
                if last.map(|t| now - t < PROGRESS_INTERVAL).unwrap_or(false) && current < total {
                    return;
                }
                last = Some(now);
                let ratio = current as f64 / total.max(1) as f64;
                let extracted = part_size * (DOWNLOAD_WEIGHT + (1.0 - DOWNLOAD_WEIGHT) * ratio);
                let _ = tx.send(json!({
                    "type": "extract-progress",
                    "message": "Extracting files...",
                    "progress": (ratio * 100.0).floor(),
                    "overall": (base + extracted) / total_bytes as f64 * 100.0,
                    "current": current,
                    "total": total,
                    "currentFile": name
                }));
            })
        });
        while let Some(event) = rx.recv().await {
            send(event);
        }
        task.await.map_err(|e| e.to_string())??;

        let _ = tokio::fs::remove_file(&zip_path).await;
        done_bytes += part.size;
    }

    if !game_exists(&game_dir) {
        return Err(format!("Final verification failed - {} not found", config::GAME_EXECUTABLE).into());
    }
    send(json!({ "type": "installation-complete", "message": "Game data installed successfully!", "overall": 100 }));
    Ok(())
}

pub async fn ensure_data_folder(game_dir: PathBuf, send: impl Fn(Value) + Send + Sync) -> Result<(), InstallError> {
    let result = install(game_dir, &send).await;
    if let Err(error) = &result {
        send(json!({
            "type": "installation-error",
            "message": format!("Installation error: {}", error.message),
            "error": error.message,
            "code": error.code,
            "params": error.params
        }));
    }
    result
}

// Informações da pasta Data (IPC check-data-folder / get-data-folder-info)
pub fn data_folder_info(game_dir: &Path) -> Value {
    fn count(dir: &Path) -> u64 {
        std::fs::read_dir(dir)
            .map(|entries| {
                entries
                    .flatten()
                    .map(|entry| if entry.path().is_dir() { count(&entry.path()) } else { 1 })
                    .sum()
            })
            .unwrap_or(0)
    }
    let data = game_dir.join("Data");
    if !data.is_dir() {
        return json!({ "exists": false, "size": 0, "files": 0 });
    }
    json!({ "exists": true, "size": 0, "files": count(&data), "path": data.to_string_lossy() })
}
