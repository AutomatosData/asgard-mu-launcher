// Endereços e nomes fixos do launcher. A interface usa os mesmos valores em
// ui/shared/url-config.js (também lido por tools/release.js): mude nos dois.

pub const BASE_URL: &str = "https://asgardmu.com.br/";

pub const GAME_EXECUTABLE: &str = "main.exe";
// DLL que carrega o Main.dll no main.exe (proxy do glu32.dll)
pub const GAME_LOADER: &str = "glu32.dll";

// ConnectServer: ping do menu da bandeja (uma conexão TCP por minuto)
pub const GAME_SERVER_HOST: &str = "asgardmu.com.br";
pub const GAME_SERVER_PORT: u16 = 44405;
pub const PING_INTERVAL_MS: u64 = 60_000;

pub const GITHUB_OWNER: &str = "AutomatosData";
pub const GITHUB_REPO: &str = "asgard-mu-client";
pub const CURRENT_TAG: &str = "current";
pub const MANIFEST_NAME: &str = "update.json";

// Token igual à variável ANTICHEAT_TOKEN / CRASH_REPORT_TOKEN do site (vazio = sem cabeçalho)
pub const ANTICHEAT_TOKEN: &str = "";
pub const ANTICHEAT_SCAN_INTERVAL_MS: u64 = 7000;
pub const CRASH_TOKEN: &str = "";

// Página inicial do launcher (webview do site)
pub fn launcher_url() -> String {
    format!("{BASE_URL}new")
}

// Whitepaper aberto pelo F1 no jogo
pub fn help_url() -> String {
    format!("{BASE_URL}whitepaper")
}

pub fn anticheat_report_url() -> String {
    format!("{BASE_URL}api/anticheat/report")
}

pub fn crash_report_url() -> String {
    format!("{BASE_URL}api/crash/report")
}

// Manifesto: https://github.com/<OWNER>/<REPO>/releases/download/current/update.json
// A variável ASGARD_MANIFEST_URL troca o manifesto (teste local com "npm run release:serve")
pub fn manifest_url() -> String {
    match std::env::var("ASGARD_MANIFEST_URL") {
        Ok(url) if !url.is_empty() => url,
        _ => format!(
            "https://github.com/{GITHUB_OWNER}/{GITHUB_REPO}/releases/download/{CURRENT_TAG}/{MANIFEST_NAME}"
        ),
    }
}
