// AsgardMU Launcher (Rust + Tauri).
//
// A interface fica em ui/ (HTML, CSS e JavaScript). ui/scripts/bridge.js liga os canais
// usados pela interface (ipcRenderer.invoke('get-config')) aos comandos abaixo
// (get_config): o nome do comando é o nome do canal com "_" no lugar de "-" e ":".
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod anticheat;
mod config;
mod crash;
mod data;
mod dirs;
mod game;
mod help;
mod i18n;
mod language_pack;
mod logger;
mod options;
mod self_update;
mod store;
mod sys;
mod updater;

use logger::log_event;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use store::store;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent, Wry,
};
use tauri_plugin_notification::NotificationExt;

const MAIN: &str = "main";
const SITE: &str = "site";
const TOAST: &str = "toast";
const WINDOW_WIDTH: f64 = 800.0;
const WINDOW_HEIGHT: f64 = 500.0;
// Tempo de um aviso na tela (o mesmo de ui/toast.html)
const TOAST_MS: u64 = 5000;

static APP: OnceLock<AppHandle> = OnceLock::new();

pub fn app() -> &'static AppHandle {
    APP.get().expect("app handle")
}

// ===== Estado =====

struct GameDataState {
    is_installing: bool,
    is_installed: bool,
    can_update: bool,
    installation_progress: Value,
}

static GAME_DATA: Mutex<GameDataState> = Mutex::new(GameDataState {
    is_installing: false,
    is_installed: false,
    can_update: false,
    installation_progress: Value::Null,
});

struct TrayItems {
    show: MenuItem<Wry>,
    launch: MenuItem<Wry>,
    ping: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}

static TRAY_ITEMS: Mutex<Option<TrayItems>> = Mutex::new(None);
// Latência do servidor em ms (-1 = sem conexão)
static SERVER_PING: AtomicI64 = AtomicI64::new(-1);

// Webview do site: pronto (página carregada) e escondido por uma janela modal da interface
static SITE_READY: AtomicBool = AtomicBool::new(false);
static SITE_COVERED: AtomicBool = AtomicBool::new(false);
static TOAST_SEQ: AtomicU64 = AtomicU64::new(0);

// ===== Bandeja e notificações =====

fn ping_label() -> String {
    match SERVER_PING.load(Ordering::SeqCst) {
        ms if ms >= 0 => i18n::t("tray.ping").replace("{ms}", &ms.to_string()),
        _ => i18n::t("tray.pingOffline").to_string(),
    }
}

// Atualiza os textos do menu da bandeja no idioma atual
pub fn refresh_tray() {
    if let Some(items) = TRAY_ITEMS.lock().unwrap().as_ref() {
        let _ = items.show.set_text(i18n::t("tray.show"));
        let _ = items.launch.set_text(i18n::t("tray.launch"));
        let _ = items.ping.set_text(ping_label());
        let _ = items.quit.set_text(i18n::t("tray.quit"));
    }
}

pub fn notify(title: &str, body: &str) {
    let _ = app().notification().builder().title(title).body(body).show();
}

// A janela principal tem dois webviews (interface e site): get_webview_window(MAIN) deixa
// de achar a janela depois que o site abre. Use get_window(MAIN) e get_webview(MAIN).
fn show_main_window() {
    if let Some(window) = app().get_window(MAIN) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn hide_to_tray() {
    if let Some(window) = app().get_window(MAIN) {
        let _ = window.hide();
    }
    if let Some(toast) = app().get_webview_window(TOAST) {
        let _ = toast.hide();
    }
    notify("AsgardMU", i18n::t("tray.minimized"));
}

// O jogo continua aberto quando o launcher fecha
fn quit() {
    app().exit(0);
}

fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", i18n::t("tray.show"), true, None::<&str>)?;
    let launch = MenuItem::with_id(app, "launch", i18n::t("tray.launch"), true, None::<&str>)?;
    let ping = MenuItem::with_id(app, "ping", ping_label(), false, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", i18n::t("tray.quit"), true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &launch, &ping, &PredefinedMenuItem::separator(app)?, &quit_item])?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("AsgardMU")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main_window(),
            "launch" => {
                let _ = app.emit_to(MAIN, "launch-game-from-tray", Value::Null);
            }
            "quit" => quit(),
            _ => {}
        })
        .on_tray_icon_event(|_tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main_window();
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    *TRAY_ITEMS.lock().unwrap() = Some(TrayItems { show, launch, ping, quit: quit_item });
    Ok(())
}

// Mede a latência com o servidor abrindo uma conexão TCP (ms ou -1 se falhar)
async fn measure_server_ping() -> i64 {
    let start = Instant::now();
    let address = (config::GAME_SERVER_HOST, config::GAME_SERVER_PORT);
    match tokio::time::timeout(Duration::from_secs(3), tokio::net::TcpStream::connect(address)).await {
        Ok(Ok(_)) => start.elapsed().as_millis() as i64,
        _ => -1,
    }
}

fn start_server_ping_monitor() {
    tauri::async_runtime::spawn(async {
        loop {
            let ping = measure_server_ping().await;
            if SERVER_PING.swap(ping, Ordering::SeqCst) != ping {
                refresh_tray();
            }
            tokio::time::sleep(Duration::from_millis(config::PING_INTERVAL_MS)).await;
        }
    });
}

// ===== Webview do site e avisos =====

// O site fica em um webview filho por cima da interface. Ele aparece só com a página
// carregada e sem janela modal aberta (um webview filho cobre o HTML da interface).
fn update_site_visibility() {
    if let Some(site) = app().get_webview(SITE) {
        if SITE_READY.load(Ordering::SeqCst) && !SITE_COVERED.load(Ordering::SeqCst) {
            let _ = site.show();
        } else {
            let _ = site.hide();
        }
    }
}

// Põe a janela dos avisos em cima da janela principal
fn place_toast_window() {
    let (Some(main), Some(toast)) = (app().get_window(MAIN), app().get_webview_window(TOAST)) else {
        return;
    };
    if let (Ok(position), Ok(size)) = (main.inner_position(), main.inner_size()) {
        let _ = toast.set_position(position);
        let _ = toast.set_size(size);
    }
}

fn create_toast_window(app: &AppHandle, main: &tauri::WebviewWindow) -> tauri::Result<()> {
    // Janela transparente por cima da principal: os avisos ficam na frente do site.
    // Ela não recebe o mouse nem o foco.
    let toast = WebviewWindowBuilder::new(app, TOAST, WebviewUrl::App("toast.html".into()))
        .title("AsgardMU")
        .inner_size(WINDOW_WIDTH, WINDOW_HEIGHT)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .resizable(false)
        .skip_taskbar(true)
        .focused(false)
        .focusable(false)
        .visible(false)
        .owner(main)?
        .build()?;
    if let Ok(hwnd) = toast.hwnd() {
        sys::square_corners(hwnd.0 as isize);
    }
    let _ = toast.set_ignore_cursor_events(true);
    Ok(())
}

// ===== Comandos da interface =====

type Payload = Option<Value>;

#[tauri::command]
fn get_app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

// Resoluções na ordem e com o filtro do jogo (DevModeIndex = posição na lista).
// O jogo não tem tabela fixa: o DevModeIndex do LauncherOption.if é a posição na lista de
// modos do monitor principal (EnumDisplaySettings, na ordem do Windows), sem repetir
// tamanhos e só com largura >= 800 e proporção exata 4:3, 16:9 ou 16:10.
#[tauri::command]
fn get_display_modes() -> Value {
    static CACHE: OnceLock<Vec<Value>> = OnceLock::new();
    let modes = CACHE.get_or_init(|| {
        let mut seen = std::collections::HashSet::new();
        let mut modes = Vec::new();
        for (width, height) in sys::display_mode_sizes() {
            if !seen.insert((width, height)) {
                continue;
            }
            let ratio = if width * 3 == height * 4 {
                "4:3"
            } else if width * 9 == height * 16 {
                "16:9"
            } else if width * 10 == height * 16 {
                "16:10"
            } else {
                continue;
            };
            if width >= 800 {
                modes.push(json!({ "index": modes.len(), "width": width, "height": height, "ratio": ratio }));
            }
        }
        modes
    });
    match sys::work_area_size() {
        Some((width, height)) => json!({ "success": true, "modes": modes, "workArea": { "width": width, "height": height } }),
        None => json!({ "success": true, "modes": modes }),
    }
}

#[tauri::command]
fn get_game_settings() -> Value {
    json!({ "success": true, "settings": options::read_game_settings() })
}

#[tauri::command]
fn save_game_settings(payload: Payload) -> Value {
    json!({ "success": options::write_game_settings(&payload.unwrap_or(Value::Null)) })
}

#[tauri::command]
fn get_launcher_options() -> Value {
    let settings = options::convert_to_game_settings(&options::read_launcher_options());
    json!({ "success": true, "settings": settings })
}

#[tauri::command]
fn save_launcher_options(payload: Payload) -> Value {
    let settings = payload.unwrap_or(Value::Null);
    let success = options::write_launcher_options(&options::convert_from_game_settings(&settings));
    // Idioma do menu da bandeja e das notificações
    if let (true, Some(lang)) = (success, settings.get("langSelection").and_then(Value::as_str)) {
        i18n::set_language(lang);
        refresh_tray();
    }
    json!({ "success": success })
}

fn detected_characters() -> Value {
    let now = chrono::Utc::now().timestamp_millis();
    let genericos = ["main", "mu", "game", "client", "launcher"];
    let list: Vec<Value> = anticheat::detect_characters()
        .into_iter()
        .filter(|(name, _)| !genericos.contains(&name.to_lowercase().as_str()))
        .map(|(name, pid)| json!({ "name": name, "processId": pid, "lastSeen": now }))
        .collect();
    json!(list)
}

#[tauri::command]
fn get_detected_characters() -> Value {
    json!({ "success": true, "characters": detected_characters() })
}

#[tauri::command]
fn refresh_character_detection() -> Value {
    json!({ "success": true, "characters": detected_characters() })
}

#[tauri::command]
fn test_detection() -> Value {
    json!({ "success": true, "characters": detected_characters(), "isMonitoring": true })
}

// A lista de personagens é lida na hora do pedido: não há o que iniciar ou parar
#[tauri::command]
fn start_character_monitoring() -> Value {
    json!({ "success": true })
}

#[tauri::command]
fn stop_character_monitoring() -> Value {
    json!({ "success": true })
}

#[tauri::command]
fn open_devtools(_app: AppHandle) -> Value {
    #[cfg(debug_assertions)]
    if let Some(window) = _app.get_webview(MAIN) {
        window.open_devtools();
    }
    json!({ "success": true })
}

#[tauri::command]
fn get_game_directory() -> Value {
    json!({ "success": true, "gamePath": dirs::game_dir().to_string_lossy() })
}

// Settings.ini do jogo: ReduceMemory, Fog e TronEffects
fn read_settings_ini_values() -> Value {
    let path = dirs::game_dir().join("Settings.ini");
    let mut performance = serde_json::Map::new();
    if let Ok(content) = std::fs::read_to_string(path) {
        for line in content.lines() {
            let line = line.trim();
            for key in ["ReduceMemory", "Fog", "TronEffects"] {
                if let Some(value) = line.strip_prefix(key).and_then(|rest| rest.strip_prefix('=')) {
                    performance.insert(key.to_string(), json!(value.trim().parse::<i64>().unwrap_or(0)));
                }
            }
        }
    }
    Value::Object(performance)
}

#[tauri::command]
fn read_settings_ini() -> Value {
    json!({ "success": true, "performance": read_settings_ini_values() })
}

#[tauri::command]
fn write_settings_ini(payload: Payload) -> Value {
    let perf = payload.unwrap_or(Value::Null);
    let path = dirs::game_dir().join("Settings.ini");
    let content = std::fs::read_to_string(&path).unwrap_or_default();
    let mut lines: Vec<String> = content.lines().map(str::to_string).collect();
    for key in ["ReduceMemory", "Fog", "TronEffects"] {
        let enabled = match perf.get(key) {
            Some(Value::Bool(b)) => *b,
            Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0) != 0.0,
            Some(Value::String(s)) => s.trim().parse::<f64>().unwrap_or(0.0) != 0.0,
            _ => false,
        };
        let line = format!("{key}={}", enabled as u8);
        let existing = lines.iter_mut().find(|l| {
            l.trim().strip_prefix(key).map(|rest| rest.trim_start().starts_with('=')).unwrap_or(false)
        });
        match existing {
            Some(found) => *found = line,
            None => lines.push(line),
        }
    }
    match std::fs::write(&path, lines.join("\n") + "\n") {
        Ok(()) => json!({ "success": true }),
        Err(error) => {
            log_event("error", format!("Failed to write Settings.ini: {error}"));
            json!({ "success": false, "error": error.to_string() })
        }
    }
}

#[tauri::command]
fn get_config() -> Value {
    let mut config = store().all();
    let performance = read_settings_ini_values();
    if performance.as_object().map(|map| !map.is_empty()).unwrap_or(false) {
        let mut merged = config.get("performance").and_then(Value::as_object).cloned().unwrap_or_default();
        merged.extend(performance.as_object().cloned().unwrap_or_default());
        config.insert("performance".into(), Value::Object(merged));
    }
    Value::Object(config)
}

#[tauri::command]
fn save_config(payload: Payload) -> Value {
    if let Some(Value::Object(config)) = payload {
        for (key, value) in config {
            store().set(&key, value);
        }
    }
    json!({ "success": true })
}

#[tauri::command]
fn minimize_to_tray() -> Value {
    hide_to_tray();
    json!({ "success": true })
}

#[tauri::command]
fn minimize_window() {
    hide_to_tray();
}

#[tauri::command]
fn close_app() -> Value {
    quit();
    json!({ "success": true })
}

#[tauri::command]
fn close_window() {
    quit();
}

#[tauri::command]
fn kill_game_processes() -> Value {
    game::kill_all();
    json!({ "success": true })
}

// "Contas conectadas": quantos main.exe estão abertos
#[tauri::command]
fn get_connected_accounts() -> Value {
    json!({ "count": game::running_count() })
}

#[tauri::command]
fn check_data_folder() -> Value {
    let game_dir = dirs::game_dir();
    json!({ "success": true, "exists": data::game_exists(&game_dir), "info": data::data_folder_info(&game_dir) })
}

#[tauri::command]
fn get_data_folder_info() -> Value {
    json!({ "success": true, "info": data::data_folder_info(&dirs::game_dir()) })
}

#[tauri::command]
fn get_game_data_state() -> Value {
    let state = GAME_DATA.lock().unwrap();
    json!({
        "success": true,
        "state": {
            "isInstalling": state.is_installing,
            "isInstalled": state.is_installed,
            "canUpdate": state.can_update,
            "installationProgress": state.installation_progress
        }
    })
}

#[tauri::command]
fn can_perform_update() -> Value {
    let state = GAME_DATA.lock().unwrap();
    if state.is_installing {
        json!({ "success": false, "canUpdate": false, "reason": "installing", "message": "Aguardando download do cliente..." })
    } else if !state.is_installed {
        json!({ "success": false, "canUpdate": false, "reason": "not-installed", "message": "Game data not installed" })
    } else {
        json!({ "success": true, "canUpdate": true, "message": "Pronto para fazer update" })
    }
}

// Primeira instalação: baixa o cliente completo (a janela chama quando falta o main.exe)
#[tauri::command]
async fn install_game_data(app: AppHandle) -> Value {
    {
        let mut state = GAME_DATA.lock().unwrap();
        if state.is_installing {
            return json!({ "success": false, "error": "Installation already running" });
        }
        // Em desenvolvimento a pasta do jogo é a do projeto: não baixar 2 GB nela
        if !dirs::is_packaged() {
            log_event("warning", "Client download skipped in development - set gamePath in config.json to a client folder");
            return json!({ "success": false, "error": "Client download is disabled in development" });
        }
        state.is_installing = true;
    }

    let game_dir = dirs::game_dir();
    log_event("info", format!("Game client installation started in {}", game_dir.display()));
    // Reinstalação: os arquivos ocultos não podem ser sobrescritos
    dirs::set_game_exe_hidden(&game_dir, false);
    dirs::set_game_files_hidden(false);
    let result = data::ensure_data_folder(game_dir, |progress| {
        GAME_DATA.lock().unwrap().installation_progress = progress.clone();
        let _ = app.emit_to(MAIN, "data-installation-progress", progress);
    })
    .await;

    let mut state = GAME_DATA.lock().unwrap();
    state.is_installing = false;
    match result {
        Ok(()) => {
            state.is_installed = true;
            state.can_update = true;
            dirs::set_game_files_hidden(true);
            log_event("info", "Game client installed");
            json!({ "success": true })
        }
        Err(error) => {
            log_event("error", format!("Failed to install game data: {}", error.message));
            json!({ "success": false, "error": error.message, "code": error.code, "params": error.params })
        }
    }
}

// Launcher novo publicado: baixa o instalador, abre em modo silencioso e fecha o launcher
#[tauri::command]
async fn check_launcher_update(app: AppHandle) -> Value {
    let current = app.package_info().version.to_string();
    let emitter = app.clone();
    let result = self_update::check(&current, move |progress| {
        let mut event = json!({ "type": "download-progress", "file": "AsgardMU-Setup.exe" });
        if let (Some(target), Some(source)) = (event.as_object_mut(), progress.as_object()) {
            target.extend(source.clone());
        }
        let _ = emitter.emit_to(MAIN, "update-progress", event);
    })
    .await;

    if result.get("updating").and_then(Value::as_bool) == Some(true) {
        // O instalador espera o AsgardMU.exe fechar antes de copiar os arquivos
        tauri::async_runtime::spawn(async {
            tokio::time::sleep(Duration::from_millis(1500)).await;
            quit();
        });
    }
    result
}

#[tauri::command]
async fn check_updates(payload: Payload) -> Value {
    let game_path = payload
        .as_ref()
        .and_then(|p| p.get("gamePath"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| dirs::game_dir().to_string_lossy().to_string());
    updater::check_updates(game_path).await
}

#[tauri::command]
async fn perform_update(app: AppHandle, payload: Payload) -> Value {
    let game_path = payload
        .as_ref()
        .and_then(|p| p.get("gamePath"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    updater::perform_update(game_path, move |progress| {
        let _ = app.emit_to(MAIN, "update-progress", progress);
    })
    .await
}

#[tauri::command]
async fn launch_game() -> Value {
    tokio::task::spawn_blocking(game::launch)
        .await
        .unwrap_or_else(|error| json!({ "success": false, "error": error.to_string() }))
}

#[tauri::command]
fn open_external_url(payload: Payload) {
    if let Some(url) = payload.as_ref().and_then(Value::as_str) {
        if url.starts_with("http://") || url.starts_with("https://") {
            let _ = open::that(url);
        }
    }
}

#[tauri::command]
fn crash_report_get() -> Value {
    crash::view()
}

#[tauri::command]
async fn crash_report_send(payload: Payload) -> Value {
    let comment = payload
        .as_ref()
        .and_then(|p| p.get("comment"))
        .and_then(Value::as_str)
        .map(str::to_string);
    crash::send(comment).await
}

#[tauri::command]
fn crash_report_close() {
    // Fora do tratador do comando: fechar a própria janela dentro dele pode travar
    std::thread::spawn(crash::close_window);
}

// Carrega o site no webview filho. payload = retângulo da área de conteúdo { x, y, width, height }
#[tauri::command]
async fn site_load(app: AppHandle, payload: Payload) -> Value {
    if app.get_webview(SITE).is_some() {
        return json!({ "success": true });
    }
    let rect = payload.unwrap_or(Value::Null);
    let number = |key: &str, default: f64| rect.get(key).and_then(Value::as_f64).unwrap_or(default);
    let (x, y) = (number("x", 0.0), number("y", 36.0));
    let (width, height) = (number("width", WINDOW_WIDTH), number("height", 380.0));

    let url = config::launcher_url();
    // Sem resposta do site: a interface mostra "Falha ao carregar"
    let reachable = updater::http().get(&url).timeout(Duration::from_secs(15)).send().await.is_ok();
    if !reachable {
        log_event("warning", format!("Site not reachable: {url}"));
        let _ = app.emit_to(MAIN, "site-error", Value::Null);
        return json!({ "success": false });
    }

    let Some(main) = app.get_window(MAIN) else {
        return json!({ "success": false });
    };
    let Ok(parsed) = url.parse() else {
        return json!({ "success": false });
    };
    let events = app.clone();
    let builder = WebviewBuilder::new(SITE, WebviewUrl::External(parsed))
        .on_page_load(move |_webview, payload| match payload.event() {
            PageLoadEvent::Started => {
                let _ = events.emit_to(MAIN, "site-loading", Value::Null);
            }
            PageLoadEvent::Finished => {
                SITE_READY.store(true, Ordering::SeqCst);
                update_site_visibility();
                let _ = events.emit_to(MAIN, "site-ready", Value::Null);
            }
        })
        // Links que abrem outra janela (allowpopups do launcher antigo)
        .on_new_window(|_url, _features| NewWindowResponse::Allow);

        match main.add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(width, height)) {
        Ok(site) => {
            // Escondido até a página carregar: embaixo fica o símbolo de carregamento
            let _ = site.hide();
            json!({ "success": true })
        }
        Err(error) => {
            log_event("error", format!("Failed to create the site webview: {error}"));
            let _ = app.emit_to(MAIN, "site-error", Value::Null);
            json!({ "success": false, "error": error.to_string() })
        }
    }
}

// Uma janela modal da interface abriu (true) ou fechou (false)
#[tauri::command]
fn site_set_covered(payload: Payload) {
    SITE_COVERED.store(payload.and_then(|v| v.as_bool()).unwrap_or(false), Ordering::SeqCst);
    update_site_visibility();
}

// Aviso na tela: payload = { message, type }
#[tauri::command]
fn toast_show(app: AppHandle, payload: Payload) {
    let Some(toast) = app.get_webview_window(TOAST) else { return };
    let main_visible = app.get_window(MAIN).and_then(|w| w.is_visible().ok()).unwrap_or(false);
    if !main_visible {
        return;
    }
    place_toast_window();
    let _ = toast.show();
    let _ = toast.emit_to(TOAST, "toast", payload.unwrap_or(Value::Null));

    // Esconde a janela quando o último aviso some
    let seq = TOAST_SEQ.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(TOAST_MS + 500)).await;
        if TOAST_SEQ.load(Ordering::SeqCst) == seq {
            if let Some(toast) = app.get_webview_window(TOAST) {
                let _ = toast.hide();
            }
        }
    });
}

// Só em compilação de depuração: roda JavaScript em uma janela do launcher, para testar a
// interface sem mouse. Grave o script em %TEMP%/asgard-eval-<janela>.js (main, toast, crash).
#[cfg(debug_assertions)]
fn start_debug_eval() {
    std::thread::spawn(|| loop {
        for label in [MAIN, TOAST, "crash"] {
            let path = std::env::temp_dir().join(format!("asgard-eval-{label}.js"));
            if let Ok(script) = std::fs::read_to_string(&path) {
                let _ = std::fs::remove_file(&path);
                // get_webview: a janela principal tem dois webviews (interface e site)
                if let Some(webview) = app().get_webview(label) {
                    let _ = webview.eval(script);
                }
            }
        }
        // %TEMP%/asgard-debug.txt com "help" (janela do F1) ou "crash" (janela de crash)
        let path = std::env::temp_dir().join("asgard-debug.txt");
        if let Ok(command) = std::fs::read_to_string(&path) {
            let _ = std::fs::remove_file(&path);
            match command.trim() {
                "help" => help::debug_toggle(),
                "crash" => crash::debug_show(),
                "tray" => hide_to_tray(),
                "show" => show_main_window(),
                _ => {}
            }
        }
        std::thread::sleep(Duration::from_millis(300));
    });
}

// ===== Início =====

fn setup(tauri_app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = tauri_app.handle().clone();
    let _ = APP.set(handle.clone());
    log_event("info", "AsgardMU started");

    // Pasta do jogo limpa: DLLs, Data e ErrorLog ocultos
    dirs::set_game_files_hidden(true);

    // Idioma salvo, para o menu da bandeja e as notificações
    let language = options::current_language();
    i18n::set_language(&language);
    // Guarda o idioma antes que launch-game grave o índice do cliente no LauncherOption.if
    if !store().has("gameLanguage") {
        store().set("gameLanguage", json!(language));
    }
    if !store().has("gamePath") {
        store().set("gamePath", json!(dirs::game_dir().to_string_lossy()));
    }

    // Com o main.exe na pasta, a interface verifica os patches; sem ele, baixa o cliente
    {
        let installed = data::game_exists(&dirs::game_dir());
        let mut state = GAME_DATA.lock().unwrap();
        state.is_installed = installed;
        state.can_update = installed;
        log_event("info", if installed { "Game data folder already exists" } else { "Game client not found - it will be downloaded" });
    }

    let main = WebviewWindowBuilder::new(tauri_app, MAIN, WebviewUrl::App("index.html".into()))
        .title("AsgardMU")
        .inner_size(WINDOW_WIDTH, WINDOW_HEIGHT)
        .resizable(false)
        .maximizable(false)
        .decorations(false)
        .center()
        .visible(false)
        .on_page_load(|window, payload| {
            if payload.event() == PageLoadEvent::Finished {
                let _ = window.show();
                let _ = window.set_focus();
            }
        })
        .build()?;

    if let Ok(hwnd) = main.hwnd() {
        sys::square_corners(hwnd.0 as isize);
    }
    main.on_window_event(|event| match event {
        // Fechar a janela fecha o launcher; o jogo continua aberto
        WindowEvent::CloseRequested { .. } => quit(),
        WindowEvent::Moved(_) => place_toast_window(),
        // Minimizar (barra de tarefas) manda o launcher para a bandeja
        WindowEvent::Resized(_) => {
            if let Some(window) = app().get_window(MAIN) {
                if window.is_minimized().unwrap_or(false) {
                    let _ = window.unminimize();
                    hide_to_tray();
                }
            }
        }
        _ => {}
    });

    if let Err(error) = create_toast_window(&handle, &main) {
        log_event("error", format!("Failed to create the notification window: {error}"));
    }
    create_tray(&handle)?;
    start_server_ping_monitor();
    #[cfg(debug_assertions)]
    start_debug_eval();
    Ok(())
}

fn main() {
    tauri::Builder::default()
        // Uma instância só: a segunda mostra a janela da primeira
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| show_main_window()))
        .plugin(tauri_plugin_notification::init())
        .plugin(help::plugin())
        .setup(setup)
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            get_display_modes,
            get_game_settings,
            save_game_settings,
            get_launcher_options,
            save_launcher_options,
            get_detected_characters,
            refresh_character_detection,
            test_detection,
            start_character_monitoring,
            stop_character_monitoring,
            open_devtools,
            get_game_directory,
            read_settings_ini,
            write_settings_ini,
            get_config,
            save_config,
            minimize_to_tray,
            minimize_window,
            close_app,
            close_window,
            kill_game_processes,
            get_connected_accounts,
            check_data_folder,
            get_data_folder_info,
            get_game_data_state,
            can_perform_update,
            install_game_data,
            check_launcher_update,
            check_updates,
            perform_update,
            launch_game,
            open_external_url,
            crash_report_get,
            crash_report_send,
            crash_report_close,
            site_load,
            site_set_covered,
            toast_show
        ])
        .run(tauri::generate_context!())
        .expect("error while running AsgardMU");
}

// Valores de referência tirados da versão Electron (Node) neste computador.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_token_is_the_same_as_the_dll() {
        assert_eq!(game::launch_token(123456789), "436d035c840c97a4");
        assert_eq!(game::launch_token(-5), "3bfadd264b71691f");
        // GetTickCount em 32 bits com sinal
        assert_eq!(4_000_000_123u64 as u32 as i32, -294967173);
    }

    #[test]
    fn version_compare() {
        assert!(self_update::is_newer("1.2.10", "1.2.9"));
        assert!(self_update::is_newer("2.0.0", "1.0.7"));
        assert!(!self_update::is_newer("1.0.7", "1.0.7"));
        assert!(!self_update::is_newer("1.0.6", "1.0.7"));
    }

    #[test]
    fn manifest_paths_stay_in_the_game_folder() {
        let root = std::path::Path::new(r"C:\Jogo");
        assert_eq!(updater::resolve_game_path(root, "Data/Local/Text.bmd"), Some(root.join("Data").join("Local").join("Text.bmd")));
        assert_eq!(updater::resolve_game_path(root, "Data/../main.exe"), Some(root.join("main.exe")));
        assert_eq!(updater::resolve_game_path(root, "../fora.exe"), None);
        assert_eq!(updater::resolve_game_path(root, "Data/../../fora.exe"), None);
        assert_eq!(updater::resolve_game_path(root, "C:/Windows/x.dll"), None);
        assert_eq!(updater::resolve_game_path(root, "/Windows/x.dll"), None);
    }

    #[test]
    fn machine_info() {
        println!("hardware id: {}", sys::hardware_id());
        println!("os: {} | cpu: {:?} | ram: {} MB | host: {}", sys::os_version(), sys::cpu_model(), sys::total_memory_mb(), sys::hostname());
        println!("modes: {:?}", sys::display_mode_sizes().len());
        println!("work area: {:?}", sys::work_area_size());
        println!("main.exe: {:?}", sys::pids_by_exe("main.exe"));
        assert_eq!(sys::hardware_id().len(), 32);
        assert!(!sys::display_mode_sizes().is_empty());
    }
}
