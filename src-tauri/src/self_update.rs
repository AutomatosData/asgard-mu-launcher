// Atualização do próprio launcher. update.json -> launcher = { version, url, size, hash }
// (tools/release.js launcher). Se a versão publicada for maior que a instalada, baixa o
// instalador, confere tamanho e MD5, abre o instalador em modo silencioso na mesma pasta
// e fecha o launcher. O instalador abre o launcher novo no fim (--force-run, tratado em
// src-tauri/installer-hooks.nsh). Só roda no launcher instalado pelo instalador.
use crate::logger::log_event;
use crate::store::store;
use crate::updater::{self, http};
use crate::dirs;
use futures_util::StreamExt;
use md5::{Digest, Md5};
use serde_json::{json, Value};
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::time::Duration;
use tokio::io::AsyncWriteExt;

// Nova tentativa da mesma versão só depois deste tempo (evita laço se o instalador falhar)
const RETRY_AFTER_MS: i64 = 30 * 60 * 1000;

// "1.2.10" > "1.2.9"
pub fn is_newer(remote: &str, local: &str) -> bool {
    let parse = |v: &str| -> Vec<u64> { v.split('.').map(|n| n.trim().parse().unwrap_or(0)).collect() };
    let (a, b) = (parse(remote), parse(local));
    for i in 0..a.len().max(b.len()) {
        let (x, y) = (a.get(i).copied().unwrap_or(0), b.get(i).copied().unwrap_or(0));
        if x != y {
            return x > y;
        }
    }
    false
}

// O instalador põe o desinstalador junto do launcher
fn is_installed_by_setup() -> bool {
    let dir = dirs::launcher_dir();
    dir.join("uninstall.exe").exists() || dir.join("Uninstall AsgardMU.exe").exists()
}

async fn download(url: &str, file_path: &Path, size: u64, hash: &str, progress: &(dyn Fn(Value) + Send + Sync)) -> Result<(), String> {
    let response = http().get(url).send().await.map_err(|e| e.to_string())?.error_for_status().map_err(|e| e.to_string())?;
    let total = response.content_length().filter(|&n| n > 0).unwrap_or(size);
    let mut stream = response.bytes_stream();
    let mut file = tokio::fs::File::create(file_path).await.map_err(|e| e.to_string())?;
    let mut hasher = Md5::new();
    let mut downloaded = 0u64;
    let mut last_percent = u64::MAX;
    loop {
        let chunk = tokio::time::timeout(Duration::from_secs(30), stream.next())
            .await
            .map_err(|_| "Download stalled".to_string())?;
        let Some(chunk) = chunk else { break };
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;
        if total > 0 {
            let percent = (downloaded as f64 / total as f64 * 100.0).round() as u64;
            if percent != last_percent {
                last_percent = percent;
                progress(json!({ "downloaded": downloaded, "total": total, "progress": percent }));
            }
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);

    let actual = hex::encode(hasher.finalize());
    if (size > 0 && downloaded != size) || (!hash.is_empty() && actual != hash) {
        let _ = tokio::fs::remove_file(file_path).await;
        return Err("Launcher setup download is corrupted".to_string());
    }
    Ok(())
}

// Devolve { updating: true } se o instalador novo foi aberto (o launcher deve fechar)
pub async fn check(current: &str, progress: impl Fn(Value) + Send + Sync) -> Value {
    if !dirs::is_packaged() {
        return json!({ "updating": false, "reason": "dev" });
    }

    let manifest = match updater::fetch_manifest().await {
        Ok(manifest) => manifest,
        Err(error) => {
            log_event("warning", format!("[LauncherUpdate] Manifest not available: {error}"));
            return json!({ "updating": false, "reason": "no-manifest" });
        }
    };

    let remote = manifest.launcher.unwrap_or(Value::Null);
    let version = remote.get("version").and_then(Value::as_str).unwrap_or("");
    let url = remote.get("url").and_then(Value::as_str).unwrap_or("");
    if version.is_empty() || url.is_empty() || !is_newer(version, current) {
        return json!({ "updating": false, "reason": "up-to-date" });
    }

    if !is_installed_by_setup() {
        log_event("warning", format!("[LauncherUpdate] {version} available, but this launcher was not installed by the setup; skipping"));
        return json!({ "updating": false, "reason": "not-installed", "version": version });
    }

    let now = chrono::Utc::now().timestamp_millis();
    if let Some(last) = store().get("launcherUpdateTry") {
        let same = last.get("version").and_then(Value::as_str) == Some(version);
        let at = last.get("at").and_then(Value::as_i64).unwrap_or(0);
        if same && now - at < RETRY_AFTER_MS {
            log_event("warning", format!("[LauncherUpdate] {version} was tried a short time ago; waiting before a new try"));
            return json!({ "updating": false, "reason": "recently-tried", "version": version });
        }
    }

    log_event("info", format!("[LauncherUpdate] Updating launcher {current} -> {version}"));
    let setup_path = std::env::temp_dir().join(format!("AsgardMU-Setup-{version}.exe"));
    let result: Result<(), String> = async {
        let full_url = updater::resolve_url(url)?;
        let size = remote.get("size").and_then(Value::as_u64).unwrap_or(0);
        let hash = remote.get("hash").and_then(Value::as_str).unwrap_or("");
        download(&full_url, &setup_path, size, hash, &progress).await?;

        store().set("launcherUpdateTry", json!({ "version": version, "at": now }));

        // /UPDATE: o instalador não recria os atalhos que o jogador apagou.
        // /D= tem que ser o último parâmetro e sem aspas (regra do NSIS)
        let args = format!("/S /UPDATE --updated --force-run /D={}", dirs::install_dir().to_string_lossy());
        std::process::Command::new(&setup_path)
            .raw_arg(&args)
            .spawn()
            .map_err(|e| e.to_string())?;
        log_event("info", format!("[LauncherUpdate] Setup started: {} {args}", setup_path.display()));
        Ok(())
    }
    .await;

    match result {
        Ok(()) => json!({ "updating": true, "version": version }),
        Err(error) => {
            log_event("error", format!("[LauncherUpdate] Update failed: {error}"));
            json!({ "updating": false, "reason": "error", "error": error })
        }
    }
}
