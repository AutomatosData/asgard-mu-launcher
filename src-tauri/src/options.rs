// LauncherOption.if (resolução, modo janela, conta e idioma lidos pelo main.exe) e o
// registro HKCU\Software\Webzen\Mu\Config.
use crate::dirs;
use crate::store::store;
use serde_json::{json, Map, Value};
use std::path::PathBuf;
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

const FILE_NAME: &str = "LauncherOption.if";
const REGISTRY_PATH: &str = "Software\\Webzen\\Mu\\Config";

// Idioma do launcher -> idioma do cliente. index é o ID em Data/Custom/LangManager.xml
// (LauncherOption.if Language) e code é a pasta do Lang.mpr / Data/Local (registro LangSelection).
pub struct ClientLanguage {
    pub index: i64,
    pub code: &'static str,
}

pub fn client_language(language: &str) -> ClientLanguage {
    match language {
        "Spa" => ClientLanguage { index: 1, code: "Spn" },
        "Por" => ClientLanguage { index: 2, code: "Por" },
        _ => ClientLanguage { index: 0, code: "Eng" },
    }
}

fn language_for_client_index(index: &str) -> Option<&'static str> {
    match index {
        "0" => Some("Eng"),
        "1" => Some("Spa"),
        "2" => Some("Por"),
        _ => None,
    }
}

pub fn file_path() -> PathBuf {
    dirs::game_dir().join(FILE_NAME)
}

fn default_options() -> Map<String, Value> {
    let mut map = Map::new();
    map.insert("DevModeIndex".into(), json!("11"));
    map.insert("WindowMode".into(), json!("1"));
    map.insert("ID".into(), json!(""));
    map.insert("Language".into(), json!("0"));
    map
}

// Valor de uma opção como texto ("" se não existe)
fn text(options: &Map<String, Value>, key: &str) -> Option<String> {
    match options.get(key) {
        Some(Value::String(s)) => Some(s.clone()),
        Some(Value::Number(n)) => Some(n.to_string()),
        _ => None,
    }
}

// Linhas "Chave:valor"
pub fn read_launcher_options() -> Map<String, Value> {
    let Ok(content) = std::fs::read_to_string(file_path()) else {
        return default_options();
    };
    let mut options = Map::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || !line.contains(':') {
            continue;
        }
        let mut parts = line.split(':');
        let key = parts.next().unwrap_or("").trim();
        let value = parts.next().unwrap_or("").trim();
        options.insert(key.to_string(), json!(value));
    }
    options
}

pub fn write_launcher_options(options: &Map<String, Value>) -> bool {
    let get = |key: &str, default: &str| text(options, key).unwrap_or_else(|| default.to_string());
    let content = format!(
        "DevModeIndex:{}\nWindowMode:{}\nID:{}\nLanguage:{}\n",
        get("DevModeIndex", "11"),
        get("WindowMode", "1"),
        get("ID", ""),
        get("Language", "0")
    );
    if std::fs::write(file_path(), content).is_err() {
        return false;
    }
    // Índice que o launcher gravou: outro valor no arquivo veio da tecla O do jogo
    if let Some(language) = text(options, "Language") {
        store().set("clientLanguageIndex", json!(language));
    }
    true
}

// Formato da janela de configurações -> LauncherOption.if
pub fn convert_from_game_settings(settings: &Value) -> Map<String, Value> {
    if let Some(lang) = settings.get("langSelection").and_then(Value::as_str) {
        store().set("gameLanguage", json!(lang));
    }
    let lang = settings.get("langSelection").and_then(Value::as_str).unwrap_or("");
    let mut map = Map::new();
    // Posição na lista de modos do monitor filtrada como o jogo (display.rs)
    map.insert(
        "DevModeIndex".into(),
        json!(settings.get("resolution").and_then(Value::as_i64).unwrap_or(11).to_string()),
    );
    map.insert(
        "WindowMode".into(),
        json!(settings.get("windowMode").and_then(Value::as_i64).unwrap_or(1).to_string()),
    );
    map.insert("ID".into(), json!(settings.get("ID").and_then(Value::as_str).unwrap_or("")));
    map.insert("Language".into(), json!(client_language(lang).index.to_string()));
    map
}

// LauncherOption.if -> formato da janela de configurações
pub fn convert_to_game_settings(options: &Map<String, Value>) -> Value {
    let file_language = text(options, "Language");

    // A janela da tecla O do jogo (AsgardCustom.dll) também troca o idioma e grava o
    // Language do arquivo; se ele não é mais o que o launcher gravou, vale o do jogo
    if let (Some(written), Some(current)) = (store().get_str("clientLanguageIndex"), &file_language) {
        if &written != current {
            if let Some(from_game) = language_for_client_index(current) {
                store().set("gameLanguage", json!(from_game));
                store().set("clientLanguageIndex", json!(current));
            }
        }
    }

    // Idioma salvo pelo launcher; sem ele, a ordem das versões antigas (0 Eng, 1 Por, 2 Spa)
    let language = store()
        .get_str("gameLanguage")
        .filter(|lang| !lang.is_empty())
        .or_else(|| match &file_language {
            None => Some("Eng".to_string()),
            Some(index) => match index.trim().parse::<i64>() {
                Ok(0) => Some("Eng".to_string()),
                Ok(1) => Some("Por".to_string()),
                Ok(2) => Some("Spa".to_string()),
                _ => None,
            },
        });

    let number = |key: &str, default: i64| -> Value {
        match text(options, key) {
            Some(value) => value.trim().parse::<i64>().map(|n| json!(n)).unwrap_or(Value::Null),
            None => json!(default),
        }
    };

    json!({
        "resolution": number("DevModeIndex", 11),
        "windowMode": number("WindowMode", 1),
        "musicOnOFF": 1,
        "soundOnOFF": 1,
        "volumeLevel": 10,
        "langSelection": language,
        "ID": text(options, "ID").unwrap_or_default()
    })
}

// Idioma atual do launcher (lê o arquivo: a tecla O do jogo pode ter mudado)
pub fn current_language() -> String {
    let settings = convert_to_game_settings(&read_launcher_options());
    crate::i18n::normalize(settings.get("langSelection").and_then(Value::as_str).unwrap_or("")).to_string()
}

// ===== Registro =====

pub fn write_registry_string(name: &str, value: &str) -> bool {
    RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(REGISTRY_PATH)
        .and_then(|(key, _)| key.set_value(name, &value))
        .is_ok()
}

fn write_registry_dword(name: &str, value: u32) -> bool {
    RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey(REGISTRY_PATH)
        .and_then(|(key, _)| key.set_value(name, &value))
        .is_ok()
}

pub fn read_game_settings() -> Value {
    let mut settings = Map::new();
    let Ok(key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(REGISTRY_PATH) else {
        return Value::Object(settings);
    };
    for (name, field) in [
        ("Resolution", "resolution"),
        ("WindowMode", "windowMode"),
        ("MusicOnOFF", "musicOnOFF"),
        ("SoundOnOFF", "soundOnOFF"),
        ("VolumeLevel", "volumeLevel"),
    ] {
        if let Ok(value) = key.get_value::<u32, _>(name) {
            settings.insert(field.into(), json!(value));
        }
    }
    if let Ok(value) = key.get_value::<String, _>("LangSelection") {
        settings.insert("langSelection".into(), json!(value));
    }
    Value::Object(settings)
}

pub fn write_game_settings(settings: &Value) -> bool {
    let mut ok = true;
    for (name, field) in [
        ("Resolution", "resolution"),
        ("WindowMode", "windowMode"),
        ("MusicOnOFF", "musicOnOFF"),
        ("SoundOnOFF", "soundOnOFF"),
        ("VolumeLevel", "volumeLevel"),
    ] {
        if let Some(value) = settings.get(field).and_then(Value::as_u64) {
            ok &= write_registry_dword(name, value as u32);
        }
    }
    if let Some(value) = settings.get("langSelection").and_then(Value::as_str) {
        ok &= write_registry_string("LangSelection", value);
    }
    ok
}
