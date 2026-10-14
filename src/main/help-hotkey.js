const { spawn } = require('child_process');
const { BrowserWindow, globalShortcut, screen, shell } = require('electron');

/**
 * Atalho F1 do jogo — abre o whitepaper do site numa janela do launcher.
 *
 * Um PowerShell em segundo plano observa a janela em primeiro plano e imprime
 * "1" quando ela é do jogo e "0" quando não é. O launcher registra o F1 só
 * enquanto o jogo está em foco, para não roubar a tecla de outros programas.
 * Com a janela do whitepaper em foco, F1 ou Esc fecham a janela.
 */

const SHORTCUT = 'F1';
const RESTART_DELAY_MS = 5000;

// Sai sozinho quando o launcher (parentPid) fecha, para não ficar órfão.
const WATCHER_SCRIPT = `
$ProgressPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class AsgardForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$lastHwnd = [IntPtr]::Zero
$state = ''
$tick = 0
while ($true) {
  $hwnd = [AsgardForeground]::GetForegroundWindow()
  if ($hwnd -ne $lastHwnd) {
    $lastHwnd = $hwnd
    $procId = 0
    [void][AsgardForeground]::GetWindowThreadProcessId($hwnd, [ref]$procId)
    $name = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
    $now = if ($name -eq '__GAME__') { '1' } else { '0' }
    if ($now -ne $state) {
      $state = $now
      [Console]::Out.WriteLine($now)
      [Console]::Out.Flush()
    }
  }
  $tick++
  if ($tick % 25 -eq 0 -and -not (Get-Process -Id __PARENT__ -ErrorAction SilentlyContinue)) { exit }
  Start-Sleep -Milliseconds 200
}
`;

class HelpHotkey {
  /**
   * @param {object} opts
   * @param {string} opts.url             página aberta pelo F1
   * @param {string} [opts.gameProcess]   nome do processo do jogo, sem ".exe"
   * @param {string} [opts.icon]          ícone da janela
   * @param {(level: string, message: string) => void} [opts.logEvent]
   */
  constructor(opts = {}) {
    this.url = opts.url;
    this.gameProcess = (opts.gameProcess || 'main').replace(/\.exe$/i, '');
    this.icon = opts.icon;
    this.logEvent = opts.logEvent || (() => {});

    this.watcher = null;
    this.restartTimer = null;
    this.isWatching = false;
    this.window = null;
  }

  start() {
    if (this.isWatching || process.platform !== 'win32') return;
    this.isWatching = true;
    this.spawnWatcher();
    this.logEvent('info', `[HelpHotkey] Atalho ${SHORTCUT} ativo para ${this.url}`);
  }

  stop() {
    this.isWatching = false;
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.setShortcut(false);
    if (this.watcher) {
      this.watcher.kill();
      this.watcher = null;
    }
  }

  isActive() {
    return this.isWatching;
  }

  spawnWatcher() {
    const script = WATCHER_SCRIPT
      .replace('__GAME__', this.gameProcess)
      .replace('__PARENT__', String(process.pid));
    const encoded = Buffer.from(script, 'utf16le').toString('base64');

    const watcher = spawn('powershell', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded
    ], { windowsHide: true });
    this.watcher = watcher;

    let buffer = '';
    watcher.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        if (line === '1') this.setShortcut(true);
        else if (line === '0') this.setShortcut(false);
      }
    });

    watcher.stderr.on('data', (data) => {
      this.logEvent('error', `[HelpHotkey] PowerShell: ${data.toString().trim()}`);
    });

    watcher.on('exit', (code) => {
      if (this.watcher !== watcher) return;
      this.watcher = null;
      this.setShortcut(false);
      if (!this.isWatching) return;
      this.logEvent('warning', `[HelpHotkey] Observador encerrou (código ${code}); reiniciando`);
      this.restartTimer = setTimeout(() => this.spawnWatcher(), RESTART_DELAY_MS);
    });

    watcher.on('error', (error) => {
      this.logEvent('error', `[HelpHotkey] Falha ao iniciar o observador: ${error.message}`);
    });
  }

  setShortcut(enabled) {
    const registered = globalShortcut.isRegistered(SHORTCUT);
    if (enabled && !registered) {
      if (!globalShortcut.register(SHORTCUT, () => this.toggleWindow())) {
        this.logEvent('warning', `[HelpHotkey] ${SHORTCUT} já está em uso por outro programa`);
      }
    } else if (!enabled && registered) {
      globalShortcut.unregister(SHORTCUT);
    }
  }

  toggleWindow() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.close();
      return;
    }

    const { workAreaSize } = screen.getPrimaryDisplay();
    this.window = new BrowserWindow({
      width: Math.min(1200, Math.round(workAreaSize.width * 0.85)),
      height: Math.min(850, Math.round(workAreaSize.height * 0.85)),
      title: 'AsgardMU - Whitepaper',
      icon: this.icon,
      alwaysOnTop: true,
      autoHideMenuBar: true,
      backgroundColor: '#000000',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });
    this.window.setMenu(null);

    // Links que abrem nova aba vão para o navegador padrão.
    this.window.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    // Com a janela em foco o F1 global está desligado; trata F1/Esc aqui.
    this.window.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && (input.key === 'F1' || input.key === 'Escape')) {
        event.preventDefault();
        this.window.close();
      }
    });

    this.window.on('closed', () => {
      this.window = null;
    });

    this.window.loadURL(this.url).catch((error) => {
      this.logEvent('error', `[HelpHotkey] Falha ao carregar ${this.url}: ${error.message}`);
    });
  }
}

module.exports = HelpHotkey;
