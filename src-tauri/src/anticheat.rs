// Anti-cheat local: detecção no lado do cliente.
//
// Varre os processos em execução a cada ANTICHEAT_SCAN_INTERVAL_MS. Quando o nome do
// processo OU o título da janela casa com a lista de proibidos, o launcher:
//   1. encerra o jogo;
//   2. registra o evento no histórico do site (POST na API, só para consulta);
//   3. avisa a interface e mostra uma notificação.
//
// O banimento NÃO é feito aqui. A tabela web.anticheat_detections guarda apenas o
// histórico; a decisão de banir fica com o administrador.
//
// As regras padrão podem ser trocadas por <jogo>\Data\Launcher\anti-cheat-rules.json
// ({ processTokens, windowTokens }), sem recompilar o launcher.
use crate::logger::log_event;
use crate::{config, dirs, game, i18n, sys, updater};
use regex::Regex;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::Emitter;

// Tokens casados como SUBSTRING do nome do processo (sem ".exe"), em minúsculas.
const DEFAULT_PROCESS_TOKENS: &[&str] = &[
    "cheatengine", "cheat engine", "artmoney", "wemod",
    "speedhack", "speedgear", "speeder", "squallmeta",
    "ollydbg", "x64dbg", "x32dbg", "windbg", "ghidra", "scyllahide",
    "processhacker", "injector", "extremeinjector", "xenos",
    "wpepro", "wpe pro", "rpe", "fiddler", "wireshark", "charles",
    "openkore", "autoit", "ahk", "autohotkey", "mhs", "tsearch",
];

// Tokens casados como SUBSTRING do título da janela, em minúsculas.
const DEFAULT_WINDOW_TOKENS: &[&str] = &[
    "cheat engine", "artmoney", "wemod", "process hacker",
    "x64dbg", "x32dbg", "ollydbg", "ida -", "ida pro",
    "wpe pro", "winject", "extreme injector",
];

// Processo do jogo, para extrair os personagens ativos (título "... Name: X ...").
const GAME_PROCESS_NAME: &str = "main";

struct Rules {
    process_tokens: Vec<String>,
    window_tokens: Vec<String>,
}

struct Hit {
    detection_type: &'static str,
    offender_name: String,
    offender_detail: String,
    offender_path: Option<String>,
    characters: Vec<String>,
}

static ACTIVE: AtomicBool = AtomicBool::new(false);
// Evita reportar o mesmo ofensor repetidamente dentro de uma sessão.
static REPORTED: Mutex<Option<HashSet<String>>> = Mutex::new(None);
// PID do main.exe -> último personagem visto no título da janela (crash.rs)
static GAME_CHARACTERS: Mutex<Option<HashMap<u32, String>>> = Mutex::new(None);

fn character_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)Name:\s*([a-zA-Z0-9_-]{3,20})").unwrap())
}

pub fn hardware_id() -> &'static str {
    static ID: OnceLock<String> = OnceLock::new();
    ID.get_or_init(sys::hardware_id)
}

// Último personagem visto no main.exe com este PID
pub fn character_of_pid(pid: u32) -> Option<String> {
    GAME_CHARACTERS.lock().unwrap().as_ref().and_then(|map| map.get(&pid).cloned())
}

// Personagens nos títulos das janelas do jogo: (nome, PID)
pub fn detect_characters() -> Vec<(String, u32)> {
    let mut found = Vec::new();
    for process in sys::list_processes() {
        if !process.name.eq_ignore_ascii_case(GAME_PROCESS_NAME) {
            continue;
        }
        if let Some(capture) = character_regex().captures(&process.title) {
            found.push((capture[1].to_string(), process.pid));
        }
    }
    found
}

// Mescla as regras padrão com o JSON opcional: uma lista preenchida substitui a padrão.
fn load_rules() -> Rules {
    let defaults = |list: &[&str]| list.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let mut rules = Rules {
        process_tokens: defaults(DEFAULT_PROCESS_TOKENS),
        window_tokens: defaults(DEFAULT_WINDOW_TOKENS),
    };
    let file = dirs::game_dir().join("Data").join("Launcher").join("anti-cheat-rules.json");
    let Ok(text) = std::fs::read_to_string(&file) else {
        return rules;
    };
    let custom: Value = match serde_json::from_str(text.trim_start_matches('\u{feff}')) {
        Ok(value) => value,
        Err(error) => {
            log_event("warning", format!("[AntiCheat] Falha ao ler regras ({}): {error}", file.display()));
            return rules;
        }
    };
    let list = |name: &str| -> Vec<String> {
        custom
            .get(name)
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .map(|s| s.trim().to_lowercase())
                    .filter(|s| !s.is_empty())
                    .collect()
            })
            .unwrap_or_default()
    };
    let (process, window) = (list("processTokens"), list("windowTokens"));
    if !process.is_empty() {
        rules.process_tokens = process;
    }
    if !window.is_empty() {
        rules.window_tokens = window;
    }
    rules
}

// Uma varredura. Retorna a lista de ofensores encontrados.
fn scan_once(rules: &Rules) -> Vec<Hit> {
    let processes = sys::list_processes();

    let mut characters: Vec<String> = Vec::new();
    {
        let mut guard = GAME_CHARACTERS.lock().unwrap();
        let known = guard.get_or_insert_with(HashMap::new);
        for process in &processes {
            if !process.name.eq_ignore_ascii_case(GAME_PROCESS_NAME) {
                continue;
            }
            if let Some(capture) = character_regex().captures(&process.title) {
                let name = capture[1].to_string();
                known.insert(process.pid, name.clone());
                if !characters.contains(&name) {
                    characters.push(name);
                }
            }
        }
    }

    let mut hits = Vec::new();
    for process in &processes {
        let name = process.name.to_lowercase();
        let title = process.title.to_lowercase();
        if name == GAME_PROCESS_NAME {
            continue;
        }
        let by_process = rules.process_tokens.iter().find(|token| name.contains(token.as_str()));
        let by_window = rules
            .window_tokens
            .iter()
            .find(|token| !title.is_empty() && title.contains(token.as_str()));
        let (detection_type, detail) = match (by_process, by_window) {
            (Some(token), _) => ("process", format!("match: {token}")),
            (None, Some(_)) => ("window", format!("title: {}", process.title)),
            (None, None) => continue,
        };
        hits.push(Hit {
            detection_type,
            offender_name: if process.name.is_empty() { "(desconhecido)".to_string() } else { process.name.clone() },
            offender_detail: detail,
            offender_path: sys::process_path(process.pid),
            characters: characters.clone(),
        });
    }
    hits
}

// Grava o evento no histórico do site. Falha de rede nunca derruba o launcher.
async fn report(hit: &Hit) {
    let mut request = updater::http()
        .post(config::anticheat_report_url())
        .timeout(Duration::from_secs(8))
        .json(&json!({
            "detectionType": hit.detection_type,
            "offenderName": hit.offender_name,
            "offenderDetail": hit.offender_detail,
            "offenderPath": hit.offender_path,
            "characterName": hit.characters.first(),
            "characters": hit.characters,
            "hostname": sys::hostname(),
            "hardwareId": hardware_id()
        }));
    if !config::ANTICHEAT_TOKEN.is_empty() {
        request = request.header("x-anticheat-token", config::ANTICHEAT_TOKEN);
    }
    match request.send().await.and_then(|response| response.error_for_status()) {
        Ok(_) => log_event("info", format!("[AntiCheat] Detecção registrada: {}", hit.offender_name)),
        Err(error) => log_event("error", format!("[AntiCheat] Falha ao registrar detecção: {error}")),
    }
}

// Trata os ofensores: encerra o jogo, avisa a interface e reporta.
async fn handle_hits(hits: Vec<Hit>) {
    let Some(first) = hits.first() else { return };
    log_event("warning", format!("[AntiCheat] Programa não permitido: {} ({})", first.offender_name, first.detection_type));
    log_event("warning", format!("[AntiCheat] Encerrando o jogo: {}", first.offender_name));
    game::kill_all();

    let app = crate::app();
    let _ = app.emit("anticheat-detection", json!({ "offenderName": first.offender_name }));
    crate::notify("AsgardMU", &i18n::t("notify.anticheatClosed").replace("{name}", &first.offender_name));

    for hit in &hits {
        let key = format!("{}:{}:{}", hit.detection_type, hit.offender_name, hit.offender_detail);
        let is_new = REPORTED.lock().unwrap().get_or_insert_with(HashSet::new).insert(key);
        if is_new {
            report(hit).await;
        }
    }
}

// Começa a varredura (uma vez; continua até o launcher fechar)
pub fn start() {
    if ACTIVE.swap(true, Ordering::SeqCst) {
        return;
    }
    let interval = Duration::from_millis(config::ANTICHEAT_SCAN_INTERVAL_MS);
    log_event("info", format!("[AntiCheat] Monitoramento iniciado (intervalo {} ms)", interval.as_millis()));
    tauri::async_runtime::spawn(async move {
        let rules = std::sync::Arc::new(load_rules());
        loop {
            let scan_rules = rules.clone();
            match tokio::task::spawn_blocking(move || scan_once(&scan_rules)).await {
                Ok(hits) => handle_hits(hits).await,
                Err(error) => log_event("error", format!("[AntiCheat] Erro no monitoramento: {error}")),
            }
            tokio::time::sleep(interval).await;
        }
    });
}
