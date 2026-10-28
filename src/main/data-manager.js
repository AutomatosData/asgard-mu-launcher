const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const StreamZip = require('node-stream-zip');
const axios = require('axios');
const URL_CONFIG = require('../shared/url-config');
const updater = require('./updater');

// Tentativas por parte; cada nova tentativa continua de onde parou (HTTP Range)
const MAX_ATTEMPTS = 5;
// Sem receber dados por este tempo, a conexão é refeita
const IDLE_TIMEOUT_MS = 60000;
// Intervalo mínimo entre eventos de progresso enviados à janela
const PROGRESS_INTERVAL_MS = 250;
// Peso do download no progresso geral (o resto é a extração)
const DOWNLOAD_WEIGHT = 0.8;

// Primeira instalação: baixa o cliente completo (partes .zip listadas em
// update.json -> client.parts, publicadas por tools/release.js) e extrai na
// pasta do jogo. Cada parte vai para "<nome>.download", com retomada e
// conferência de tamanho e MD5 antes de extrair.
class DataManager {
    // getGameDirectory: função do main.js que devolve a pasta do jogo
    constructor(getGameDirectory) {
        this.getGameDirectory = getGameDirectory || (() => path.dirname(process.execPath));
    }

    async checkDataFolderExists() {
        try {
            const gameDir = this.getGameDirectory();
            const exists = await fs.pathExists(path.join(gameDir, URL_CONFIG.GAME_EXECUTABLE));
            console.log(`[DataManager] ${URL_CONFIG.GAME_EXECUTABLE} in ${gameDir}: ${exists}`);
            return exists;
        } catch (error) {
            console.error('[DataManager] Error checking game data:', error);
            return false;
        }
    }

    async calculateFileHash(filePath) {
        const hash = crypto.createHash('md5');
        for await (const chunk of fs.createReadStream(filePath)) {
            hash.update(chunk);
        }
        return hash.digest('hex');
    }

    // Erro com código para a janela mostrar o texto traduzido
    createError(code, message, params = {}) {
        const error = new Error(message);
        error.code = code;
        error.params = params;
        return error;
    }

    async checkFreeSpace(gameDir, client) {
        const largestPart = Math.max(...client.parts.map(part => part.size));
        const needed = (client.installedSize || client.parts.reduce((sum, part) => sum + part.size, 0)) + largestPart;
        try {
            const stats = await require('fs').promises.statfs(gameDir);
            const free = stats.bavail * stats.bsize;
            if (free < needed) {
                const size = (needed / 1024 ** 3).toFixed(1);
                throw this.createError('NO_SPACE', `Not enough disk space (${size} GB needed)`, { size });
            }
        } catch (error) {
            if (error.code === 'NO_SPACE') throw error;
            console.log('[DataManager] Could not check free disk space:', error.message);
        }
    }

    // Baixa (ou continua) uma parte até ela bater com o tamanho e o MD5 do manifesto
    async downloadPart(part, filePath, onBytes) {
        for (let attempt = 1; ; attempt++) {
            let start = 0;
            if (await fs.pathExists(filePath)) {
                start = (await fs.stat(filePath)).size;
                if (start > part.size) {
                    await fs.remove(filePath);
                    start = 0;
                }
            }
            onBytes(start);

            if (start < part.size) {
                try {
                    await this.fetchToFile(part.url, filePath, start, onBytes);
                } catch (error) {
                    console.log(`[DataManager] ${part.name}: attempt ${attempt} failed: ${error.message}`);
                    if (attempt >= MAX_ATTEMPTS) throw error;
                    await new Promise(resolve => setTimeout(resolve, attempt * 3000));
                    continue;
                }
            }

            const size = (await fs.stat(filePath)).size;
            if (size === part.size && await this.calculateFileHash(filePath) === part.hash) {
                return;
            }

            console.log(`[DataManager] ${part.name}: size or MD5 mismatch, downloading again`);
            await fs.remove(filePath);
            if (attempt >= MAX_ATTEMPTS) {
                throw new Error(`Downloaded file is corrupted: ${part.name}`);
            }
        }
    }

    // Grava a URL em filePath a partir do byte "start" (anexa ao arquivo)
    async fetchToFile(url, filePath, start, onBytes) {
        const response = await axios({
            method: 'GET',
            url,
            responseType: 'stream',
            headers: start > 0 ? { Range: `bytes=${start}-` } : {},
            maxRedirects: 5,
            timeout: 30000
        });

        // Servidor sem suporte a Range: recomeça do zero
        let downloaded = start;
        if (start > 0 && response.status !== 206) {
            downloaded = 0;
        }

        await new Promise((resolve, reject) => {
            const file = fs.createWriteStream(filePath, { flags: downloaded > 0 ? 'a' : 'w' });
            let idleTimer = null;
            const resetIdle = () => {
                clearTimeout(idleTimer);
                idleTimer = setTimeout(() => {
                    response.data.destroy(new Error('Download stalled'));
                }, IDLE_TIMEOUT_MS);
            };
            const fail = (error) => {
                clearTimeout(idleTimer);
                file.destroy();
                reject(error);
            };

            resetIdle();
            response.data.on('data', (chunk) => {
                downloaded += chunk.length;
                resetIdle();
                onBytes(downloaded);
            });
            response.data.on('error', fail);
            file.on('error', fail);
            file.on('finish', () => {
                clearTimeout(idleTimer);
                resolve();
            });
            response.data.pipe(file);
        });
    }

    async extractZip(zipPath, gameDir, onProgress) {
        const root = path.resolve(gameDir);
        const zip = new StreamZip.async({ file: zipPath });
        try {
            const entries = Object.values(await zip.entries());
            let done = 0;
            for (const entry of entries) {
                const destPath = path.resolve(root, entry.name);
                if (!destPath.startsWith(root + path.sep)) {
                    throw new Error(`Invalid path in ${path.basename(zipPath)}: ${entry.name}`);
                }
                if (entry.isDirectory) {
                    await fs.ensureDir(destPath);
                } else {
                    await fs.ensureDir(path.dirname(destPath));
                    await zip.extract(entry.name, destPath);
                }
                onProgress(++done, entries.length, entry.name);
            }
        } finally {
            await zip.close();
        }
    }

    async ensureDataFolder(progressCallback = null) {
        const send = progressCallback || (() => {});
        try {
            console.log('[DataManager] Starting data verification and installation...');

            if (await this.checkDataFolderExists()) {
                send({ type: 'data-exists', message: 'Game data already installed!' });
                return true;
            }

            const gameDir = this.getGameDirectory();
            const manifest = await updater.fetchManifest();
            const client = manifest.client;
            if (!client || !Array.isArray(client.parts) || client.parts.length === 0) {
                throw this.createError('NO_CLIENT', 'The game client is not published yet');
            }

            await fs.ensureDir(gameDir);
            await this.checkFreeSpace(gameDir, client);

            const totalBytes = client.parts.reduce((sum, part) => sum + part.size, 0);
            let doneBytes = 0; // partes já baixadas e extraídas
            let lastSent = 0;
            let speedBytes = 0;
            let speedTime = Date.now();
            let speed = 0;

            send({ type: 'download-start', message: 'Starting game data download...', progress: 0, overall: 0 });

            for (const [index, entry] of client.parts.entries()) {
                // URL relativa ao update.json (ex.: ../client-2026.10.22/AsgardMU-Client.part1.zip)
                const part = { ...entry, url: new URL(entry.url, updater.manifestUrl).href };
                const zipPath = path.join(gameDir, `${part.name}.download`);
                console.log(`[DataManager] Part ${index + 1}/${client.parts.length}: ${part.url}`);

                await this.downloadPart(part, zipPath, (bytes) => {
                    const now = Date.now();
                    if (now - lastSent < PROGRESS_INTERVAL_MS && bytes < part.size) return;
                    if (now - speedTime >= 1000) {
                        speed = Math.max(0, bytes - speedBytes) / 1024 / 1024 / ((now - speedTime) / 1000);
                        speedBytes = bytes;
                        speedTime = now;
                    }
                    lastSent = now;
                    const downloaded = doneBytes + bytes;
                    send({
                        type: 'download-progress',
                        message: 'Downloading game data...',
                        progress: Math.floor((downloaded / totalBytes) * 100),
                        overall: ((doneBytes + bytes * DOWNLOAD_WEIGHT) / totalBytes) * 100,
                        downloaded,
                        total: totalBytes,
                        speed
                    });
                });

                send({ type: 'extract-start', message: 'Starting data extraction...', progress: 0, overall: ((doneBytes + part.size * DOWNLOAD_WEIGHT) / totalBytes) * 100 });
                await this.extractZip(zipPath, gameDir, (current, total, currentFile) => {
                    const now = Date.now();
                    if (now - lastSent < PROGRESS_INTERVAL_MS && current < total) return;
                    lastSent = now;
                    const extracted = part.size * (DOWNLOAD_WEIGHT + (1 - DOWNLOAD_WEIGHT) * (current / total));
                    send({
                        type: 'extract-progress',
                        message: 'Extracting files...',
                        progress: Math.floor((current / total) * 100),
                        overall: ((doneBytes + extracted) / totalBytes) * 100,
                        current,
                        total,
                        currentFile
                    });
                });

                await fs.remove(zipPath);
                doneBytes += part.size;
                speedBytes = 0;
                speedTime = Date.now();
            }

            if (!await this.checkDataFolderExists()) {
                throw new Error(`Final verification failed - ${URL_CONFIG.GAME_EXECUTABLE} not found`);
            }

            console.log('[DataManager] Data installation completed successfully!');
            send({ type: 'installation-complete', message: 'Game data installed successfully!', overall: 100 });
            return true;

        } catch (error) {
            console.error('[DataManager] Installation error:', error);
            send({
                type: 'installation-error',
                message: `Installation error: ${error.message}`,
                error: error.message,
                code: error.code,
                params: error.params
            });
            throw error;
        }
    }

    async getDataFolderInfo() {
        try {
            const dataPath = path.join(this.getGameDirectory(), 'Data');

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
