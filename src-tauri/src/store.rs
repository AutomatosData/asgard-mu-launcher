// Configuração do launcher em %APPDATA%\AsgardMU\config.json (mesmo arquivo e formato
// do electron-store da versão Electron: quem atualiza mantém idioma e histórico).
use serde_json::{Map, Value};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

pub struct Store {
    path: PathBuf,
    data: Mutex<Map<String, Value>>,
}

static STORE: OnceLock<Store> = OnceLock::new();

pub fn user_data_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    base.join("AsgardMU")
}

pub fn store() -> &'static Store {
    STORE.get_or_init(|| {
        let path = user_data_dir().join("config.json");
        let data = std::fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str::<Map<String, Value>>(&text).ok())
            .unwrap_or_default();
        Store { path, data: Mutex::new(data) }
    })
}

impl Store {
    pub fn get(&self, key: &str) -> Option<Value> {
        self.data.lock().unwrap().get(key).cloned()
    }

    pub fn get_str(&self, key: &str) -> Option<String> {
        self.get(key).and_then(|v| v.as_str().map(str::to_string))
    }

    pub fn has(&self, key: &str) -> bool {
        self.data.lock().unwrap().contains_key(key)
    }

    pub fn set(&self, key: &str, value: Value) {
        let mut data = self.data.lock().unwrap();
        data.insert(key.to_string(), value);
        self.save(&data);
    }

    pub fn all(&self) -> Map<String, Value> {
        self.data.lock().unwrap().clone()
    }

    fn save(&self, data: &Map<String, Value>) {
        if let Some(dir) = self.path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        // Tabulações, como o electron-store
        let mut out = Vec::new();
        let formatter = serde_json::ser::PrettyFormatter::with_indent(b"\t");
        let mut ser = serde_json::Serializer::with_formatter(&mut out, formatter);
        if serde::Serialize::serialize(data, &mut ser).is_ok() {
            let _ = std::fs::write(&self.path, out);
        }
    }
}
