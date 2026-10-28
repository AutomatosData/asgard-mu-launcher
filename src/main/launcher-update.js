const { app } = require('electron');
const { spawn } = require('child_process');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const updater = require('./updater');

// Nova tentativa da mesma versão só depois deste tempo (evita laço se o instalador falhar)
const RETRY_AFTER_MS = 30 * 60 * 1000;

// Atualização do próprio launcher. update.json -> launcher = { version, url, size, hash }
// (tools/release.js launcher). Se a versão publicada for maior que a instalada, baixa o
// instalador, confere tamanho e MD5, abre o instalador em modo silencioso na mesma pasta
// e fecha o launcher. O instalador abre o launcher novo no fim (--force-run).
// Só roda no launcher instalado pelo instalador (existe "Uninstall AsgardMU.exe").
class LauncherUpdate {
  constructor({ store, logEvent }) {
    this.store = store;
    this.logEvent = logEvent || (() => {});
  }

  // "1.2.10" > "1.2.9"
  static isNewer(remote, local) {
    const a = String(remote).split('.').map(n => parseInt(n, 10) || 0);
    const b = String(local).split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
    }
    return false;
  }

  getInstallDir() {
    return path.dirname(process.execPath);
  }

  isInstalledBySetup() {
    const uninstaller = path.join(this.getInstallDir(), `Uninstall ${app.getName()}.exe`);
    return fs.existsSync(uninstaller);
  }

  // Devolve { updating: true } se o instalador novo foi aberto (o launcher deve fechar)
  async check(onProgress) {
    if (!app.isPackaged) {
      return { updating: false, reason: 'dev' };
    }

    let manifest;
    try {
      manifest = await updater.fetchManifest();
    } catch (error) {
      this.logEvent('warning', `[LauncherUpdate] Manifest not available: ${error.message}`);
      return { updating: false, reason: 'no-manifest' };
    }

    const remote = manifest.launcher;
    const current = app.getVersion();
    if (!remote || !remote.version || !remote.url || !LauncherUpdate.isNewer(remote.version, current)) {
      return { updating: false, reason: 'up-to-date' };
    }

    if (!this.isInstalledBySetup()) {
      this.logEvent('warning', `[LauncherUpdate] ${remote.version} available, but this launcher was not installed by the setup; skipping`);
      return { updating: false, reason: 'not-installed', version: remote.version };
    }

    const last = this.store.get('launcherUpdateTry');
    if (last && last.version === remote.version && Date.now() - last.at < RETRY_AFTER_MS) {
      this.logEvent('warning', `[LauncherUpdate] ${remote.version} was tried at ${new Date(last.at).toISOString()}; waiting before a new try`);
      return { updating: false, reason: 'recently-tried', version: remote.version };
    }

    try {
      this.logEvent('info', `[LauncherUpdate] Updating launcher ${current} -> ${remote.version}`);
      const setupPath = path.join(os.tmpdir(), `AsgardMU-Setup-${remote.version}.exe`);
      await this.download(new URL(remote.url, updater.manifestUrl).href, setupPath, remote, onProgress);

      this.store.set('launcherUpdateTry', { version: remote.version, at: Date.now() });

      // /D= tem que ser o último parâmetro e sem aspas (regra do NSIS)
      const args = ['/S', '--updated', '--force-run', `/D=${this.getInstallDir()}`];
      const child = spawn(setupPath, args, {
        argv0: `"${setupPath}"`,
        detached: true,
        stdio: 'ignore',
        windowsVerbatimArguments: true
      });
      child.unref();
      this.logEvent('info', `[LauncherUpdate] Setup started: ${setupPath} ${args.join(' ')}`);
      return { updating: true, version: remote.version };
    } catch (error) {
      this.logEvent('error', `[LauncherUpdate] Update failed: ${error.message}`);
      return { updating: false, reason: 'error', error: error.message };
    }
  }

  async download(url, filePath, expected, onProgress) {
    const response = await axios({ method: 'GET', url, responseType: 'stream', timeout: 30000, maxRedirects: 5 });
    const total = parseInt(response.headers['content-length'], 10) || expected.size || 0;
    let downloaded = 0;
    const hash = crypto.createHash('md5');

    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(filePath);
      response.data.on('data', (chunk) => {
        downloaded += chunk.length;
        hash.update(chunk);
        if (onProgress && total > 0) {
          onProgress({ downloaded, total, progress: Math.round((downloaded / total) * 100) });
        }
      });
      response.data.on('error', (error) => {
        file.destroy();
        reject(error);
      });
      file.on('error', reject);
      file.on('finish', resolve);
      response.data.pipe(file);
    });

    if ((expected.size && downloaded !== expected.size) || (expected.hash && hash.digest('hex') !== expected.hash)) {
      await fs.remove(filePath);
      throw new Error('Launcher setup download is corrupted');
    }
  }
}

module.exports = LauncherUpdate;
