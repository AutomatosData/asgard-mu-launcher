const fs = require('fs-extra');
const path = require('path');
const https = require('https');
const { promisify } = require('util');
const StreamZip = require('node-stream-zip');
const axios = require('axios');
const URL_CONFIG = require('../shared/url-config');

class DataManager {
    constructor() {
        this.dataUrl = URL_CONFIG.GITHUB_DOWNLOAD;
        this.zipFileName = 'MUDMG.zip';
    }

    async checkDataFolderExists() {
        try {
            const exeDir = path.dirname(process.execPath);
            const rootContents = await fs.readdir(exeDir);
            
            console.log(`[DataManager] Checking game data in: ${exeDir}`);
            
            const hasGameFiles = rootContents.some(item => 
                item.toLowerCase().includes('main') || 
                item.toLowerCase().includes('settings') ||
                item.toLowerCase().includes('data') ||
                item.toLowerCase().includes('scripts')
            );
            
            console.log(`[DataManager] Game data exists: ${hasGameFiles}`);
            return hasGameFiles;
        } catch (error) {
            console.error('[DataManager] Error checking game data:', error);
            return false;
        }
    }

    async downloadDataZip(progressCallback = null) {
        try {
            const exeDir = path.dirname(process.execPath);
            const zipPath = path.join(exeDir, this.zipFileName);
            
            console.log(`[DataManager] Starting download from: ${this.dataUrl}`);
            
            if (progressCallback) {
                progressCallback({
                    type: 'download-start',
                    message: 'Starting game data download...'
                });
            }

            const response = await axios({
                method: 'GET',
                url: this.dataUrl,
                responseType: 'stream',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': 'application/zip, application/octet-stream, */*',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                },
                maxRedirects: 5,
                timeout: 30000
            });


            const contentType = response.headers['content-type'];
            const contentLength = parseInt(response.headers['content-length'], 10);
            
            if (contentType && !contentType.includes('application/zip') && !contentType.includes('application/octet-stream')) {
                throw new Error(`Invalid file type. Expected ZIP, got: ${contentType}`);
            }
            
            if (contentLength && contentLength < 1000) {
                throw new Error(`File too small (${contentLength} bytes). Not a valid ZIP file.`);
            }

            const totalSize = contentLength;
            let downloadedSize = 0;
            const startTime = Date.now();
            let lastUpdateTime = startTime;
            let lastDownloadedSize = 0;

            return new Promise((resolve, reject) => {
                const file = fs.createWriteStream(zipPath);

                response.data.on('data', (chunk) => {
                    downloadedSize += chunk.length;
                    
                    if (progressCallback && totalSize > 0) {
                        const progress = Math.round((downloadedSize / totalSize) * 100);
                        const currentTime = Date.now();
                        
                        // Calcular velocidade de download a cada segundo
                        if (currentTime - lastUpdateTime >= 1000) {
                            const timeDiff = (currentTime - lastUpdateTime) / 1000;
                            const sizeDiff = downloadedSize - lastDownloadedSize;
                            const speedMBps = (sizeDiff / 1024 / 1024) / timeDiff;
                            
                            
                            progressCallback({
                                type: 'download-progress',
                                message: `Downloading game data... ${progress}%`,
                                progress: progress,
                                downloaded: downloadedSize,
                                total: totalSize,
                                speed: speedMBps
                            });
                            
                            lastUpdateTime = currentTime;
                            lastDownloadedSize = downloadedSize;
                        }
                        
                        if (progress >= 100 && downloadedSize >= totalSize) {
                            progressCallback({
                                type: 'download-progress',
                                message: `Downloading game data... 100%`,
                                progress: 100,
                                downloaded: downloadedSize,
                                total: totalSize,
                                speed: 0
                            });
                        }
                    }
                });

                response.data.pipe(file);

                file.on('finish', () => {
                    file.close();
                    
                    if (progressCallback) {
                        const finalProgress = Math.round((downloadedSize / totalSize) * 100);
                        if (finalProgress < 100) {
                            progressCallback({
                                type: 'download-progress',
                                message: `Downloading game data... 100%`,
                                progress: 100,
                                downloaded: downloadedSize,
                                total: totalSize,
                                speed: 0
                            });
                        }
                        
                        setTimeout(() => {
                            progressCallback({
                                type: 'download-complete',
                                message: 'Download completed successfully!',
                                downloaded: downloadedSize,
                                total: totalSize,
                                progress: 100,
                                speed: 0
                            });
                            resolve(true);
                        }, 200);
                    } else {
                        resolve(true);
                    }
                });

                file.on('error', (error) => {
                    fs.unlink(zipPath, () => {});
                    reject(error);
                });

                response.data.on('error', (error) => {
                    reject(error);
                });
            });

        } catch (error) {
            console.error('[DataManager] Download error:', error);
            throw error;
        }
    }

    async extractDataZip(progressCallback = null) {
        try {
            const exeDir = path.dirname(process.execPath);
            const zipPath = path.join(exeDir, this.zipFileName);

            console.log(`[DataManager] Extracting to: ${exeDir}`);

            if (progressCallback) {
                progressCallback({
                    type: 'download-complete',
                    message: 'Download completed successfully!',
                    progress: 100,
                    speed: 0,
                    downloaded: 0,
                    total: 0
                });
            }

            await new Promise(resolve => setTimeout(resolve, 500));

            if (progressCallback) {
                progressCallback({
                    type: 'extract-start',
                    message: 'Starting data extraction...',
                    progress: 0,
                    current: 0,
                    total: 0
                });
            }

            if (!await fs.pathExists(zipPath)) {
                throw new Error(`Arquivo ZIP não encontrado: ${zipPath}`);
            }

            const zip = new StreamZip.async({ file: zipPath });
            const entries = await zip.entries();
            const totalEntries = Object.keys(entries).length;
            let extractedEntries = 0;


            for (const entryName of Object.keys(entries)) {
                let relativePath = entryName.replace(/^MUDMG\//, '');
                if (!relativePath) continue;
                
                const destPath = path.join(exeDir, relativePath);

                if (entries[entryName].isDirectory) {
                    await fs.ensureDir(destPath);
                } else {
                    await fs.ensureDir(path.dirname(destPath));
                    await zip.extract(entryName, destPath);
                }

                extractedEntries++;
                
                if (progressCallback) {
                    const progress = Math.round((extractedEntries / totalEntries) * 100);
                    
                    
                    progressCallback({
                        type: 'extract-progress',
                        message: `Extracting files... ${progress}%`,
                        progress: progress,
                        current: extractedEntries,
                        total: totalEntries,
                        currentFile: relativePath,
                        speed: 0,
                        downloaded: 0,
                        totalSize: 0
                    });
                }
            }

            await zip.close();

            console.log(`[DataManager] Extraction completed successfully`);

            await fs.remove(zipPath);

            if (progressCallback) {
                progressCallback({
                    type: 'extract-complete',
                    message: 'Data installation completed successfully!'
                });
            }

            return true;

        } catch (error) {
            console.error('[DataManager] Extraction error:', error);
            throw error;
        }
    }

    async ensureDataFolder(progressCallback = null) {
        try {
            console.log('[DataManager] Starting data verification and installation...');

            const dataExists = await this.checkDataFolderExists();
            
            if (dataExists) {
                console.log('[DataManager] Game data already exists');
                
                if (progressCallback) {
                    progressCallback({
                        type: 'data-exists',
                        message: 'Game data already installed!'
                    });
                }
                
                return true;
            }

            console.log('[DataManager] Game data not found, starting download...');

            await this.downloadDataZip(progressCallback);

            await this.extractDataZip(progressCallback);

            const exeDir = path.dirname(process.execPath);
            const rootContents = await fs.readdir(exeDir);
            
            const hasGameFiles = rootContents.some(item => 
                item.toLowerCase().includes('main') || 
                item.toLowerCase().includes('settings') ||
                item.toLowerCase().includes('data') ||
                item.toLowerCase().includes('scripts')
            );
            
            if (hasGameFiles) {
                console.log('[DataManager] Data installation completed successfully!');
                
                if (progressCallback) {
                    progressCallback({
                        type: 'installation-complete',
                        message: 'Game data installed successfully!'
                    });
                }
                
                return true;
            } else {
                throw new Error('Final verification failed - no game files were copied');
            }

        } catch (error) {
            console.error('[DataManager] Installation error:', error);
            
            if (progressCallback) {
                progressCallback({
                    type: 'installation-error',
                    message: `Installation error: ${error.message}`
                });
            }
            
            throw error;
        }
    }

    async getDataFolderInfo() {
        try {
            const exeDir = path.dirname(process.execPath);
            const dataPath = path.join(exeDir, this.dataFolderName);
            
            if (!await fs.pathExists(dataPath)) {
                return {
                    exists: false,
                    size: 0,
                    files: 0
                };
            }

            const stats = await fs.stat(dataPath);
            const files = await this.countFilesInDirectory(dataPath);

            return {
                exists: true,
                size: stats.size,
                files: files,
                path: dataPath
            };

        } catch (error) {
            console.error('[DataManager] Error getting data folder info:', error);
            return {
                exists: false,
                size: 0,
                files: 0,
                error: error.message
            };
        }
    }

    async countFilesInDirectory(dirPath) {
        try {
            let count = 0;
            const items = await fs.readdir(dirPath);
            
            for (const item of items) {
                const itemPath = path.join(dirPath, item);
                const stats = await fs.stat(itemPath);
                
                if (stats.isDirectory()) {
                    count += await this.countFilesInDirectory(itemPath);
                } else {
                    count++;
                }
            }
            
            return count;
        } catch (error) {
            console.error('[DataManager] Error counting files:', error);
            return 0;
        }
    }
}

module.exports = DataManager;
