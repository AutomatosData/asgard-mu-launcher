// Relatório de crash do cliente.
//
// Quando o main.exe trava, o cliente grava ErrorLog\stack_<data>.txt e ErrorLog\crash_<data>.dmp.
// O launcher vê esses arquivos quando o jogo fecha e envia o relatório para a Equipe AsgardMU:
// POST em config::crash_report_url() (site: src/app/api/crash/report). O site grava em
// web.crash_reports e a equipe lê em /painel/crashes.
//
// O envio é automático. Se ele falhar, uma janela pequena (ui/crash-report.html) pede ao
// jogador para tentar de novo.
use crate::logger::log_event;
use crate::store::store;
use crate::{anticheat, config, dirs, i18n, sys, updater};
use base64::Engine;
use md5::{Digest, Md5};
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::VecDeque;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

// Error.log do cliente: texto com XOR de 16 bytes repetidos desde o início do arquivo.
const ERROR_LOG_KEY: [u8; 16] = [
    0x7c, 0xbd, 0x81, 0x9f, 0x3d, 0x93, 0xe2, 0x56, 0x2a, 0x73, 0xd2, 0x3e, 0xf2, 0x83, 0x95, 0xbf,
];

const MAX_LOG: usize = 64 * 1024;
const MAX_LUA_LOG: usize = 32 * 1024;
const MAX_DUMP_GZ: usize = 2 * 1024 * 1024;
// O cliente grava o dump antes de fechar; folga para o relógio do arquivo e do launcher.
const START_SLACK_MS: i64 = 5000;
const CLIENT_DLLS: &[&str] = &["AsgardCustom.dll", "AsgardLua.dll", "glu32.dll", "Main.dll"];
const WINDOW_LABEL: &str = "crash";

#[derive(Clone)]
struct Crash {
    dir: PathBuf,
    crashed_at: String,
    stack_file: Option<String>,
    dump_file: Option<String>,
    dump_size: u64,
    pid: u32,
    exit_code: u32,
}

struct Current {
    crash: Crash,
    // Montado no primeiro envio: uma nova tentativa usa o mesmo reportKey
    payload: Option<Map<String, Value>>,
}

static QUEUE: Mutex<VecDeque<Crash>> = Mutex::new(VecDeque::new());
static CURRENT: Mutex<Option<Current>> = Mutex::new(None);

// Bytes como texto latin1 (as linhas coreanas do cliente são cp949; o inglês fica legível)
fn latin1(bytes: &[u8]) -> String {
    bytes.iter().map(|&b| b as char).collect()
}

// Últimos bytes de um arquivo, como texto. Corta a primeira linha, que pode vir pela metade.
fn read_tail(file: &Path, max: usize) -> Option<String> {
    let mut f = std::fs::File::open(file).ok()?;
    let size = f.metadata().ok()?.len();
    let start = size.saturating_sub(max as u64);
    f.seek(SeekFrom::Start(start)).ok()?;
    let mut buffer = Vec::new();
    f.read_to_end(&mut buffer).ok()?;
    let mut text = latin1(&buffer);
    if start > 0 {
        if let Some(pos) = text.find('\n') {
            text = text[pos + 1..].to_string();
        }
    }
    Some(text)
}

fn rfind(haystack: &[u8], needle: &[u8], last_start: usize) -> Option<usize> {
    if haystack.len() < needle.len() {
        return None;
    }
    let mut index = last_start.min(haystack.len() - needle.len());
    loop {
        if &haystack[index..index + needle.len()] == needle {
            return Some(index);
        }
        if index == 0 {
            return None;
        }
        index -= 1;
    }
}

// Error.log decodificado, só a última sessão do jogo (cada abertura começa com "###### ... Start ######").
fn read_error_log(file: &Path) -> Option<String> {
    let data = std::fs::read(file).ok()?;
    let plain: Vec<u8> = data.iter().enumerate().map(|(i, b)| b ^ ERROR_LOG_KEY[i % 16]).collect();
    let marker = b"######";
    let session_start = rfind(&plain, marker, usize::MAX)
        .filter(|&last| last > 0)
        .and_then(|last| rfind(&plain, marker, last - 1));
    let session = &plain[session_start.unwrap_or(0)..];
    let tail = &session[session.len().saturating_sub(MAX_LOG)..];
    Some(latin1(tail))
}

fn last_capture(text: Option<&str>, pattern: &str) -> Option<String> {
    let regex = Regex::new(pattern).ok()?;
    regex.captures_iter(text?).last().map(|capture| capture[1].to_string())
}

fn short_md5(file: &Path) -> Option<String> {
    let data = std::fs::read(file).ok()?;
    Some(hex::encode(Md5::digest(&data))[..8].to_string())
}

fn exit_code_hex(code: u32) -> String {
    format!("0x{code:08X}")
}

// stack_*.txt / crash_*.dmp novos (gravados depois do início do jogo) e ainda não mostrados.
fn find_crash(started_at: i64) -> Option<Crash> {
    struct Fresh {
        name: String,
        kind: String,
        stamp: String,
        mtime: i64,
        size: u64,
    }
    let dir = dirs::game_dir().join("ErrorLog");
    let name_regex = Regex::new(r"(?i)^(stack|crash)_(\d{8}_\d{4,6})\.(txt|dmp)$").ok()?;
    let mut seen: Vec<String> = store()
        .get("crashReportsSeen")
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();

    let mut fresh = Vec::new();
    for entry in std::fs::read_dir(&dir).ok()?.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(capture) = name_regex.captures(&name) else { continue };
        if seen.contains(&name) {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        if mtime >= started_at - START_SLACK_MS {
            fresh.push(Fresh {
                kind: capture[1].to_lowercase(),
                stamp: capture[2].to_string(),
                name,
                mtime,
                size: meta.len(),
            });
        }
    }
    if fresh.is_empty() {
        return None;
    }

    // O crash mais recente; stack e dump do mesmo crash têm o mesmo carimbo de data.
    fresh.sort_by(|a, b| b.mtime.cmp(&a.mtime));
    let stamp = fresh[0].stamp.clone();
    let stack = fresh.iter().find(|f| f.kind == "stack" && f.stamp == stamp);
    let dump = fresh.iter().find(|f| f.kind == "crash" && f.stamp == stamp);

    // Marca todos como vistos: um crash só é tratado uma vez.
    seen.extend(fresh.iter().map(|f| f.name.clone()));
    let skip = seen.len().saturating_sub(200);
    store().set("crashReportsSeen", json!(seen[skip..]));

    let crashed_at = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(fresh[0].mtime)
        .map(|t| t.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string())
        .unwrap_or_default();
    Some(Crash {
        dir,
        crashed_at,
        stack_file: stack.map(|f| f.name.clone()),
        dump_file: dump.map(|f| f.name.clone()),
        dump_size: dump.map(|f| f.size).unwrap_or(0),
        pid: 0,
        exit_code: 0,
    })
}

// Lê tudo que vai no relatório.
fn collect(crash: &Crash, launcher_version: &str) -> Map<String, Value> {
    let dir = &crash.dir;
    let stack_text = crash.stack_file.as_ref().and_then(|name| read_tail(&dir.join(name), 4000));
    let error_log = read_error_log(&dir.join("Error.log"));
    let (stack, log) = (stack_text.as_deref(), error_log.as_deref());

    let address = last_capture(stack, r"(?i)\[Exception Address\]\s*(0x[0-9a-f]+)");
    let code = last_capture(stack, r"(?i)\[Exception Code\]\s*([A-Z0-9_]+)");
    // Os campos do Error.log usam tabulações antes do ":"
    let map = last_capture(log, r"OpenWorld\(\) <(?:start|end)>\s*:\s*(\d+)");
    let gpu = last_capture(log, r"(?m)^\s*Render\s*: ([^\r\n]+)");
    let cpu_from_log = last_capture(log, r"(?m)^\s*CPU Name\s*: ([^\r\n]+)");

    let game_dir = dirs::game_dir();
    let dlls: Vec<String> = CLIENT_DLLS
        .iter()
        .filter_map(|name| short_md5(&game_dir.join(name)).map(|md5| format!("{}={md5}", name.trim_end_matches(".dll"))))
        .collect();

    let payload = json!({
        "reportKey": uuid::Uuid::new_v4().to_string(),
        "characterName": anticheat::character_of_pid(crash.pid),
        "crashedAt": crash.crashed_at,
        "exitCode": exit_code_hex(crash.exit_code),
        "exceptionCode": code,
        "exceptionAddress": address,
        "mapId": map.and_then(|m| m.parse::<i64>().ok()),
        "launcherVersion": launcher_version,
        "dllVersions": if dlls.is_empty() { Value::Null } else { json!(dlls.join("; ")) },
        "osVersion": sys::os_version(),
        "cpu": cpu_from_log.map(|c| c.trim().to_string()).or_else(sys::cpu_model),
        "gpu": gpu.map(|g| g.trim().to_string()),
        "ramMb": sys::total_memory_mb(),
        "hostname": sys::hostname(),
        "hardwareId": anticheat::hardware_id(),
        "stackText": stack_text,
        "errorLog": error_log,
        "customLog": read_tail(&dir.join("AsgardCustom.log"), MAX_LOG),
        "luaLog": read_tail(&dir.join("AsgardLua.log"), MAX_LUA_LOG)
    });
    match payload {
        Value::Object(map) => map,
        _ => Map::new(),
    }
}

// Dump compactado (gzip, base64); grande demais, o relatório vai sem ele
fn read_dump(crash: &Crash, payload: &mut Map<String, Value>) {
    let Some(name) = &crash.dump_file else { return };
    if crash.dump_size == 0 {
        return;
    }
    let data = match std::fs::read(crash.dir.join(name)) {
        Ok(data) => data,
        Err(error) => {
            log_event("error", format!("[CrashReport] Falha ao ler o dump: {error}"));
            return;
        }
    };
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::best());
    let gz = match encoder.write_all(&data).and_then(|_| encoder.finish()) {
        Ok(gz) => gz,
        Err(error) => {
            log_event("error", format!("[CrashReport] Falha ao compactar o dump: {error}"));
            return;
        }
    };
    if gz.len() > MAX_DUMP_GZ {
        log_event("warning", format!("[CrashReport] Dump grande demais ({} bytes compactado), vai sem ele", gz.len()));
        return;
    }
    payload.insert("dumpName".into(), json!(name));
    payload.insert("dumpSize".into(), json!(crash.dump_size));
    payload.insert("dumpGz".into(), json!(base64::engine::general_purpose::STANDARD.encode(gz)));
}

async fn build_payload(crash: Crash) -> Map<String, Value> {
    let version = crate::app().package_info().version.to_string();
    tokio::task::spawn_blocking(move || {
        let mut payload = collect(&crash, &version);
        read_dump(&crash, &mut payload);
        payload
    })
    .await
    .unwrap_or_default()
}

async fn post(body: &Map<String, Value>) -> Result<(), String> {
    let mut request = updater::http()
        .post(config::crash_report_url())
        .timeout(Duration::from_secs(60))
        .json(body);
    if !config::CRASH_TOKEN.is_empty() {
        request = request.header("x-crash-token", config::CRASH_TOKEN);
    }
    request
        .send()
        .await
        .and_then(|response| response.error_for_status())
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// Chamado quando um main.exe aberto pelo launcher fecha.
pub async fn on_game_exit(pid: u32, exit_code: u32, started_at: i64) {
    // O cliente pode terminar de gravar o dump logo depois do fim do processo.
    tokio::time::sleep(Duration::from_secs(2)).await;
    let Ok(Some(mut crash)) = tokio::task::spawn_blocking(move || find_crash(started_at)).await else {
        return;
    };
    crash.pid = pid;
    crash.exit_code = exit_code;
    log_event(
        "warning",
        format!(
            "[CrashReport] Crash do jogo (PID {pid}, código {}): {}",
            exit_code_hex(exit_code),
            crash.stack_file.clone().or(crash.dump_file.clone()).unwrap_or_default()
        ),
    );

    let payload = build_payload(crash.clone()).await;
    match post(&payload).await {
        Ok(()) => {
            let key = payload.get("reportKey").and_then(Value::as_str).unwrap_or("");
            log_event("info", format!("[CrashReport] Relatório enviado automaticamente ({key})"));
        }
        Err(error) => {
            log_event("error", format!("[CrashReport] Falha no envio automático: {error}"));
            // Falha no envio automático: mostra a janela para o jogador tentar manualmente.
            QUEUE.lock().unwrap().push_back(crash);
            show_next();
        }
    }
}

// Abre a janela do próximo crash da fila (vários clientes abertos)
fn show_next() {
    let app = crate::app();
    if app.get_webview_window(WINDOW_LABEL).is_some() {
        return;
    }
    let Some(crash) = QUEUE.lock().unwrap().pop_front() else { return };
    *CURRENT.lock().unwrap() = Some(Current { crash, payload: None });

    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let built = WebviewWindowBuilder::new(&handle, WINDOW_LABEL, WebviewUrl::App("crash-report.html".into()))
            .title("AsgardMU")
            .inner_size(460.0, 430.0)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .always_on_top(true)
            .decorations(false)
            .center()
            .build();
        match built {
            Ok(window) => {
                if let Ok(hwnd) = window.hwnd() {
                    sys::square_corners(hwnd.0 as isize);
                }
                window.on_window_event(|event| {
                    if let tauri::WindowEvent::Destroyed = event {
                        *CURRENT.lock().unwrap() = None;
                        tauri::async_runtime::spawn(async {
                            tokio::time::sleep(Duration::from_millis(500)).await;
                            show_next();
                        });
                    }
                });
                let _ = window.set_focus();
            }
            Err(error) => log_event("error", format!("[CrashReport] Falha ao abrir a janela: {error}")),
        }
    });
}

// IPC crash-report:get. Os textos vêm de ui/shared/i18n.js (chaves crash.*).
pub fn view() -> Value {
    let current = CURRENT.lock().unwrap();
    match current.as_ref() {
        Some(current) => json!({
            "language": i18n::language(),
            "character": anticheat::character_of_pid(current.crash.pid),
            "crashedAt": current.crash.crashed_at,
            "hasDump": current.crash.dump_file.is_some()
        }),
        None => Value::Null,
    }
}

// IPC crash-report:send (botão "Enviar"). Retorna { ok, error }.
pub async fn send(comment: Option<String>) -> Value {
    let (crash, saved) = match CURRENT.lock().unwrap().as_ref() {
        Some(current) => (current.crash.clone(), current.payload.clone()),
        None => return json!({ "ok": false, "error": "no report" }),
    };
    // O mesmo reportKey em uma nova tentativa: o site não grava duas vezes.
    let payload = match saved {
        Some(payload) => payload,
        None => {
            let payload = build_payload(crash).await;
            if let Some(current) = CURRENT.lock().unwrap().as_mut() {
                current.payload = Some(payload.clone());
            }
            payload
        }
    };
    let mut body = payload.clone();
    body.insert("comment".into(), json!(comment.map(|c| c.chars().take(1000).collect::<String>())));
    match post(&body).await {
        Ok(()) => {
            let key = payload.get("reportKey").and_then(Value::as_str).unwrap_or("");
            log_event("info", format!("[CrashReport] Relatório enviado ({key})"));
            json!({ "ok": true })
        }
        Err(error) => {
            log_event("error", format!("[CrashReport] Falha ao enviar: {error}"));
            json!({ "ok": false, "error": error })
        }
    }
}

// IPC crash-report:close
pub fn close_window() {
    if let Some(window) = crate::app().get_webview_window(WINDOW_LABEL) {
        let _ = window.close();
    }
}

// Só em depuração: abre a janela com um crash de teste (nada é lido do disco até "Enviar")
#[cfg(debug_assertions)]
pub fn debug_show() {
    QUEUE.lock().unwrap().push_back(Crash {
        dir: dirs::game_dir().join("ErrorLog"),
        crashed_at: chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string(),
        stack_file: None,
        dump_file: None,
        dump_size: 0,
        pid: 0,
        exit_code: 0xC0000005,
    });
    show_next();
}

#[cfg(test)]
mod tests {
    use super::*;

    // Lê a pasta ErrorLog do jogo deste computador (nada é enviado)
    #[test]
    fn collect_reads_the_game_logs() {
        let crash = Crash {
            dir: dirs::game_dir().join("ErrorLog"),
            crashed_at: String::new(),
            stack_file: None,
            dump_file: None,
            dump_size: 0,
            pid: 0,
            exit_code: 0xC0000005,
        };
        let payload = collect(&crash, "0.0.0");
        for (key, value) in &payload {
            let text = value.to_string();
            println!("{key}: {} bytes: {}", text.len(), text.chars().take(110).collect::<String>());
        }
        assert_eq!(payload["exitCode"], "0xC0000005");
    }
}
