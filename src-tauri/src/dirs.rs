// Pastas da instalação e arquivos ocultos.
//
// O instalador põe o AsgardMU.exe (este programa) na pasta do jogo. As instalações da
// versão Electron 1.0.5+ tinham o launcher em "<jogo>\Launcher": esse layout ainda é aceito.
// A pasta do jogo fica limpa: as DLLs, o Main.orig, a pasta Data e a ErrorLog ficam ocultos.
use crate::config;
use crate::store::store;
use serde_json::json;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use windows::core::PCWSTR;
use windows::Win32::Storage::FileSystem::{
    GetFileAttributesW, SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_SYSTEM,
    FILE_FLAGS_AND_ATTRIBUTES, INVALID_FILE_ATTRIBUTES,
};

const LAUNCHER_FOLDER: &str = "Launcher";

// Ficam na pasta do main.exe: o main.exe lê Data\ e carrega as DLLs da própria pasta.
const HIDDEN_GAME_FILES: &[&str] = &[
    "Main.dll", "Main.orig", "glu32.dll", "AsgardCustom.dll", "AsgardLua.dll",
    "discord_game_sdk.dll", "awesomium.dll", "awesomium_process.exe", "icudt.dll",
    "msvcp140.dll", "vcruntime140.dll", "muplayer.exe", "Popup.exe",
];
const HIDDEN_GAME_DIRS: &[&str] = &["Data", "ErrorLog"];

// Programa instalado (release). Em "tauri dev" a pasta do jogo vem do config.json.
pub fn is_packaged() -> bool {
    !cfg!(debug_assertions)
}

pub fn launcher_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from("."))
}

fn has_launcher_folder() -> bool {
    launcher_dir()
        .file_name()
        .map(|name| name.to_string_lossy().eq_ignore_ascii_case(LAUNCHER_FOLDER))
        .unwrap_or(false)
}

// Pasta escolhida no instalador
pub fn install_dir() -> PathBuf {
    let dir = launcher_dir();
    if has_launcher_folder() {
        dir.parent().map(Path::to_path_buf).unwrap_or(dir)
    } else {
        dir
    }
}

// Pasta do jogo (onde fica o main.exe)
pub fn game_dir() -> PathBuf {
    let exec_dir = install_dir();
    if exec_dir.join(config::GAME_EXECUTABLE).exists() {
        let stored = store().get_str("gamePath");
        let current = exec_dir.to_string_lossy().to_string();
        if stored.as_deref() != Some(current.as_str()) {
            store().set("gamePath", json!(current));
        }
        return exec_dir;
    }
    // Instalado: o jogo fica sempre na pasta do launcher. Sem o main.exe aqui, o launcher
    // baixa o cliente nesta pasta.
    if is_packaged() {
        return exec_dir;
    }
    // Desenvolvimento: cliente salvo no config.json
    if let Some(stored) = store().get_str("gamePath") {
        let path = PathBuf::from(&stored);
        if path.join(config::GAME_EXECUTABLE).exists() {
            return path;
        }
    }
    std::env::current_dir().unwrap_or(exec_dir)
}

pub fn log_dir() -> PathBuf {
    game_dir().join("Data").join("Launcher").join("Logs")
}

fn wide(path: &Path) -> Vec<u16> {
    path.as_os_str().encode_wide().chain(std::iter::once(0)).collect()
}

// Oculto (+ sistema): some do Explorer na configuração padrão. O Windows não deixa
// sobrescrever um arquivo oculto: a atualização mostra os arquivos antes.
pub fn set_hidden(path: &Path, hidden: bool, system: bool) -> bool {
    let name = wide(path);
    unsafe {
        let current = GetFileAttributesW(PCWSTR(name.as_ptr()));
        if current == INVALID_FILE_ATTRIBUTES {
            return false;
        }
        let mut bits = FILE_ATTRIBUTE_HIDDEN.0;
        if system {
            bits |= FILE_ATTRIBUTE_SYSTEM.0;
        }
        let wanted = if hidden { current | bits } else { current & !bits };
        if wanted == current {
            return true;
        }
        SetFileAttributesW(PCWSTR(name.as_ptr()), FILE_FLAGS_AND_ATTRIBUTES(wanted)).is_ok()
    }
}

pub fn set_game_exe_hidden(game_dir: &Path, hidden: bool) {
    set_hidden(&game_dir.join(config::GAME_EXECUTABLE), hidden, true);
}

pub fn set_game_files_hidden(hidden: bool) {
    if !is_packaged() {
        return;
    }
    let root = install_dir();
    for name in HIDDEN_GAME_FILES {
        set_hidden(&root.join(name), hidden, true);
    }
    for name in HIDDEN_GAME_DIRS {
        set_hidden(&root.join(name), hidden, false);
    }
}
