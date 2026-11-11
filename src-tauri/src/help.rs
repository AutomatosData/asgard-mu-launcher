// Atalho F1 do jogo: abre o whitepaper do site numa janela do launcher.
//
// Uma thread observa a janela em primeiro plano. O launcher registra o F1 só enquanto o
// jogo está em foco, para não roubar a tecla de outros programas. Com a janela do
// whitepaper em foco, F1 ou Esc fecham a janela.
use crate::logger::log_event;
use crate::{config, sys};
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::time::Duration;
use tauri::webview::NewWindowResponse;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutState};

const WINDOW_LABEL: &str = "help";
const GAME_PROCESS: &str = "main";

static WATCHING: AtomicBool = AtomicBool::new(false);
static HELP_HWND: AtomicIsize = AtomicIsize::new(0);

fn f1() -> Shortcut {
    Shortcut::new(None, Code::F1)
}

fn escape() -> Shortcut {
    Shortcut::new(None, Code::Escape)
}

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|_app, shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            if shortcut == &f1() {
                // Fora do laço de eventos: criar janela dentro do tratador pode travar
                std::thread::spawn(toggle_window);
            } else if shortcut == &escape() {
                std::thread::spawn(close_window);
            }
        })
        .build()
}

fn set_shortcut(shortcut: Shortcut, enabled: bool) {
    let shortcuts = crate::app().global_shortcut();
    let registered = shortcuts.is_registered(shortcut);
    if enabled && !registered {
        if shortcuts.register(shortcut).is_err() {
            log_event("warning", "[HelpHotkey] A tecla já está em uso por outro programa");
        }
    } else if !enabled && registered {
        let _ = shortcuts.unregister(shortcut);
    }
}

// Começa a observar a janela em primeiro plano (uma vez; continua até o launcher fechar)
pub fn start() {
    if WATCHING.swap(true, Ordering::SeqCst) {
        return;
    }
    log_event("info", format!("[HelpHotkey] Atalho F1 ativo para {}", config::help_url()));
    std::thread::spawn(|| {
        let mut last = (-1isize, 0isize);
        loop {
            let hwnd = sys::foreground_hwnd();
            let help_hwnd = HELP_HWND.load(Ordering::SeqCst);
            if (hwnd, help_hwnd) != last {
                last = (hwnd, help_hwnd);
                let (_, process) = sys::foreground_window();
                let game = process.eq_ignore_ascii_case(GAME_PROCESS);
                let help = hwnd != 0 && hwnd == help_hwnd;
                set_shortcut(f1(), game || help);
                set_shortcut(escape(), help);
            }
            std::thread::sleep(Duration::from_millis(200));
        }
    });
}

fn close_window() {
    if let Some(window) = crate::app().get_webview_window(WINDOW_LABEL) {
        let _ = window.close();
    }
}

fn toggle_window() {
    let app = crate::app();
    if app.get_webview_window(WINDOW_LABEL).is_some() {
        close_window();
        return;
    }
    let Ok(url) = config::help_url().parse() else { return };
    let (area_width, area_height) = sys::work_area_size().unwrap_or((1280, 720));
    let width = (area_width as f64 * 0.85).round().min(1200.0);
    let height = (area_height as f64 * 0.85).round().min(850.0);

    let built = WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::External(url))
        .title("AsgardMU - Whitepaper")
        .inner_size(width, height)
        .always_on_top(true)
        .center()
        // Links que abrem nova aba vão para o navegador padrão.
        .on_new_window(|url, _features| {
            let _ = open::that(url.as_str());
            NewWindowResponse::Deny
        })
        .build();
    match built {
        Ok(window) => {
            if let Ok(hwnd) = window.hwnd() {
                HELP_HWND.store(hwnd.0 as isize, Ordering::SeqCst);
            }
            window.on_window_event(|event| {
                if let tauri::WindowEvent::Destroyed = event {
                    HELP_HWND.store(0, Ordering::SeqCst);
                }
            });
            let _ = window.set_focus();
        }
        Err(error) => log_event("error", format!("[HelpHotkey] Falha ao abrir {}: {error}", config::help_url())),
    }
}

// Só em depuração: o mesmo que apertar F1 com o jogo em foco
#[cfg(debug_assertions)]
pub fn debug_toggle() {
    start();
    toggle_window();
}
