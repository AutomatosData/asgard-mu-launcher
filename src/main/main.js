const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');
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

const URL_CONFIG = require('../shared/url-config');

const defaultConfig = {
  gamePath: isDev ? process.cwd() : path.dirname(process.execPath),
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
  const execDir = path.dirname(process.execPath);
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

  // Se não encontrou no diretório do executável, verificar o store
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
        label: 'Inspecionar',
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
    killAllGameProcesses();
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
  tray.setToolTip('MU Online');
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Launcher',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Launch Game',
      click: async () => {
        if (mainWindow) {
          mainWindow.webContents.send('launch-game-from-tray');
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuiting = true;
        killAllGameProcesses();
        app.quit();
      }
    }
  ]);
  
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function showMinimizeNotification() {
  if (tray) {
    tray.displayBalloon({
      title: 'MU Online',
      content: 'MU Online minimized to system tray',
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
  
  dataManager = new DataManager();
  
  checkAndInstallGameData();
  
  createWindow();
  createTray();
  
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
  
  killAllGameProcesses();
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
    
    showGameNotification('Character Selected', `Character "${name}" has been selected`);
    
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
  killAllGameProcesses();
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

ipcMain.handle('install-game-data', async () => {
  try {
    if (!dataManager) {
      return { success: false, error: 'DataManager not initialized' };
    }
    
    console.log('[Main] Manual data installation requested');
    await dataManager.ensureDataFolder((progress) => {
      if (mainWindow) {
        mainWindow.webContents.send('data-installation-progress', progress);
      }
    });
    
    return { success: true };
  } catch (error) {
    console.error('Failed to install game data:', error);
    return { success: false, error: error.message };
  }
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
  const gameExePath = path.join(launcherDir, exeName);

  console.log(`Game exe path: ${gameExePath}`);
  console.log(`cwd: ${launcherDir}`);
  logEvent('info', `Game exe path: ${gameExePath}`);
  logEvent('info', `cwd: ${launcherDir}`);

  if (!await fs.pathExists(gameExePath)) {
    console.log(`Game executable not found: ${gameExePath}`);
    logEvent('error', `Game executable not found: ${gameExePath}`);
    return { success: false, error: `Game executable not found: ${gameExePath}` };
  }

  try {
    const { spawn } = require('child_process');

    const gameProcess = spawn(gameExePath, [], {
      cwd: launcherDir,
      detached: true,
      windowsHide: false,
      env: process.env
    });

    gameProcesses.push(gameProcess);

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

    console.log('[Main] Game data folder not found, starting download...');
    logEvent('info', 'Game data folder not found, starting download...');

    gameDataState.isInstalling = true;
    gameDataState.canUpdate = false;
    gameDataState.isInstalled = false;

    if (mainWindow) {
      mainWindow.webContents.send('data-installation-progress', {
        type: 'start',
        message: 'Instalando dados do jogo pela primeira vez...'
      });
      
      mainWindow.webContents.send('game-data-state', {
        type: 'installing',
        message: 'Aguardando download do cliente...',
        canUpdate: false,
        isInstalling: true
      });
    }

    await dataManager.ensureDataFolder((progress) => {
      if (progress.type === 'download-start' || 
          progress.type === 'download-complete' || 
          progress.type === 'extract-start' || 
          progress.type === 'extract-complete' ||
          progress.type === 'installation-complete' ||
          progress.type === 'installation-error') {
        console.log(`[Main] Data installation: ${progress.type} - ${progress.message}`);
        logEvent('info', `Data installation: ${progress.type} - ${progress.message}`);
      }
      
      gameDataState.installationProgress = progress;
      
      if (mainWindow) {
        mainWindow.webContents.send('data-installation-progress', progress);
      }
    });

    console.log('[Main] Game data installed successfully!');
    logEvent('info', 'Game data installation completed successfully');

    gameDataState.isInstalling = false;
    gameDataState.isInstalled = true;
    gameDataState.canUpdate = true;
    gameDataState.installationProgress = null;

    if (mainWindow) {
      mainWindow.webContents.send('game-data-state', {
        type: 'ready-for-update',
        message: 'Dados do jogo instalados - pode fazer update',
        canUpdate: true,
        isInstalling: false
      });
    }

  } catch (error) {
    console.error('[Main] Error during data installation:', error);
    logEvent('error', `Game data installation failed: ${error.message}`);
    
    gameDataState.isInstalling = false;
    gameDataState.canUpdate = false;
    gameDataState.installationProgress = null;
    
    if (mainWindow) {
      mainWindow.webContents.send('data-installation-progress', {
        type: 'error',
        message: `Installation error: ${error.message}`
      });
      
      mainWindow.webContents.send('game-data-state', {
        type: 'error',
        message: `Installation error: ${error.message}`,
        canUpdate: false,
        isInstalling: false
      });
    }
  }
}

function getLogDirectory() {
  const baseDir = app.isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '..', '..');
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

logEvent('info', 'MU Online started');
