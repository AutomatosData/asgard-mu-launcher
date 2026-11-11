// Logs em <jogo>\Data\Launcher\Logs (app.log e update.log), no formato da versão Electron.
use crate::dirs;
use std::io::Write;

fn write(file: &str, level: &str, message: &str) {
    let dir = dirs::log_dir();
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let stamp = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ");
    let line = format!("[{stamp}] [{}] {message}\n", level.to_uppercase());
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join(file)) {
        let _ = f.write_all(line.as_bytes());
    }
    #[cfg(debug_assertions)]
    eprint!("{line}");
}

pub fn log_event(level: &str, message: impl AsRef<str>) {
    write("app.log", level, message.as_ref());
}

pub fn log_update(level: &str, message: impl AsRef<str>) {
    write("update.log", level, message.as_ref());
}
