const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');
const net = require('net');
const os = require('os');
const fs = require('fs-extra');
const Store = require('electron-store');

let RegistryManager;
try {
  RegistryManager = require(path.join(__dirname, 'registry-manager'));
} catch (error) {
  console.error('Error importing registry-manager:', error);
  console.error('Path attempted:', path.join(__dirname, 'registry-manager'));
  RegistryManager = class {
    constructor() {
      console.log('Registry Manager not available, using fallback');
    }
    async readGameSettings() { return {}; }
    async writeGameSettings() { return false; }
  };
}

let WindowDetector;
try {
  WindowDetector = require(path.join(__dirname, 'window-detector'));
} catch (error) {
  console.error('Error importing window-detector:', error);
  WindowDetector = class {
    constructor() {
      console.log('Window Detector not available, using fallback');
    }
    async detectMUWindows() { return []; }
    startMonitoring() {}
    stopMonitoring() {}
    getDetectedCharacters() { return []; }
  };
}

try {
  require('./updater');
} catch (error) {
  console.error('Error importing updater:', error);
}

let DataManager;
try {
  DataManager = require(path.join(__dirname, 'data-manager'));
} catch (error) {
  console.error('Error importing data-manager:', error);
  DataManager = class {
    constructor() {
      console.log('Data Manager not available, using fallback');
    }
    async checkDataFolderExists() { return true; }
    async ensureDataFolder() { return true; }
  };
}

let LauncherOptionManager;
try {
  LauncherOptionManager = require(path.join(__dirname, 'launcher-option-manager'));
} catch (error) {
  console.error('Error importing launcher-option-manager:', error);
  LauncherOptionManager = class {
    constructor() {
      console.log('Launcher Option Manager not available, using fallback');
    }
    async readLauncherOptions() { return {}; }
    async writeLauncherOptions() { return false; }
  };
}

let AntiCheat;
try {
  AntiCheat = require(path.join(__dirname, 'anti-cheat'));
} catch (error) {
  console.error('Error importing anti-cheat:', error);
  AntiCheat = class {
    constructor() {
      console.log('Anti-cheat not available, using fallback');
    }
    startMonitoring() {}
    stopMonitoring() {}
    isActive() { return false; }
  };
}

let HelpHotkey;
try {
  HelpHotkey = require(path.join(__dirname, 'help-hotkey'));
} catch (error) {
  console.error('Error importing help-hotkey:', error);
  HelpHotkey = class {
    start() {}
    stop() {}
    isActive() { return false; }
  };
}

let LauncherUpdate;
try {
  LauncherUpdate = require(path.join(__dirname, 'launcher-update'));
} catch (error) {
  console.error('Error importing launcher-update:', error);
  LauncherUpdate = class {
    async check() { return { updating: false, reason: 'unavailable' }; }
  };
}

const isDev = !app.isPackaged || process.env.NODE_ENV === 'development';

function resolveAsset(assetName) {
  try {
    if (app.isPackaged) {
      const resPath = process.resourcesPath;
      const primary = path.join(resPath, assetName);
      const unpacked = path.join(resPath, 'app.asar.unpacked', assetName);
      if (fs.existsSync(primary)) return primary;
      if (fs.existsSync(unpacked)) return unpacked;
      // fallback para caminho dentro do asar (alguns formatos funcionam)
      return path.join(__dirname, '..', 'renderer', 'assets', assetName);
    }
    return path.join(__dirname, '..', 'renderer', 'assets', assetName);
  } catch (err) {
    return path.join(__dirname, '..', 'renderer', 'assets', assetName);
  }
}

const store = new Store();

let registryManager;

let windowDetector;

let dataManager;

let launcherOptionManager;

let antiCheat;

let helpHotkey;

let launcherUpdate;

let crashReport;

const URL_CONFIG = require('../shared/url-config');
const I18N = require('../shared/i18n');
const languagePack = require('./language-pack');
const gameGuard = require('./game-guard');
const installDirs = require('./install-dirs');
const CrashReport = require('./crash-report');

// Idioma da interface (mesmo valor de langSelection em LauncherOption.if)
let currentLanguage = I18N.DEFAULT_LANGUAGE;
const t = (key, params) => I18N.translate(currentLanguage, key, params);

const defaultConfig = {
  gamePath: isDev ? process.cwd() : installDirs.gameDir(),
  serverUrl: URL_CONFIG.UPDATE_URL
};

Object.keys(defaultConfig).forEach(key => {
  if (!store.has(key)) {
    store.set(key, defaultConfig[key]);
  }
});

const gameExecutable = () => URL_CONFIG.GAME_EXECUTABLE || 'main.exe';

// Função helper para obter o diretório do jogo de forma consistente
function getGameDirectory() {
  // SEMPRE verificar primeiro o diretório onde o launcher está rodando
  // pois esse é o diretório correto onde o jogo está instalado
  // (ou a pasta acima, quando o launcher fica em "Launcher\", ver install-dirs.js)
  const execDir = installDirs.gameDir();
  const exeName = gameExecutable();

  // Se o executável do jogo está no diretório do executável, usar e atualizar o store
  if (fs.existsSync(path.join(execDir, exeName))) {
    const storedPath = store.get('gamePath');
    // Atualizar o store apenas se for diferente do atual
    if (storedPath !== execDir) {
      logEvent('info', `Updating gamePath in store from "${storedPath}" to "${execDir}"`);
      store.set('gamePath', execDir);
    }
    return execDir;
  }

  // Launcher instalado: o jogo fica sempre na pasta do launcher. Sem o main.exe aqui,
  // o launcher baixa o cliente nesta pasta. O gamePath salvo pode ser de outra
  // instalação (o config.json em %APPDATA%\AsgardMU é um só por usuário).
  if (app.isPackaged) {
    return execDir;
  }

  // Desenvolvimento (npm start): usar o cliente salvo no store
  const storedPath = store.get('gamePath');
  if (storedPath && fs.existsSync(path.join(storedPath, exeName))) {
    logEvent('info', `Using stored gamePath: ${storedPath}`);
    return storedPath;
  }

  // Fallback para desenvolvimento ou se nada for encontrado
  logEvent('warning', `${exeName} not found, using fallback directory: ${execDir}`);
  return isDev ? process.cwd() : execDir;
}

let mainWindow;
let tray = null;
let serverPing = null;
let isQuiting = false;
let gameProcesses = [];

let gameDataState = {
  isInstalling: false,
  isInstalled: false,
  canUpdate: false,
  installationProgress: null
};

function killAllGameProcesses() {
  const exeName = gameExecutable();
  console.log(`Terminating all ${exeName} processes...`);
  logEvent('info', `Terminating all ${exeName} processes...`);

  gameProcesses.forEach((process, index) => {
    if (process && !process.killed) {
      try {
        console.log(`Terminating process ${index + 1} (PID: ${process.pid})`);
        logEvent('info', `Terminating process ${index + 1} (PID: ${process.pid})`);
        process.kill('SIGTERM');
        
        setTimeout(() => {
          if (!process.killed) {
            console.log(`Force terminating process ${index + 1} (PID: ${process.pid})`);
            logEvent('info', `Force terminating process ${index + 1} (PID: ${process.pid})`);
            process.kill('SIGKILL');
          }
        }, 3000);
      } catch (error) {
        console.error(`Error terminating process ${index + 1}:`, error);
        logEvent('error', `Error terminating process ${index + 1}: ${error.message}`);
      }
    }
  });
  
  gameProcesses = [];
  
  try {
    const { exec } = require('child_process');
    if (process.platform === 'win32') {
      exec(`taskkill /F /IM ${exeName}`, (error, stdout, stderr) => {
        if (error) {
          console.log(`No ${exeName} processes found or already terminated`);
        } else {
          console.log(`All ${exeName} processes terminated via taskkill`);
          logEvent('info', `All ${exeName} processes terminated via taskkill`);
        }
      });
    } else {
      exec(`pkill -f ${exeName}`, (error, stdout, stderr) => {
        if (error) {
          console.log(`No ${exeName} processes found or already terminated`);
        } else {
          console.log(`All ${exeName} processes terminated via pkill`);
          logEvent('info', `All ${exeName} processes terminated via pkill`);
        }
      });
    }
  } catch (error) {
    console.error('Error terminating processes via system command:', error);
    logEvent('error', `Error terminating processes via system command: ${error.message}`);
  }
}





function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 500,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: true,
      plugins: true,
      devTools: isDev, // Habilitar DevTools apenas em desenvolvimento
      enableRemoteModule: true
    },
    icon: resolveAsset('icon.ico'),
    show: false,
    titleBarStyle: 'hidden',
    frame: false
  });

  const htmlPath = path.join(__dirname, '..', 'renderer', 'index.html');

  mainWindow.loadFile(htmlPath);


  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Menu de contexto para inspeção manual via clique direito
  mainWindow.webContents.on('context-menu', (event, params) => {
    const menu = Menu.buildFromTemplate([
      {
        label: t('menu.inspect'),
        click: () => {
          try {
            mainWindow.webContents.inspectElement(params.x, params.y);
            mainWindow.webContents.openDevTools({ mode: 'detach' });
          } catch (e) {
            console.error('[Main] Falha ao abrir DevTools:', e);
          }
        }
      }
    ]);
    menu.popup();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('close', (event) => {
    isQuiting = true;
    // Não fechar game processes automaticamente - deixar o jogo rodar
    app.quit();
  });

  mainWindow.on('minimize', () => {
    mainWindow.hide();
    showMinimizeNotification();
  });

  mainWindow.on('blur', () => {
  });

  mainWindow.setMenu(null);
}

function createTray() {
  const iconPath = resolveAsset('icon.ico');
  const icon = nativeImage.createFromPath(iconPath);
  
  const trayIcon = icon.resize({ width: 16, height: 16 });
  
  tray = new Tray(trayIcon);
  tray.setToolTip('AsgardMU');

  updateTrayMenu();

  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// (Re)monta o menu da bandeja no idioma atual
function updateTrayMenu() {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: t('tray.show'),
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: t('tray.launch'),
      click: async () => {
        if (mainWindow) {
          mainWindow.webContents.send('launch-game-from-tray');
        }
      }
    },
    {
      label: serverPing === null ? t('tray.pingOffline') : t('tray.ping', { ms: serverPing }),
      enabled: false
    },
    { type: 'separator' },
    {
      label: t('tray.quit'),
      click: () => {
        isQuiting = true;
        // Não fechar game processes automaticamente - deixar o jogo rodar
        app.quit();
      }
    }
  ]);
  
  tray.setContextMenu(contextMenu);
}

// Mede a latência com o servidor abrindo uma conexão TCP (retorna ms ou null se falhar)
function measureServerPing() {
  const { HOST, PORT } = URL_CONFIG.GAME_SERVER;
  return new Promise(resolve => {
    const start = process.hrtime.bigint();
    const socket = net.createConnection({ host: HOST, port: PORT });
    const finish = (ms) => {
      socket.destroy();
      resolve(ms);
    };
    socket.setTimeout(3000);
    socket.once('connect', () => finish(Math.round(Number(process.hrtime.bigint() - start) / 1e6)));
    socket.once('timeout', () => finish(null));
    socket.once('error', () => finish(null));
  });
}

async function refreshServerPing() {
  const ping = await measureServerPing();
  if (ping !== serverPing) {
    serverPing = ping;
    updateTrayMenu();
  }
}

function startServerPingMonitor() {
  refreshServerPing();
  setInterval(refreshServerPing, URL_CONFIG.GAME_SERVER.PING_INTERVAL_MS);
}

function showMinimizeNotification() {
  if (tray) {
    tray.displayBalloon({
      title: 'AsgardMU',
      content: t('tray.minimized'),
      icon: resolveAsset('icon.ico')
    });
  }
}

function showGameNotification(title, content) {
  if (tray) {
    tray.displayBalloon({
      title: title,
      content: content,
      icon: resolveAsset('icon.ico')
    });
  }
}

app.whenReady().then(() => {
  const gotTheLock = app.requestSingleInstanceLock();
  
  if (!gotTheLock) {
    console.log('Another instance is already running');
    app.quit();
    return;
  }
  
  registryManager = new RegistryManager();
  
  windowDetector = new WindowDetector();
  
  dataManager = new DataManager(getGameDirectory);
  // Pasta do jogo limpa: DLLs, Data e ErrorLog ocultos (só com o launcher em "Launcher\")
  installDirs.setGameFilesHidden(true);

  launcherUpdate = new LauncherUpdate({ store, logEvent });

  launcherOptionManager = new LauncherOptionManager(store);

  antiCheat = new AntiCheat({
    logEvent,
    killGame: (info) => {
      logEvent('warning', `[AntiCheat] Encerrando o jogo: ${info?.offender || 'programa não permitido'}`);
      killAllGameProcesses();
    },
    onDetection: ({ offenderName }) => {
      if (mainWindow) {
        mainWindow.webContents.send('anticheat-detection', { offenderName });
      }
      showGameNotification('AsgardMU', t('notify.anticheatClosed', { name: offenderName }));
    },
    reportUrl: URL_CONFIG.ANTICHEAT_REPORT_URL,
    reportToken: URL_CONFIG.ANTICHEAT.TOKEN,
    rulesFile: path.join(getLogDirectory(), '..', 'anti-cheat-rules.json')
  });

  helpHotkey = new HelpHotkey({
    url: URL_CONFIG.HELP_URL,
    gameProcess: gameExecutable(),
    icon: resolveAsset('icon.ico'),
    logEvent
  });

  // Jogo travou: envia automaticamente o relatório de crash à equipe.
  // Se o envio falhar, mostra a janela para o jogador tentar manualmente.
  crashReport = new CrashReport({
    getGameDirectory,
    reportUrl: URL_CONFIG.CRASH_REPORT_URL,
    reportToken: URL_CONFIG.CRASH.TOKEN,
    launcherVersion: app.getVersion(),
    getHardwareId: () => (antiCheat ? antiCheat.hardwareId : null),
    getCharacter: pid => (antiCheat ? antiCheat.characterOfPid(pid) : null),
    t,
    getLanguage: () => currentLanguage,
    icon: resolveAsset('icon.ico'),
    store,
    logEvent,
    autoSend: true
  });

  // Carregar idioma salvo para o menu da bandeja e notificações
  launcherOptionManager.readLauncherOptions()
    .then(options => {
      currentLanguage = I18N.normalize(launcherOptionManager.convertToGameSettings(options).langSelection);
      // Guarda o idioma antes que launch-game grave o índice do cliente no LauncherOption.if
      if (!store.has('gameLanguage')) {
        store.set('gameLanguage', currentLanguage);
      }
      updateTrayMenu();
    })
    .catch(err => console.error('[Main] Failed to read language:', err));

  // Verificar atualizações sem bloquear o launcher
  console.log('[Main] Checking for updates...');
  checkAndInstallGameData().catch(err => {
    console.log('[Main] Update check failed, continuing normally:', err.message);
    logEvent('warning', `Update check failed: ${err.message}`);
    // Continuar normalmente mesmo se falhar
    gameDataState.isInstalled = true;
    gameDataState.canUpdate = true;
    gameDataState.isInstalling = false;
  });
  
  createWindow();
  createTray();
  startServerPingMonitor();
  
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', (event) => {
  if (windowDetector) {
    windowDetector.stopMonitoring();
  }

  if (antiCheat) {
    antiCheat.stopMonitoring();
  }

  if (helpHotkey) {
    helpHotkey.stop();
  }

  // Não fechar game processes automaticamente - deixar o jogo rodar
});

// Resoluções na ordem e com o filtro do jogo (DevModeIndex = posição na lista)
// Versão do launcher (package.json) para o título da janela
ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('get-display-modes', async () => {
  try {
    const { getDisplayModes } = require(path.join(__dirname, 'display-modes'));
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    return { success: true, modes: await getDisplayModes(), workArea: { width, height } };
  } catch (error) {
    console.error('Failed to get display modes:', error);
    return { success: false, error: error.message, modes: [] };
  }
});

ipcMain.handle('get-game-settings', async () => {
  try {
    const settings = await registryManager.readGameSettings();
    return { success: true, settings };
  } catch (error) {
    console.error('Failed to get game settings:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-game-settings', async (event, settings) => {
  try {
    const success = await registryManager.writeGameSettings(settings);
    return { success };
  } catch (error) {
    console.error('Failed to save game settings:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-launcher-options', async () => {
  try {
    if (!launcherOptionManager) {
      return { success: false, error: 'LauncherOptionManager not initialized' };
    }
    
    const options = await launcherOptionManager.readLauncherOptions();
    const gameSettings = launcherOptionManager.convertToGameSettings(options);
    
    return { success: true, settings: gameSettings };
  } catch (error) {
    console.error('Failed to get launcher options:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-launcher-options', async (event, settings) => {
  try {
    if (!launcherOptionManager) {
      return { success: false, error: 'LauncherOptionManager not initialized' };
    }
    
    const launcherOptions = launcherOptionManager.convertFromGameSettings(settings);
    const success = await launcherOptionManager.writeLauncherOptions(launcherOptions);

    // Atualizar idioma do processo principal (menu da bandeja / notificações)
    if (success && settings.langSelection) {
      currentLanguage = I18N.normalize(settings.langSelection);
      updateTrayMenu();
    }

    return { success };
  } catch (error) {
    console.error('Failed to save launcher options:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-detected-characters', async () => {
  try {
    if (!windowDetector) {
      console.error('[Main] WindowDetector not initialized yet');
      return { success: false, error: 'WindowDetector not initialized' };
    }
    
    const characters = windowDetector.getDetectedCharacters();
    
    const result = { 
      success: true, 
      characters: characters
    };
    
    return result;
  } catch (error) {
    console.error('[Main] Failed to get detected characters:', error);
    console.error('[Main] Error stack:', error.stack);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('refresh-character-detection', async () => {
  try {
    if (!windowDetector) {
      console.log('[Main] WindowDetector not initialized for refresh');
      return { success: false, error: 'WindowDetector not initialized' };
    }
    
    const characters = await windowDetector.detectMUWindows();
    return { 
      success: true, 
      characters: characters
    };
  } catch (error) {
    console.error('Failed to refresh character detection:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('test-detection', async () => {
  try {
    
    if (!windowDetector) {
      return { success: false, error: 'WindowDetector not initialized' };
    }
    
    const characters = await windowDetector.detectMUWindows();
    
    const isMonitoring = windowDetector.isMonitoring();
    
    return { 
      success: true, 
      characters: characters,
      isMonitoring: isMonitoring
    };
  } catch (error) {
    console.error('[Main] Test detection error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('start-character-monitoring', () => {
  try {
    if (!windowDetector) {
      console.error('[Main] WindowDetector not initialized');
      return { success: false, error: 'WindowDetector not initialized' };
    }
    
    windowDetector.startMonitoring(3000);
    
    return { success: true };
  } catch (error) {
    console.error('[Main] Failed to start character monitoring:', error);
    console.error('[Main] Error stack:', error.stack);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('stop-character-monitoring', () => {
  try {
    windowDetector.stopMonitoring();
    return { success: true };
  } catch (error) {
    console.error('Failed to stop character monitoring:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('open-devtools', () => {
  try {
    if (mainWindow && mainWindow.webContents) {
      // Abrir DevTools para a janela principal (que contém o webview)
      mainWindow.webContents.openDevTools();
    } else {
      console.error('[Main] Main window not available for DevTools');
    }
    return { success: true };
  } catch (error) {
    console.error('[Main] Failed to open DevTools:', error);
    return { success: false, error: error.message };
  }
});

// Handlers para logs do webview
ipcMain.on('webview-log', (event, message) => {
  console.log(`[Webview] ${message}`);
});

ipcMain.on('webview-error', (event, message) => {
  console.error(`[Webview] ${message}`);
});

ipcMain.on('character-selected', (event, { name }) => {
  try {
    console.log(`Character selected: ${name}`);
    logEvent('info', `Character selected: ${name}`);
    
    if (mainWindow) {
      mainWindow.webContents.send('character-selected', { name });
    }
    
    showGameNotification(t('tray.characterSelected'), t('tray.characterSelectedMsg', { name }));
    
  } catch (error) {
    console.error('Error handling character selection:', error);
    logEvent('error', `Error handling character selection: ${error.message}`);
  }
});

async function readSettingsIni() {
  try {
    const exeDir = getGameDirectory();
    const iniPath = path.join(exeDir, 'Settings.ini');
    
    logEvent('info', `Looking for Settings.ini at: ${iniPath}`);
    
    if (!fs.existsSync(iniPath)) {
      logEvent('info', 'Settings.ini not found, using default performance settings');
      return { success: true, performance: {} };
    }
    
    const content = await fs.readFile(iniPath, 'utf8');
    const performance = {};
    
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('ReduceMemory=')) {
        performance.ReduceMemory = parseInt(trimmedLine.split('=')[1]) || 0;
      } else if (trimmedLine.startsWith('Fog=')) {
        performance.Fog = parseInt(trimmedLine.split('=')[1]) || 0;
      } else if (trimmedLine.startsWith('TronEffects=')) {
        performance.TronEffects = parseInt(trimmedLine.split('=')[1]) || 0;
      }
    }
    
    logEvent('info', `Performance settings read from Settings.ini: ${JSON.stringify(performance)}`);
    return { success: true, performance };
  } catch (error) {
    logEvent('error', `Failed to read Settings.ini: ${error.message}`);
    return { success: false, error: error.message };
  }
}

ipcMain.handle('get-game-directory', async () => {
  try {
    const gameDir = getGameDirectory();
    return { success: true, gamePath: gameDir };
  } catch (error) {
    logEvent('error', `Failed to get game directory: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-config', async () => {
  try {
    const config = store.store;
    
    const iniResult = await readSettingsIni();
    if (iniResult.success && iniResult.performance) {
      config.performance = { ...config.performance, ...iniResult.performance };
    }
    
    return config;
  } catch (error) {
    logEvent('error', `Failed to get config: ${error.message}`);
    return store.store;
  }
});

ipcMain.handle('save-config', (event, config) => {
  try {
    Object.keys(config).forEach(key => {
      store.set(key, config[key]);
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('read-settings-ini', async () => {
  return await readSettingsIni();
});

ipcMain.handle('write-settings-ini', async (event, perf) => {
  try {
    const exeDir = getGameDirectory();
    const iniPath = path.join(exeDir, 'Settings.ini');

    logEvent('info', `Writing Settings.ini to: ${iniPath}`);
    logEvent('info', `Performance settings received: ${JSON.stringify(perf)}`);

    let content = '';
    if (await fs.pathExists(iniPath)) {
      content = await fs.readFile(iniPath, 'utf8');
      logEvent('info', `Settings.ini exists, current content length: ${content.length}`);
    } else {
      logEvent('info', 'Settings.ini does not exist, will create new file');
    }

    const setIniValue = (text, key, value) => {
      const regex = new RegExp(`(^|\r?\n)${key}\s*=\s*\d+(?=\r?\n|$)`, 'm');
      if (regex.test(text)) {
        logEvent('info', `Updating existing ${key}=${value}`);
        return text.replace(regex, `$1${key}=${value}`);
      }
      logEvent('info', `Adding new ${key}=${value}`);
      const sep = text.endsWith('\n') ? '' : '\n';
      return `${text}${sep}${key}=${value}\n`;
    };

    const keys = {
      ReduceMemory: Number(perf?.ReduceMemory) ? 1 : 0,
      Fog: Number(perf?.Fog) ? 1 : 0,
      TronEffects: Number(perf?.TronEffects) ? 1 : 0
    };

    let newContent = content;
    Object.entries(keys).forEach(([k, v]) => {
      newContent = setIniValue(newContent, k, v);
    });

    await fs.outputFile(iniPath, newContent, 'utf8');
    logEvent('info', `Performance settings written to Settings.ini at ${iniPath}`);
    logEvent('info', `New content length: ${newContent.length}`);
    return { success: true };
  } catch (error) {
    logEvent('error', `Failed to write Settings.ini: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('minimize-to-tray', () => {
  if (mainWindow) {
    mainWindow.hide();
    showMinimizeNotification();
  }
  return { success: true };
});

ipcMain.handle('close-app', () => {
  isQuiting = true;
  // Não fechar game processes automaticamente - deixar o jogo rodar
  app.quit();
  return { success: true };
});

ipcMain.handle('kill-game-processes', () => {
  killAllGameProcesses();
  return { success: true };
});

ipcMain.handle('get-connected-accounts', async () => {
  try {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    const exeName = gameExecutable();
    const { stdout } = await execAsync(`tasklist /FI "IMAGENAME eq ${exeName}" /FO CSV`);
    const lines = stdout.split('\n').filter(line => line.includes(exeName));
    const count = lines.length;
    
    return { count };
  } catch (error) {
    console.error('[Main] Error counting connected accounts:', error);
    return { count: 0 };
  }
});







ipcMain.handle('check-data-folder', async () => {
  try {
    if (!dataManager) {
      return { success: false, error: 'DataManager not initialized' };
    }
    
    const exists = await dataManager.checkDataFolderExists();
    const info = await dataManager.getDataFolderInfo();
    
    return { 
      success: true, 
      exists: exists,
      info: info
    };
  } catch (error) {
    console.error('Failed to check data folder:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-game-data-state', async () => {
  try {
    return {
      success: true,
      state: {
        isInstalling: gameDataState.isInstalling,
        isInstalled: gameDataState.isInstalled,
        canUpdate: gameDataState.canUpdate,
        installationProgress: gameDataState.installationProgress
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('can-perform-update', async () => {
  try {
    if (gameDataState.isInstalling) {
      return {
        success: false,
        canUpdate: false,
        reason: 'installing',
        message: 'Aguardando download do cliente...'
      };
    }
    
    if (!gameDataState.isInstalled) {
      return {
        success: false,
        canUpdate: false,
        reason: 'not-installed',
        message: 'Game data not installed'
      };
    }
    
    return {
      success: true,
      canUpdate: true,
      message: 'Pronto para fazer update'
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Primeira instalação: baixa o cliente completo (chamado pela janela quando falta o main.exe)
ipcMain.handle('install-game-data', async () => {
  try {
    if (!dataManager) {
      return { success: false, error: 'DataManager not initialized' };
    }

    if (gameDataState.isInstalling) {
      return { success: false, error: 'Installation already running' };
    }

    // Em desenvolvimento a pasta do jogo é a pasta do projeto: não baixar 4 GB nela
    if (!app.isPackaged) {
      logEvent('warning', 'Client download skipped in development - copy the client next to the launcher');
      return { success: false, error: 'Client download is disabled in development' };
    }

    console.log('[Main] Game client installation started');
    logEvent('info', `Game client installation started in ${getGameDirectory()}`);
    gameDataState.isInstalling = true;
    // Reinstalação: o main.exe oculto (game-guard.js) não pode ser sobrescrito
    await gameGuard.setHidden(path.join(getGameDirectory(), gameExecutable()), false);
    await installDirs.setGameFilesHidden(false);
    await dataManager.ensureDataFolder((progress) => {
      gameDataState.installationProgress = progress;
      if (mainWindow) {
        mainWindow.webContents.send('data-installation-progress', progress);
      }
    });

    gameDataState.isInstalled = true;
    gameDataState.canUpdate = true;
    await installDirs.setGameFilesHidden(true);
    logEvent('info', 'Game client installed');
    return { success: true };
  } catch (error) {
    console.error('Failed to install game data:', error);
    logEvent('error', `Failed to install game data: ${error.message}`);
    return { success: false, error: error.message, code: error.code, params: error.params };
  } finally {
    gameDataState.isInstalling = false;
  }
});

// Launcher novo publicado: baixa o instalador, abre em modo silencioso e fecha o launcher
ipcMain.handle('check-launcher-update', async (event) => {
  if (!launcherUpdate) {
    return { updating: false, reason: 'unavailable' };
  }

  const result = await launcherUpdate.check((progress) => {
    event.sender.send('update-progress', {
      type: 'download-progress',
      file: 'AsgardMU-Setup.exe',
      ...progress
    });
  });

  if (result.updating) {
    // O instalador espera o AsgardMU.exe fechar antes de copiar os arquivos
    setTimeout(() => {
      isQuiting = true;
      app.quit();
    }, 1500);
  }
  return result;
});

ipcMain.handle('get-data-folder-info', async () => {
  try {
    if (!dataManager) {
      return { success: false, error: 'DataManager not initialized' };
    }
    
    const info = await dataManager.getDataFolderInfo();
    return { success: true, info: info };
  } catch (error) {
    console.error('Failed to get data folder info:', error);
    return { success: false, error: error.message };
  }
});


ipcMain.handle('launch-game', async () => {
  const launcherDir = getGameDirectory();
  const exeName = gameExecutable();
  const launchPath = path.join(launcherDir, exeName);

  console.log(`Launch path: ${launchPath}`);
  console.log(`cwd: ${launcherDir}`);
  logEvent('info', `Launch path: ${launchPath}`);
  logEvent('info', `cwd: ${launcherDir}`);

  if (!await fs.pathExists(launchPath)) {
    console.log(`Game executable not found: ${launchPath}`);
    logEvent('error', `Game executable not found: ${launchPath}`);
    return { success: false, error: `Game executable not found: ${launchPath}` };
  }

  // A DLL loader (glu32.dll) carrega o Main.dll quando o main.exe abre
  const loaderName = URL_CONFIG.GAME_LOADER;
  if (loaderName && !await fs.pathExists(path.join(launcherDir, loaderName))) {
    logEvent('warning', `Loader "${loaderName}" not found; ${exeName} will start without Main.dll (may not connect)`);
  }

  // O cliente troca de idioma sozinho (LangManager.xml + pasta do idioma no
  // Lang.mpr e em Data/Local); o launcher só grava o idioma escolhido
  try {
    // Desfaz a troca de arquivos das versões anteriores do launcher
    await languagePack.restore(launcherDir);
    const options = await launcherOptionManager.readLauncherOptions();
    // O idioma pode ter mudado na tecla O do jogo desde que o launcher abriu
    currentLanguage = I18N.normalize(launcherOptionManager.convertToGameSettings(options).langSelection);
    const client = LauncherOptionManager.clientLanguage(currentLanguage);
    // O cliente publicado não traz LauncherOption.if: criar na primeira vez
    const optionsExist = await fs.pathExists(launcherOptionManager.getFilePath());
    if (!optionsExist || String(options.Language) !== String(client.index)) {
      await launcherOptionManager.writeLauncherOptions({ ...options, Language: client.index });
    }
    await registryManager.writeRegistryValue('LangSelection', 'REG_SZ', client.code);
    logEvent('info', `Game language: ${currentLanguage} (client ${client.code}, index ${client.index})`);
  } catch (error) {
    logEvent('error', `Failed to apply game language: ${error.message}`);
  }

  try {
    const { spawn } = require('child_process');

    // Mesma linha de comando do antigo game.exe: "main.exe -test -k<GetTickCount>".
    // os.uptime() no Windows vem do GetTickCount64, com frações de segundo;
    // "| 0" corta para 32 bits com sinal, como o %d do game.exe.
    const tickCount = Math.round(os.uptime() * 1000) | 0;

    // O manifesto do main.exe pede administrador. RunAsInvoker abre o jogo
    // sem UAC, com os mesmos direitos do launcher.
    // "-a<código>": a AsgardCustom.dll fecha o jogo aberto sem o launcher (game-guard.js)
    const gameProcess = spawn(launchPath, ['-test', `-k${tickCount}`, `-a${gameGuard.launchToken(tickCount)}`], {
      argv0: exeName,
      cwd: launcherDir,
      detached: true,
      windowsHide: false,
      env: { ...process.env, __COMPAT_LAYER: 'RunAsInvoker' }
    });

    gameProcesses.push(gameProcess);
    const gameStartedAt = Date.now();
    gameGuard.setHidden(launchPath, true);

    gameProcess.stdout?.on('data', d => {
      console.log(`STDOUT: ${d}`);
      logEvent('info', `STDOUT: ${d}`);
    });
    
    gameProcess.stderr?.on('data', d => {
      console.log(`STDERR: ${d}`);
      logEvent('error', `STDERR: ${d}`);
    });
    
    gameProcess.on('exit', code => {
      console.log(`Game process exited with code: ${code}`);
      logEvent('info', `Game process exited with code: ${code}`);

      // Crash: o cliente grava ErrorLog\stack_*.txt / crash_*.dmp; o launcher pergunta se envia
      if (crashReport) {
        crashReport.onGameExit({ pid: gameProcess.pid, exitCode: code, startedAt: gameStartedAt });
      }
      
      const index = gameProcesses.indexOf(gameProcess);
      if (index > -1) {
        gameProcesses.splice(index, 1);
      }
    });

    gameProcess.on('error', (error) => {
      console.log(`Process error: ${error.message}`);
      logEvent('error', `Process error: ${error.message}`);
      
      const index = gameProcesses.indexOf(gameProcess);
      if (index > -1) {
        gameProcesses.splice(index, 1);
      }
    });

    if (gameProcess.pid) {
      console.log(`Game started with PID: ${gameProcess.pid}`);
      logEvent('info', `Game started with PID: ${gameProcess.pid}`);

      // Inicia o anti-cheat local enquanto o jogo roda.
      if (antiCheat && !antiCheat.isActive()) {
        antiCheat.startMonitoring(URL_CONFIG.ANTICHEAT.SCAN_INTERVAL_MS);
      }

      // F1 no jogo abre o whitepaper.
      if (helpHotkey && !helpHotkey.isActive()) {
        helpHotkey.start();
      }

      setTimeout(() => {
        console.log('MU launched successfully');
        logEvent('info', 'MU launched successfully');
      }, 2000);
    } else {
      console.log(`Failed to start game process (${exeName})`);
      logEvent('error', `Failed to start game process (${exeName})`);
    }

    return { success: true };
    
  } catch (error) {
    console.log(`Error launching game: ${error.message}`);
    logEvent('error', `Error launching game: ${error.message}`);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('minimize-window', () => {
  mainWindow.minimize();
});

ipcMain.handle('close-window', () => {
  mainWindow.close();
});

ipcMain.handle('open-external-url', (event, url) => {
  shell.openExternal(url);
});

async function checkAndInstallGameData() {
  try {
    if (!dataManager) {
      console.log('[Main] DataManager not available, skipping data verification');
      gameDataState.canUpdate = false;
      return;
    }

    console.log('[Main] Checking if Data folder exists...');
    const dataExists = await dataManager.checkDataFolderExists();
    
    if (dataExists) {
      console.log('[Main] Game data folder already exists');
      logEvent('info', 'Game data folder already exists');
      
      gameDataState.isInstalled = true;
      gameDataState.canUpdate = true;
      gameDataState.isInstalling = false;
      
      if (mainWindow) {
        mainWindow.webContents.send('game-data-state', {
          type: 'ready-for-update',
          message: 'Dados do jogo prontos - pode fazer update',
          canUpdate: true
        });
      }
      
      return;
    }

    // Sem o cliente: a janela chama install-game-data quando estiver pronta para mostrar o progresso
    console.log('[Main] Game data folder not found, waiting for the window to start the download');
    logEvent('info', 'Game client not found - it will be downloaded');
    
    gameDataState.isInstalled = false;
    gameDataState.canUpdate = false;
    gameDataState.isInstalling = false;
    
    if (mainWindow) {
      mainWindow.webContents.send('game-data-state', {
        type: 'not-installed',
        message: 'Cliente não encontrado - por favor instale o jogo',
        canUpdate: false,
        isInstalling: false
      });
    }
  } catch (error) {
    console.log('[Main] Error in checkAndInstallGameData:', error.message);
    logEvent('error', `Error in checkAndInstallGameData: ${error.message}`);
    
    // Não bloquear o launcher em caso de erro
    gameDataState.isInstalled = true;
    gameDataState.canUpdate = true;
    gameDataState.isInstalling = false;
  }
}

function getLogDirectory() {
  const baseDir = app.isPackaged ? installDirs.gameDir() : path.join(__dirname, '..', '..');
  return path.join(baseDir, 'Data', 'Launcher', 'Logs');
}

function logEvent(level, message) {
  try {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
    const logDir = getLogDirectory();
    const logPath = path.join(logDir, 'app.log');
    fs.ensureDirSync(logDir);
    fs.ensureFileSync(logPath);
    fs.appendFileSync(logPath, logEntry);
  } catch (error) {
    console.error('LogEvent failed:', error?.message);
  }
}

process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err);
  try { logEvent('error', `uncaughtException: ${err?.stack || err?.message}`); } catch {}
});

process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason);
  try { logEvent('error', `unhandledRejection: ${reason?.stack || reason}`); } catch {}
});

logEvent('info', 'AsgardMU started');
