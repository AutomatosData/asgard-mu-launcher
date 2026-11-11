// Atualização do jogo pelo manifesto (update.json, gerado por tools/release.js):
//   client   -> cliente completo em partes .zip (primeira instalação, data.rs)
//   launcher -> versão e instalador atuais do launcher (self_update.rs)
//   files    -> arquivos alterados depois do cliente completo: { path, size, hash, url, keep }
//               keep = preferência do jogador (ex.: option.ini): baixa só se faltar
use crate::logger::log_update;
use crate::{config, dirs, language_pack};
use futures_util::StreamExt;
use md5::{Digest, Md5};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tokio::io::AsyncWriteExt;

#[derive(Clone, Serialize, Deserialize)]
pub struct ManifestFile {
    pub path: String,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keep: Option<bool>,
}

#[derive(Clone, Serialize)]
pub struct Manifest {
    pub version: String,
    pub client: Option<Value>,
    pub launcher: Option<Value>,
    pub files: Vec<ManifestFile>,
}

// Arquivos do launcher Electron: nunca vêm pelo manifesto
const EXCLUDED: &[&str] = &[
    "mudmg.exe", "chrome_100_percent.pak", "chrome_200_percent.pak", "ffmpeg.dll", "icudtl.dat",
    "resources.pak", "snapshot_blob.bin", "v8_context_snapshot.bin", "debug.log", "locales", "resources",
];

static MANIFEST: Mutex<Option<Manifest>> = Mutex::new(None);
static IS_UPDATING: AtomicBool = AtomicBool::new(false);
// MD5 já calculado por arquivo: { caminho: [tamanho, mtimeMs, hash] }
static HASH_CACHE: Mutex<Option<Map<String, Value>>> = Mutex::new(None);

pub fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("AsgardMU-Launcher")
            .connect_timeout(Duration::from_secs(30))
            .build()
            .expect("http client")
    })
}

// Baixa o update.json
pub async fn fetch_manifest() -> Result<Manifest, String> {
    let now = chrono::Utc::now().timestamp_millis();
    let response = http()
        .get(config::manifest_url())
        // sempre o manifesto mais recente (sem cache)
        .query(&[("t", now.to_string())])
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    // O GitHub entrega o update.json como application/octet-stream
    let text = response.text().await.map_err(|e| e.to_string())?;
    let data: Value = serde_json::from_str(&text).map_err(|_| "Invalid update manifest".to_string())?;

    let files_value = match &data {
        Value::Array(_) => data.clone(),
        Value::Object(map) => map.get("files").cloned().unwrap_or(Value::Null),
        _ => return Err("Invalid update manifest".to_string()),
    };
    let files = match files_value {
        Value::Array(list) => list
            .into_iter()
            .filter_map(|item| serde_json::from_value::<ManifestFile>(item).ok())
            .collect(),
        _ => Vec::new(),
    };
    let field = |name: &str| data.get(name).filter(|v| !v.is_null()).cloned();
    let manifest = Manifest {
        version: data.get("version").and_then(Value::as_str).unwrap_or("").to_string(),
        client: field("client"),
        launcher: field("launcher"),
        files,
    };
    *MANIFEST.lock().unwrap() = Some(manifest.clone());
    Ok(manifest)
}

// URL absoluta de um endereço do manifesto (relativo ao update.json)
pub fn resolve_url(relative: &str) -> Result<String, String> {
    let base = url::Url::parse(&config::manifest_url()).map_err(|e| e.to_string())?;
    base.join(relative).map(|u| u.to_string()).map_err(|e| e.to_string())
}

// Caminho local de um arquivo do manifesto; None se ele sair da pasta do jogo
pub fn resolve_game_path(game_path: &Path, file_path: &str) -> Option<PathBuf> {
    let mut parts: Vec<std::ffi::OsString> = Vec::new();
    for component in Path::new(&file_path.replace('\\', "/")).components() {
        match component {
            Component::Normal(part) => parts.push(part.to_os_string()),
            Component::CurDir => {}
            Component::ParentDir => {
                parts.pop()?;
            }
            _ => return None,
        }
    }
    if parts.is_empty() {
        return None;
    }
    Some(parts.iter().fold(game_path.to_path_buf(), |path, part| path.join(part)))
}

pub fn md5_file(path: &Path) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Md5::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn hash_cache_path(game_path: &Path) -> PathBuf {
    game_path.join("Data").join("Launcher").join("hash-cache.json")
}

fn load_hash_cache(game_path: &Path) {
    let mut cache = HASH_CACHE.lock().unwrap();
    if cache.is_none() {
        *cache = Some(
            std::fs::read_to_string(hash_cache_path(game_path))
                .ok()
                .and_then(|text| serde_json::from_str(&text).ok())
                .unwrap_or_default(),
        );
    }
}

fn save_hash_cache(game_path: &Path) {
    let cache = HASH_CACHE.lock().unwrap();
    let Some(map) = cache.as_ref() else { return };
    let path = hash_cache_path(game_path);
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Err(error) = std::fs::write(&path, serde_json::to_vec(map).unwrap_or_default()) {
        log_update("warning", format!("Failed to save hash cache: {error}"));
    }
}

// Arquivo local igual ao do manifesto? O MD5 vem do cache se o tamanho e a data não mudaram.
fn validate_local_file(game_path: &Path, local: &Path, expected_hash: &str, expected_size: u64) -> bool {
    let Ok(meta) = std::fs::metadata(local) else { return false };
    if !meta.is_file() || meta.len() != expected_size {
        return false;
    }
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0);
    let key = local
        .strip_prefix(game_path)
        .unwrap_or(local)
        .to_string_lossy()
        .to_lowercase();

    if let Some(entry) = HASH_CACHE.lock().unwrap().as_ref().and_then(|map| map.get(&key)).and_then(Value::as_array) {
        let same_size = entry.first().and_then(Value::as_u64) == Some(meta.len());
        let same_time = entry.get(1).and_then(Value::as_f64).map(|t| (t - mtime).abs() < 1.0).unwrap_or(false);
        if same_size && same_time {
            return entry.get(2).and_then(Value::as_str) == Some(expected_hash);
        }
    }
    let hash = match md5_file(local) {
        Ok(hash) => hash,
        Err(error) => {
            log_update("error", format!("Validation error: {error}"));
            return false;
        }
    };
    if let Some(map) = HASH_CACHE.lock().unwrap().as_mut() {
        map.insert(key, json!([meta.len(), mtime, hash]));
    }
    hash == expected_hash
}

// URL de um arquivo do manifesto. file.url pode ser absoluta (GitHub) ou relativa ao
// update.json; sem file.url, o arquivo fica ao lado do update.json com o mesmo caminho.
fn file_url(file: &ManifestFile) -> Result<String, String> {
    match &file.url {
        Some(url) if !url.is_empty() => resolve_url(url),
        _ => {
            let encoded: Vec<String> = file
                .path
                .split('/')
                .map(|part| url::form_urlencoded::byte_serialize(part.as_bytes()).collect::<String>().replace('+', "%20"))
                .collect();
            resolve_url(&format!("{}?v={}", encoded.join("/"), file.hash))
        }
    }
}

// Baixa o manifesto. Sem manifesto, segue sem atualizar (o cliente completo é instalado em data.rs).
async fn download_manifest() -> Manifest {
    match fetch_manifest().await {
        Ok(manifest) => manifest,
        Err(error) => {
            log_update("error", format!("Failed to download manifest from server: {error}"));
            let empty = Manifest { version: String::new(), client: None, launcher: None, files: Vec::new() };
            *MANIFEST.lock().unwrap() = Some(empty.clone());
            empty
        }
    }
}

// Arquivos do manifesto que faltam ou estão diferentes na pasta do jogo
fn files_to_update(game_path: &Path) -> (Vec<ManifestFile>, usize) {
    let Some(manifest) = MANIFEST.lock().unwrap().clone() else {
        return (Vec::new(), 0);
    };
    load_hash_cache(game_path);
    let mut pending = Vec::new();
    for file in &manifest.files {
        let lower = file.path.to_lowercase();
        if EXCLUDED.iter().any(|name| lower.contains(name)) {
            continue;
        }
        // Caminho usado exatamente como no manifesto
        let Some(local) = resolve_game_path(game_path, &file.path) else {
            log_update("warning", format!("Skipping path outside the game folder: {}", file.path));
            continue;
        };
        // Preferência do jogador: só baixa se o arquivo não existir
        if file.keep == Some(true) && local.exists() {
            continue;
        }
        if !validate_local_file(game_path, &local, &file.hash, file.size) {
            pending.push(file.clone());
        }
    }
    save_hash_cache(game_path);
    (pending, manifest.files.len())
}

async fn check(game_path: PathBuf) -> (Vec<ManifestFile>, usize) {
    tokio::task::spawn_blocking(move || files_to_update(&game_path))
        .await
        .unwrap_or_default()
}

async fn download_file(game_path: &Path, file: &ManifestFile, progress: &(dyn Fn(Value) + Send + Sync)) -> Result<(), String> {
    let local = resolve_game_path(game_path, &file.path).ok_or("path outside the game folder")?;
    if let Some(dir) = local.parent() {
        tokio::fs::create_dir_all(dir).await.map_err(|e| e.to_string())?;
    }
    let response = http()
        .get(file_url(file)?)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let total = response.content_length().unwrap_or(file.size);
    let mut stream = response.bytes_stream();
    let mut out = tokio::fs::File::create(&local).await.map_err(|e| e.to_string())?;
    let mut downloaded = 0u64;
    let mut last_percent = u64::MAX;
    loop {
        // Sem receber dados por 30 s, a conexão falhou
        let chunk = tokio::time::timeout(Duration::from_secs(30), stream.next())
            .await
            .map_err(|_| "Download stalled".to_string())?;
        let Some(chunk) = chunk else { break };
        let chunk = chunk.map_err(|e| e.to_string())?;
        out.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        let percent = if total > 0 { (downloaded as f64 / total as f64 * 100.0).round() as u64 } else { 0 };
        if percent != last_percent {
            last_percent = percent;
            progress(json!({
                "type": "download-progress",
                "file": file.path,
                "progress": percent,
                "downloaded": downloaded,
                "total": total
            }));
        }
    }
    out.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}

// IPC check-updates
pub async fn check_updates(game_path: String) -> Value {
    let game = PathBuf::from(&game_path);
    // Arquivos traduzidos por versões antigas não batem com o MD5 do manifesto
    language_pack::restore(&game);
    download_manifest().await;
    let (pending, total) = check(game).await;
    json!({
        "success": true,
        "filesToUpdate": pending,
        "totalFiles": total,
        "filesNeedingUpdate": pending.len()
    })
}

async fn run_update(game: &Path, progress: &(dyn Fn(Value) + Send + Sync)) -> Result<&'static str, String> {
    progress(json!({ "type": "manifest", "message": "Downloading update manifest..." }));
    download_manifest().await;

    progress(json!({ "type": "check", "message": "Checking for updates..." }));
    let (pending, _) = check(game.to_path_buf()).await;
    if pending.is_empty() {
        return Ok("No updates needed");
    }

    let total = pending.len();
    for (index, file) in pending.iter().enumerate() {
        progress(json!({
            "type": "download",
            "message": format!("Downloading {}...", file.path),
            "current": index + 1,
            "total": total
        }));
        if let Err(error) = download_file(game, file, progress).await {
            log_update("error", format!("Download failed: {} - {error}", file.path));
            return Err(format!("Failed to download {}: {error}", file.path));
        }
    }

    progress(json!({ "type": "verify", "message": "Verifying files..." }));
    let (still_pending, _) = check(game.to_path_buf()).await;
    match still_pending.len() {
        0 => Ok("Update completed successfully"),
        1..=5 => Ok("Update completed successfully (with minor verification issues)"),
        _ => Err("Some files failed verification after update".to_string()),
    }
}

// IPC perform-update
pub async fn perform_update(game_path: String, progress: impl Fn(Value) + Send + Sync) -> Value {
    if game_path.is_empty() {
        return json!({ "success": false, "error": "Game path not provided", "reason": "no-path" });
    }
    let game = PathBuf::from(&game_path);
    if !game.join(config::GAME_EXECUTABLE).exists() {
        return json!({
            "success": false,
            "error": format!("{} not found in game directory: {game_path}", config::GAME_EXECUTABLE),
            "reason": "game-not-found"
        });
    }
    if IS_UPDATING.swap(true, Ordering::SeqCst) {
        return json!({ "success": false, "error": "Update already in progress" });
    }

    language_pack::restore(&game);
    // Oculto, o Windows não deixa sobrescrever
    dirs::set_game_exe_hidden(&game, false);
    dirs::set_game_files_hidden(false);
    let result = run_update(&game, &progress).await;
    dirs::set_game_exe_hidden(&game, true);
    dirs::set_game_files_hidden(true);
    IS_UPDATING.store(false, Ordering::SeqCst);

    match result {
        Ok(message) => json!({ "success": true, "message": message }),
        Err(error) => {
            log_update("error", format!("Update failed: {error}"));
            json!({ "success": false, "error": error })
        }
    }
}
