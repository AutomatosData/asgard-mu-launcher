// Chamadas diretas ao Windows: processos, janelas, monitor e dados da máquina.
// A versão Electron usava PowerShell, tasklist, taskkill e attrib para isto.
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use windows::core::{BOOL, PCWSTR, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, RECT};
use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_WINDOW_CORNER_PREFERENCE};
use windows::Win32::Graphics::Gdi::{EnumDisplaySettingsW, DEVMODEW, ENUM_DISPLAY_SETTINGS_MODE};
use windows::Win32::NetworkManagement::IpHelper::{
    GetAdaptersAddresses, GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_DNS_SERVER, GAA_FLAG_SKIP_MULTICAST,
    IP_ADAPTER_ADDRESSES_LH,
};
use windows::Win32::NetworkManagement::Ndis::IfOperStatusUp;
use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::SystemInformation::{
    ComputerNameDnsHostname, GetComputerNameExW, GetTickCount64, GlobalMemoryStatusEx, MEMORYSTATUSEX,
};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, TerminateProcess, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
};
use windows::Win32::UI::HiDpi::GetDpiForSystem;
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetForegroundWindow, GetWindow, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible,
    SystemParametersInfoW, GW_OWNER, SPI_GETWORKAREA, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
};
use winreg::enums::HKEY_LOCAL_MACHINE;
use winreg::RegKey;

const IF_TYPE_SOFTWARE_LOOPBACK: u32 = 24;

pub struct ProcessInfo {
    pub pid: u32,
    // Nome sem ".exe" (como o ProcessName do .NET)
    pub name: String,
    // Título da janela principal ("" se não tem)
    pub title: String,
}

fn wide_to_string(buffer: &[u16]) -> String {
    let len = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..len])
}

fn strip_exe(name: &str) -> String {
    if name.len() > 4 && name[name.len() - 4..].eq_ignore_ascii_case(".exe") {
        name[..name.len() - 4].to_string()
    } else {
        name.to_string()
    }
}

unsafe extern "system" fn enum_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let titles = &mut *(lparam.0 as *mut HashMap<u32, String>);
    // Janela principal: a primeira visível e sem dona do processo
    let owned = GetWindow(hwnd, GW_OWNER).map(|owner| !owner.is_invalid()).unwrap_or(false);
    if !owned && IsWindowVisible(hwnd).as_bool() {
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid != 0 && !titles.contains_key(&pid) {
            let mut buffer = [0u16; 512];
            let len = GetWindowTextW(hwnd, &mut buffer);
            titles.insert(pid, String::from_utf16_lossy(&buffer[..len.max(0) as usize]).trim().to_string());
        }
    }
    BOOL(1)
}

// Título da janela principal de cada processo
fn main_window_titles() -> HashMap<u32, String> {
    let mut titles: HashMap<u32, String> = HashMap::new();
    unsafe {
        let _ = EnumWindows(Some(enum_window), LPARAM(&mut titles as *mut _ as isize));
    }
    titles
}

pub fn list_processes() -> Vec<ProcessInfo> {
    let mut titles = main_window_titles();
    let mut list = Vec::new();
    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return list;
        };
        let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let pid = entry.th32ProcessID;
                list.push(ProcessInfo {
                    pid,
                    name: strip_exe(&wide_to_string(&entry.szExeFile)),
                    title: titles.remove(&pid).unwrap_or_default(),
                });
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
    }
    list
}

// Caminho do executável (None para processos protegidos)
pub fn process_path(pid: u32) -> Option<String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buffer = [0u16; 1024];
        let mut size = buffer.len() as u32;
        let result = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buffer.as_mut_ptr()), &mut size);
        let _ = CloseHandle(handle);
        result.ok()?;
        Some(String::from_utf16_lossy(&buffer[..size as usize]))
    }
}

// PIDs dos processos com este nome de arquivo (ex.: "main.exe"), sem diferenciar maiúsculas
pub fn pids_by_exe(exe_name: &str) -> Vec<u32> {
    let wanted = strip_exe(exe_name);
    list_process_names()
        .into_iter()
        .filter(|(_, name)| name.eq_ignore_ascii_case(&wanted))
        .map(|(pid, _)| pid)
        .collect()
}

fn list_process_names() -> Vec<(u32, String)> {
    let mut list = Vec::new();
    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return list;
        };
        let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                list.push((entry.th32ProcessID, strip_exe(&wide_to_string(&entry.szExeFile))));
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
    }
    list
}

pub fn kill_process(pid: u32) -> bool {
    unsafe {
        let Ok(handle) = OpenProcess(PROCESS_TERMINATE, false, pid) else {
            return false;
        };
        let result = TerminateProcess(handle, 1).is_ok();
        let _ = CloseHandle(handle);
        result
    }
}

// Janela em primeiro plano: (HWND como número, nome do processo sem ".exe")
pub fn foreground_window() -> (isize, String) {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_invalid() {
            return (0, String::new());
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let name = list_process_names()
            .into_iter()
            .find(|(id, _)| *id == pid)
            .map(|(_, name)| name)
            .unwrap_or_default();
        (hwnd.0 as isize, name)
    }
}

pub fn foreground_hwnd() -> isize {
    unsafe { GetForegroundWindow().0 as isize }
}

// Tamanhos dos modos do monitor principal, na ordem do Windows
pub fn display_mode_sizes() -> Vec<(u32, u32)> {
    let mut sizes = Vec::new();
    unsafe {
        let mut mode = DEVMODEW { dmSize: std::mem::size_of::<DEVMODEW>() as u16, ..Default::default() };
        let mut index = 0u32;
        while EnumDisplaySettingsW(PCWSTR::null(), ENUM_DISPLAY_SETTINGS_MODE(index), &mut mode).as_bool() {
            sizes.push((mode.dmPelsWidth, mode.dmPelsHeight));
            index += 1;
        }
    }
    sizes
}

// Área livre do monitor principal em pixels lógicos (como o workAreaSize do Electron)
pub fn work_area_size() -> Option<(u32, u32)> {
    unsafe {
        let mut rect = RECT::default();
        SystemParametersInfoW(
            SPI_GETWORKAREA,
            0,
            Some(&mut rect as *mut RECT as *mut core::ffi::c_void),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        )
        .ok()?;
        let scale = GetDpiForSystem().max(96) as f64 / 96.0;
        Some((
            ((rect.right - rect.left) as f64 / scale).round() as u32,
            ((rect.bottom - rect.top) as f64 / scale).round() as u32,
        ))
    }
}

pub fn tick_count() -> u64 {
    unsafe { GetTickCount64() }
}

pub fn free_disk_space(dir: &Path) -> Option<u64> {
    let name: Vec<u16> = dir.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let mut free = 0u64;
    unsafe {
        GetDiskFreeSpaceExW(PCWSTR(name.as_ptr()), Some(&mut free), None, None).ok()?;
    }
    Some(free)
}

pub fn hostname() -> String {
    unsafe {
        let mut buffer = [0u16; 256];
        let mut size = buffer.len() as u32;
        if GetComputerNameExW(ComputerNameDnsHostname, Some(PWSTR(buffer.as_mut_ptr())), &mut size).is_ok() {
            return String::from_utf16_lossy(&buffer[..size as usize]);
        }
    }
    std::env::var("COMPUTERNAME").unwrap_or_default()
}

// Primeiro MAC físico de uma placa de rede ativa (mesma ordem do os.networkInterfaces do Node)
fn first_mac() -> String {
    unsafe {
        let flags = GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER;
        let mut size = 16 * 1024u32;
        let mut buffer: Vec<u8> = Vec::new();
        for _ in 0..4 {
            buffer.resize(size as usize, 0);
            let result = GetAdaptersAddresses(
                0,
                flags,
                None,
                Some(buffer.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH),
                &mut size,
            );
            if result == 0 {
                let mut adapter = buffer.as_ptr() as *const IP_ADAPTER_ADDRESSES_LH;
                while !adapter.is_null() {
                    let a = &*adapter;
                    if a.OperStatus == IfOperStatusUp
                        && !a.FirstUnicastAddress.is_null()
                        && a.IfType != IF_TYPE_SOFTWARE_LOOPBACK
                        && a.PhysicalAddressLength == 6
                        && a.PhysicalAddress[..6].iter().any(|&b| b != 0)
                    {
                        return a.PhysicalAddress[..6]
                            .iter()
                            .map(|b| format!("{b:02x}"))
                            .collect::<Vec<_>>()
                            .join(":");
                    }
                    adapter = a.Next;
                }
                return String::new();
            }
            // 111 = ERROR_BUFFER_OVERFLOW: "size" já tem o tamanho necessário
            if result != 111 {
                break;
            }
        }
    }
    String::new()
}

// ID estável da máquina: hostname + primeiro MAC físico, em SHA-256 (16 bytes em hex).
// Mesmo valor da versão Electron (histórico do anti-cheat e dos crashes no site).
pub fn hardware_id() -> String {
    let raw = format!("{}|{}", hostname(), first_mac());
    hex::encode(Sha256::digest(raw.as_bytes()))[..32].to_string()
}

// "Windows 11 Pro 10.0.26100" (os.version() + os.release() do Node)
pub fn os_version() -> String {
    let key = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion");
    let Ok(key) = key else {
        return "Windows".to_string();
    };
    let mut product: String = key.get_value("ProductName").unwrap_or_else(|_| "Windows".to_string());
    let build: String = key.get_value("CurrentBuildNumber").unwrap_or_default();
    let major: u32 = key.get_value("CurrentMajorVersionNumber").unwrap_or(10);
    let minor: u32 = key.get_value("CurrentMinorVersionNumber").unwrap_or(0);
    // O registro do Windows 11 ainda diz "Windows 10"
    if build.parse::<u32>().unwrap_or(0) >= 22000 && product.starts_with("Windows 10") {
        product = product.replacen("Windows 10", "Windows 11", 1);
    }
    format!("{product} {major}.{minor}.{build}")
}

pub fn cpu_model() -> Option<String> {
    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey("HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0")
        .and_then(|key| key.get_value::<String, _>("ProcessorNameString"))
        .ok()
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
}

pub fn total_memory_mb() -> u64 {
    unsafe {
        let mut status = MEMORYSTATUSEX { dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
        if GlobalMemoryStatusEx(&mut status).is_ok() {
            return (status.ullTotalPhys as f64 / 1_048_576.0).round() as u64;
        }
    }
    0
}

// Padrão visual do AsgardMU: janela com cantos retos e sem a borda do Windows.
// O Windows 11 arredonda os cantos das janelas sem moldura. Sem efeito no Windows 10.
pub fn square_corners(hwnd: isize) {
    let hwnd = HWND(hwnd as *mut core::ffi::c_void);
    const DWMWCP_DONOTROUND: u32 = 1;
    const DWMWA_COLOR_NONE: u32 = 0xFFFF_FFFE;
    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &DWMWCP_DONOTROUND as *const u32 as *const core::ffi::c_void,
            4,
        );
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR,
            &DWMWA_COLOR_NONE as *const u32 as *const core::ffi::c_void,
            4,
        );
    }
}
