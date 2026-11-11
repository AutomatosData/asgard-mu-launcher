// Textos do processo principal (bandeja e notificações do Windows). Os textos da janela
// ficam em ui/shared/i18n.js; as chaves abaixo existem lá com o mesmo texto.
use std::sync::Mutex;

static LANGUAGE: Mutex<&'static str> = Mutex::new("Eng");

pub fn normalize(lang: &str) -> &'static str {
    match lang {
        "Por" => "Por",
        "Spa" => "Spa",
        _ => "Eng",
    }
}

pub fn language() -> &'static str {
    *LANGUAGE.lock().unwrap()
}

pub fn set_language(lang: &str) {
    *LANGUAGE.lock().unwrap() = normalize(lang);
}

pub fn t(key: &str) -> &'static str {
    match (key, language()) {
        ("tray.show", "Eng") => "Show Launcher",
        ("tray.show", _) => "Mostrar Launcher",
        ("tray.launch", "Por") => "Iniciar Jogo",
        ("tray.launch", "Spa") => "Iniciar Juego",
        ("tray.launch", _) => "Launch Game",
        ("tray.ping", _) => "Ping: {ms} ms",
        ("tray.pingOffline", "Por") => "Ping: sem conexão",
        ("tray.pingOffline", "Spa") => "Ping: sin conexión",
        ("tray.pingOffline", _) => "Ping: offline",
        ("tray.quit", "Por") => "Sair",
        ("tray.quit", "Spa") => "Salir",
        ("tray.quit", _) => "Quit",
        ("tray.minimized", "Por") => "AsgardMU minimizado na bandeja do sistema",
        ("tray.minimized", "Spa") => "AsgardMU minimizado en la bandeja del sistema",
        ("tray.minimized", _) => "AsgardMU minimized to system tray",
        ("notify.anticheatClosed", "Por") => "Jogo encerrado: programa não permitido detectado ({name})",
        ("notify.anticheatClosed", "Spa") => "Juego cerrado: se detectó un programa no permitido ({name})",
        ("notify.anticheatClosed", _) => "Game closed: a forbidden program was detected ({name})",
        _ => "",
    }
}
