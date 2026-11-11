// Abre e fecha o main.exe.
//
// O jogo só abre pelo launcher: o launcher passa "-a<código>" junto com o "-k<GetTickCount>"
// e a AsgardCustom.dll (Asgard-Mu-ServerS21/AsgardCustom, LAUNCH) confere o código e a hora.
// Sem eles o main.exe mostra uma mensagem e fecha. O main.exe também fica oculto na pasta.
use crate::logger::log_event;
use crate::{anticheat, config, crash, dirs, help, i18n, language_pack, options, sys};
use serde_json::{json, Value};
use std::os::windows::ffi::OsStrExt;
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::Threading::{
    CreateProcessW, GetExitCodeProcess, WaitForSingleObject, CREATE_NEW_PROCESS_GROUP, DETACHED_PROCESS,
    INFINITE, PROCESS_INFORMATION, STARTUPINFOW,
};

// Mesmo valor de LAUNCH_SECRET na asgard_custom.c
const LAUNCH_SECRET: &str = "eb4b9fe523215110a4a6aea85960cdbc";

// FNV-1a 64 bits de "<segredo>:<tick>", 16 dígitos hex (igual à launch_token da DLL)
pub fn launch_token(tick: i32) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in format!("{LAUNCH_SECRET}:{tick}").bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

pub fn kill_all() {
    log_event("info", format!("Terminating all {} processes...", config::GAME_EXECUTABLE));
    for pid in sys::pids_by_exe(config::GAME_EXECUTABLE) {
        if sys::kill_process(pid) {
            log_event("info", format!("Process terminated (PID: {pid})"));
        }
    }
}

// Jogos abertos ("Contas conectadas")
pub fn running_count() -> usize {
    sys::pids_by_exe(config::GAME_EXECUTABLE).len()
}

// O cliente troca de idioma sozinho (LangManager.xml + pasta do idioma no Lang.mpr e em
// Data/Local); o launcher só grava o idioma escolhido
fn apply_language(game_dir: &std::path::Path) {
    // Desfaz a troca de arquivos das versões antigas do launcher
    language_pack::restore(game_dir);
    let exists = options::file_path().exists();
    let mut file_options = options::read_launcher_options();
    // O idioma pode ter mudado na tecla O do jogo desde que o launcher abriu
    let language = options::current_language();
    i18n::set_language(&language);
    crate::refresh_tray();
    let client = options::client_language(&language);
    let current = match file_options.get("Language") {
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
        None => String::new(),
    };
    // O cliente publicado não traz LauncherOption.if: criar na primeira vez
    if !exists || current != client.index.to_string() {
        file_options.insert("Language".into(), json!(client.index.to_string()));
        options::write_launcher_options(&file_options);
    }
    options::write_registry_string("LangSelection", client.code);
    log_event("info", format!("Game language: {language} (client {}, index {})", client.code, client.index));
}

pub fn launch() -> Value {
    let game_dir = dirs::game_dir();
    let exe_name = config::GAME_EXECUTABLE;
    let launch_path = game_dir.join(exe_name);
    log_event("info", format!("Launch path: {}", launch_path.display()));

    if !launch_path.exists() {
        log_event("error", format!("Game executable not found: {}", launch_path.display()));
        return json!({ "success": false, "error": format!("Game executable not found: {}", launch_path.display()) });
    }
    // A DLL loader (glu32.dll) carrega o Main.dll quando o main.exe abre
    if !game_dir.join(config::GAME_LOADER).exists() {
        log_event("warning", format!("Loader \"{}\" not found; {exe_name} will start without Main.dll (may not connect)", config::GAME_LOADER));
    }

    apply_language(&game_dir);

    // Mesma linha de comando do antigo game.exe: "main.exe -test -k<GetTickCount>", com o
    // tick em 32 bits com sinal (o %d do game.exe). O primeiro item é só o nome do arquivo:
    // a DLL procura "-k" e "-a" na linha inteira e a pasta do jogo pode ter esses textos.
    let tick = sys::tick_count() as u32 as i32;
    let command_line = format!("{exe_name} -test -k{tick} -a{}", launch_token(tick));
    let started_at = chrono::Utc::now().timestamp_millis();

    // O manifesto do main.exe pede administrador. RunAsInvoker abre o jogo sem UAC, com
    // os mesmos direitos do launcher.
    std::env::set_var("__COMPAT_LAYER", "RunAsInvoker");

    let wide = |text: &std::ffi::OsStr| -> Vec<u16> { text.encode_wide().chain(std::iter::once(0)).collect() };
    let application = wide(launch_path.as_os_str());
    let directory = wide(game_dir.as_os_str());
    let mut command: Vec<u16> = wide(std::ffi::OsStr::new(&command_line));
    let startup = STARTUPINFOW { cb: std::mem::size_of::<STARTUPINFOW>() as u32, ..Default::default() };
    let mut info = PROCESS_INFORMATION::default();
    let created = unsafe {
        CreateProcessW(
            PCWSTR(application.as_ptr()),
            Some(PWSTR(command.as_mut_ptr())),
            None,
            None,
            false,
            DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
            None,
            PCWSTR(directory.as_ptr()),
            &startup,
            &mut info,
        )
    };
    if let Err(error) = created {
        log_event("error", format!("Failed to start game process ({exe_name}): {error}"));
        return json!({ "success": false, "error": error.message() });
    }

    let pid = info.dwProcessId;
    log_event("info", format!("Game started with PID: {pid}"));
    dirs::set_game_exe_hidden(&game_dir, true);

    // Espera o jogo fechar: um crash grava ErrorLog\stack_*.txt / crash_*.dmp
    let process = info.hProcess.0 as isize;
    let thread = info.hThread.0 as isize;
    std::thread::spawn(move || {
        let process = windows::Win32::Foundation::HANDLE(process as *mut core::ffi::c_void);
        let mut code = 0u32;
        unsafe {
            let _ = CloseHandle(windows::Win32::Foundation::HANDLE(thread as *mut core::ffi::c_void));
            WaitForSingleObject(process, INFINITE);
            let _ = GetExitCodeProcess(process, &mut code);
            let _ = CloseHandle(process);
        }
        log_event("info", format!("Game process exited with code: {}", code as i32));
        tauri::async_runtime::spawn(crash::on_game_exit(pid, code, started_at));
    });

    // Anti-cheat local e F1 (whitepaper) enquanto o jogo roda
    anticheat::start();
    help::start();

    json!({ "success": true })
}
