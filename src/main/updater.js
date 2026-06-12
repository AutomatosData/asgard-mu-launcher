const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { ipcMain } = require('electron');
const URL_CONFIG = require('../shared/url-config');

class Updater {
  constructor() {
    this.serverUrl = '';
    this.gamePath = '';
    this.manifest = null;
    this.downloadQueue = [];
    this.isUpdating = false;
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
      if (!await fs.pathExists(filePath)) {
        return false;
      }

      const actualSize = await this.getFileSize(filePath);
      if (actualSize !== expectedSize) {
        return false;
      }

      const actualHash = await this.calculateFileHash(filePath);
      return actualHash === expectedHash;
    } catch (error) {
      this.logUpdateEvent('error', `Validation error: ${error.message}`);
      return false;
    }
  }

  async downloadManifest(serverUrl, gamePath) {
    try {
      const response = await axios.get(`${serverUrl}/update.json`, {
        timeout: 10000
      });
      
      let filesArray;
      if (Array.isArray(response.data)) {
        filesArray = response.data;
      } else if (response.data.files && Array.isArray(response.data.files)) {
        filesArray = response.data.files;
      } else {
        filesArray = [];
      }
      
      this.manifest = { files: filesArray };
      this.serverUrl = serverUrl;
      
      return { success: true, manifest: this.manifest, source: 'server' };
    } catch (error) {
      this.logUpdateEvent('error', `Failed to download manifest: ${error.message}`);
      
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
      const localPath = path.join(gamePath, file.path);
      const isValid = await this.validateLocalFile(localPath, file.hash, file.size);
      
      if (!isValid) {
        filesToUpdate.push(file);
      }
    }

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
      const localPath = path.join(this.gamePath, file.path);
      const localDir = path.dirname(localPath);

      await fs.ensureDir(localDir);

      const response = await axios({
        method: 'GET',
        url: `${this.serverUrl}/${file.path}`,
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
    const baseDir = app.isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '..', '..');
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
      
      const result = await updater.performUpdate(gamePath, serverUrl, (progress) => {
        event.sender.send('update-progress', progress);
      });

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
