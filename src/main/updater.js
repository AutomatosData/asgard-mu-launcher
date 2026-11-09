const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { ipcMain } = require('electron');
const URL_CONFIG = require('../shared/url-config');
const languagePack = require('./language-pack');
const gameGuard = require('./game-guard');
const installDirs = require('./install-dirs');

// Manifesto (update.json, gerado por tools/release.js):
//   client   -> cliente completo em partes .zip (primeira instalação, data-manager.js)
//   launcher -> versão e instalador atuais do launcher (launcher-update.js)
//   files    -> arquivos alterados depois do cliente completo: { path, size, hash, url, keep }
//               keep = preferência do jogador (ex.: option.ini): baixa só se faltar
class Updater {
  constructor() {
    this.manifestUrl = '';
    this.gamePath = '';
    this.manifest = null;
    this.downloadQueue = [];
    this.isUpdating = false;
    // MD5 já calculado por arquivo: { path: [size, mtimeMs, hash] }
    this.hashCache = null;
  }

  // Baixa o update.json. Lança erro se falhar (data-manager e launcher-update precisam dele).
  async fetchManifest() {
    const manifestUrl = URL_CONFIG.UPDATE_MANIFEST_URL;
    const response = await axios.get(manifestUrl, {
      timeout: 15000,
      params: { t: Date.now() } // sempre buscar o manifest mais recente (sem cache)
    });

    // O GitHub entrega o update.json como application/octet-stream
    const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid update manifest');
    }

    let filesArray;
    if (Array.isArray(data)) {
      filesArray = data;
    } else if (Array.isArray(data.files)) {
      filesArray = data.files;
    } else {
      filesArray = [];
    }

    this.manifestUrl = manifestUrl;
    this.manifest = {
      version: data.version || '',
      client: data.client || null,
      launcher: data.launcher || null,
      files: filesArray
    };
    return this.manifest;
  }

  // Caminho local de um arquivo do manifest; null se ele sair da pasta do jogo
  resolveGamePath(gamePath, filePath) {
    const root = path.resolve(gamePath);
    const localPath = path.resolve(root, filePath);
    return localPath.startsWith(root + path.sep) ? localPath : null;
  }

  getHashCachePath() {
    return path.join(this.gamePath, 'Data', 'Launcher', 'hash-cache.json');
  }

  async loadHashCache() {
    if (this.hashCache) return;
    try {
      this.hashCache = await fs.readJson(this.getHashCachePath());
    } catch {
      this.hashCache = {};
    }
  }

  async saveHashCache() {
    if (!this.hashCache) return;
    try {
      await fs.outputJson(this.getHashCachePath(), this.hashCache);
    } catch (error) {
      this.logUpdateEvent('warning', `Failed to save hash cache: ${error.message}`);
    }
  }

  // MD5 do arquivo; reaproveita o cache se o tamanho e a data de modificação não mudaram
  async getCachedFileHash(filePath, stats) {
    const key = path.relative(this.gamePath, filePath).toLowerCase();
    const cached = this.hashCache && this.hashCache[key];
    if (cached && cached[0] === stats.size && cached[1] === stats.mtimeMs) {
      return cached[2];
    }
    const hash = await this.calculateFileHash(filePath);
    if (this.hashCache) {
      this.hashCache[key] = [stats.size, stats.mtimeMs, hash];
    }
    return hash;
  }

  async calculateFileHash(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5');
      const stream = fs.createReadStream(filePath);
      
      stream.on('data', (data) => {
        hash.update(data);
      });
      
      stream.on('end', () => {
        resolve(hash.digest('hex'));
      });
      
      stream.on('error', (error) => {
        reject(error);
      });
    });
  }

  async getFileSize(filePath) {
    try {
      const stats = await fs.stat(filePath);
      return stats.size;
    } catch (error) {
      return 0;
    }
  }

  async validateLocalFile(filePath, expectedHash, expectedSize) {
    try {
      const stats = await fs.stat(filePath).catch(() => null);
      if (!stats || !stats.isFile()) {
        return false;
      }

      if (stats.size !== expectedSize) {
        return false;
      }

      const actualHash = await this.getCachedFileHash(filePath, stats);
      return actualHash === expectedHash;
    } catch (error) {
      this.logUpdateEvent('error', `Validation error: ${error.message}`);
      return false;
    }
  }

  // URL de um arquivo do manifest. file.url pode ser absoluta (GitHub) ou relativa
  // ao update.json; sem file.url, o arquivo fica ao lado do update.json com o mesmo path.
  getFileUrl(file) {
    const encodedPath = file.path.split('/').map(encodeURIComponent).join('/');
    return new URL(file.url || `${encodedPath}?v=${file.hash}`, this.manifestUrl).href;
  }

  // serverUrl e gamePath ficam por compatibilidade com o IPC; a URL vem de url-config.js
  async downloadManifest(serverUrl, gamePath) {
    try {
      await this.fetchManifest();
      return { success: true, manifest: this.manifest, source: 'server' };
    } catch (error) {
      this.logUpdateEvent('error', `Failed to download manifest from server: ${error.message}`);
      
      // Sem manifest: segue sem atualizar. O cliente completo (GitHub Releases)
      // é instalado pelo DataManager, não por aqui.
      this.manifest = { files: [] };
      return { success: true, manifest: this.manifest, source: 'none' };
    }
  }

  async checkForUpdates(gamePath) {
    if (!this.manifest) {
      return { success: false, error: 'No manifest loaded' };
    }
    
    if (!this.manifest.files || !Array.isArray(this.manifest.files)) {
      return { 
        success: true, 
        filesToUpdate: [], 
        totalFiles: 0, 
        filesNeedingUpdate: 0,
        message: 'No updates available'
      };
    }

    this.gamePath = gamePath;
    await this.loadHashCache();
    const filesToUpdate = [];

    // Apenas arquivos do launcher/Electron são excluídos. Arquivos do jogo (.bmd, .ozj, .ozt, etc.)
    // são atualizados normalmente quando presentes no update.json do servidor.
    const excludedFiles = [
      'mudmg.exe',
      'chrome_100_percent.pak',
      'chrome_200_percent.pak',
      'ffmpeg.dll',
      'icudtl.dat',
      'resources.pak',
      'snapshot_blob.bin',
      'v8_context_snapshot.bin',
      'debug.log',
      'locales',
      'resources'
    ];

    for (const file of this.manifest.files) {
      const shouldExclude = excludedFiles.some(excluded =>
        file.path.toLowerCase().includes(excluded.toLowerCase())
      );

      if (shouldExclude) {
        continue;
      }

      // Caminho usado exatamente como no manifest (preserva maiúsculas/minúsculas)
      // Ex.: .OZJ, .Ozj, .ozj são todos suportados conforme vier no update.json
      const localPath = this.resolveGamePath(gamePath, file.path);
      if (!localPath) {
        this.logUpdateEvent('warning', `Skipping path outside the game folder: ${file.path}`);
        continue;
      }

      // Preferência do jogador: só baixa se o arquivo não existir
      if (file.keep && await fs.pathExists(localPath)) {
        continue;
      }

      const isValid = await this.validateLocalFile(localPath, file.hash, file.size);

      if (!isValid) {
        filesToUpdate.push(file);
      }
    }

    await this.saveHashCache();

    return {
      success: true,
      filesToUpdate,
      totalFiles: this.manifest.files.length,
      filesNeedingUpdate: filesToUpdate.length
    };
  }

  async downloadFile(file, progressCallback) {
    try {
      // Mesmo path do manifest (case-sensitive): .OZJ, .Ozj, .ozj etc.
      const localPath = this.resolveGamePath(this.gamePath, file.path);
      if (!localPath) {
        throw new Error('path outside the game folder');
      }
      const localDir = path.dirname(localPath);

      await fs.ensureDir(localDir);

      const response = await axios({
        method: 'GET',
        url: this.getFileUrl(file),
        responseType: 'stream',
        timeout: 30000
      });

      const totalSize = parseInt(response.headers['content-length'], 10);
      let downloadedSize = 0;

      const writer = fs.createWriteStream(localPath);
      
      response.data.on('data', (chunk) => {
        downloadedSize += chunk.length;
        const progress = (downloadedSize / totalSize) * 100;
        
        if (progressCallback) {
          progressCallback({
            file: file.path,
            progress: Math.round(progress),
            downloaded: downloadedSize,
            total: totalSize
          });
        }
      });

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          resolve({ success: true });
        });
        writer.on('error', (error) => {
          reject(error);
        });
        response.data.on('error', (error) => {
          writer.destroy();
          reject(error);
        });
        response.data.pipe(writer);
      });
    } catch (error) {
      this.logUpdateEvent('error', `Download failed: ${file.path} - ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  async performUpdate(gamePath, serverUrl, progressCallback) {
    if (this.isUpdating) {
      return { success: false, error: 'Update already in progress' };
    }

    this.isUpdating = true;

    try {
      if (progressCallback) {
        progressCallback({ type: 'manifest', message: 'Downloading update manifest...' });
      }
      
      const manifestResult = await this.downloadManifest(serverUrl, gamePath);
      if (!manifestResult.success) {
        throw new Error(manifestResult.error);
      }

      if (progressCallback) {
        progressCallback({ type: 'check', message: 'Checking for updates...' });
      }
      
      const checkResult = await this.checkForUpdates(gamePath);
      if (!checkResult.success) {
        throw new Error(checkResult.error);
      }

      if (checkResult.filesNeedingUpdate === 0) {
        this.isUpdating = false;
        return { success: true, message: 'No updates needed' };
      }

      const filesToUpdate = checkResult.filesToUpdate;
      let downloadedFiles = 0;

      for (const file of filesToUpdate) {
        downloadedFiles++;
        
        if (progressCallback) {
          try {
            progressCallback({
              type: 'download',
              message: `Downloading ${file.path}...`,
              current: downloadedFiles,
              total: filesToUpdate.length
            });
          } catch (error) {
            if (error.message !== 'Object has been destroyed') {
              this.logUpdateEvent('error', `Progress callback error: ${error.message}`);
            }
          }
        }

        const downloadResult = await this.downloadFile(file, (progress) => {
          if (progressCallback) {
            try {
              progressCallback({
                type: 'download-progress',
                file: file.path,
                progress: progress.progress,
                downloaded: progress.downloaded,
                total: progress.total
              });
            } catch (error) {
              if (error.message !== 'Object has been destroyed') {
                this.logUpdateEvent('error', `Progress callback error: ${error.message}`);
              }
            }
          }
        });

        if (!downloadResult.success) {
          throw new Error(`Failed to download ${file.path}: ${downloadResult.error}`);
        }
      }

      if (progressCallback) {
        try {
          progressCallback({ type: 'verify', message: 'Verifying files...' });
        } catch (error) {
          if (error.message !== 'Object has been destroyed') {
            this.logUpdateEvent('error', `Progress callback error: ${error.message}`);
          }
        }
      }

      const finalCheck = await this.checkForUpdates(gamePath);
      
      if (finalCheck.filesNeedingUpdate > 0) {
        if (finalCheck.filesNeedingUpdate <= 5) {
          this.isUpdating = false;
          return { success: true, message: 'Update completed successfully (with minor verification issues)' };
        } else {
          throw new Error('Some files failed verification after update');
        }
      }

      this.isUpdating = false;
      return { success: true, message: 'Update completed successfully' };

    } catch (error) {
      this.logUpdateEvent('error', `Update failed: ${error.message}`);
      this.isUpdating = false;
      return { success: false, error: error.message };
    }
  }

  logUpdateEvent(level, message) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
    const { app } = require('electron');
    const baseDir = app.isPackaged ? installDirs.gameDir() : path.join(__dirname, '..', '..');
    const logDir = path.join(baseDir, 'Data', 'Launcher', 'Logs');
    const logPath = path.join(logDir, 'update.log');
    fs.ensureDirSync(logDir);
    fs.ensureFileSync(logPath);
    fs.appendFileSync(logPath, logEntry);
  }
}

const updater = new Updater();

if (typeof ipcMain !== 'undefined') {
  ipcMain.handle('check-updates', async (event, { gamePath, serverUrl }) => {
    try {
      // Arquivos traduzidos não batem com o MD5 do manifesto: voltar o inglês antes
      await languagePack.restore(gamePath);

      const manifestResult = await updater.downloadManifest(serverUrl, gamePath);
      if (!manifestResult.success) {
        return manifestResult;
      }

      const checkResult = await updater.checkForUpdates(gamePath);
      return checkResult;
    } catch (error) {
      updater.logUpdateEvent('error', `Update check error: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('perform-update', async (event, { gamePath, serverUrl }) => {
    try {
      // Verificar se o gamePath existe e contém os arquivos do jogo
      if (!gamePath) {
        return {
          success: false,
          error: 'Game path not provided',
          reason: 'no-path'
        };
      }
      
      // Verificar se existe o executável do jogo no diretório (nome definido em url-config.js)
      const gameExe = URL_CONFIG.GAME_EXECUTABLE || 'main.exe';
      const gameExePath = path.join(gamePath, gameExe);
      const hasGameExe = fs.existsSync(gameExePath);

      if (!hasGameExe) {
        return {
          success: false,
          error: `${gameExe} not found in game directory: ${gamePath}`,
          reason: 'game-not-found'
        };
      }
      
      await languagePack.restore(gamePath);

      // O main.exe fica oculto (game-guard.js): oculto, o Windows não deixa sobrescrever
      await gameGuard.setHidden(gameExePath, false);
      await installDirs.setGameFilesHidden(false);
      const result = await updater.performUpdate(gamePath, serverUrl, (progress) => {
        event.sender.send('update-progress', progress);
      });
      await gameGuard.setHidden(gameExePath, true);
      await installDirs.setGameFilesHidden(true);

      return result;
    } catch (error) {
      updater.logUpdateEvent('error', `Update execution error: ${error.message}`);
      return { success: false, error: error.message };
    }
  });
} else {
  console.log('ipcMain not available, skipping IPC registrations');
}

module.exports = updater;
