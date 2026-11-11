// Limpeza da tradução por troca de arquivos (versões antigas do launcher).
//
// Antes, o jogo rodava sempre em inglês e o launcher copiava os arquivos traduzidos por
// cima dos arquivos em inglês, com os originais em %APPDATA%\AsgardMU\language-backup.
// Agora o cliente troca de idioma sozinho: restore() só devolve os originais que ainda
// estiverem trocados.
use crate::store::user_data_dir;
use crate::updater::md5_file;
use serde_json::{json, Value};
use std::path::Path;

pub fn restore(game_dir: &Path) {
    let backup_dir = user_data_dir().join("language-backup");
    let state_path = backup_dir.join("state.json");
    let Some(state) = std::fs::read_to_string(&state_path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
    else {
        // Sem estado: este computador nunca usou a troca de arquivos
        return;
    };
    let Some(files) = state.get("files").and_then(Value::as_object) else { return };
    if files.is_empty() {
        return;
    }
    for (rel, translated_hash) in files {
        let target = game_dir.join(rel);
        let backup = backup_dir.join(rel);
        // Se o update já trocou o arquivo, o MD5 não bate e o arquivo novo fica.
        let translated = md5_file(&target).ok().as_deref() == translated_hash.as_str();
        if translated && backup.exists() {
            if let Err(error) = std::fs::copy(&backup, &target) {
                crate::logger::log_event("error", format!("[LanguagePack] Failed to restore {rel}: {error}"));
            }
        }
    }
    let _ = std::fs::write(&state_path, json!({ "language": "Eng", "files": {} }).to_string());
}
