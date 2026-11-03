// Relatório de crash do cliente.
//
// Quando o main.exe trava, o cliente grava ErrorLog\stack_<data>.txt e ErrorLog\crash_<data>.dmp.
// O launcher vê esses arquivos quando o jogo fecha, abre uma janela pequena e pergunta ao jogador
// se ele quer enviar os dados para a Equipe AsgardMU. Se sim, faz POST em
// URL_CONFIG.CRASH_REPORT_URL (site: src/app/api/crash/report). O site grava em web.crash_reports
// (Asgard-Mu-ServerS21/_Migracao/sql/05_crash_reports.sql) e a equipe lê em /painel/crashes.
//
// Nada sai da máquina sem o jogador clicar em "Enviar".
const { BrowserWindow, ipcMain } = require('electron');
const crypto = require('crypto');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

// Error.log do cliente: texto com XOR de 16 bytes repetidos desde o início do arquivo.
const ERROR_LOG_KEY = Buffer.from('7cbd819f3d93e2562a73d23ef28395bf', 'hex');

const MAX_LOG = 64 * 1024;
const MAX_LUA_LOG = 32 * 1024;
const MAX_DUMP_GZ = 2 * 1024 * 1024;
// O cliente grava o dump antes de fechar; folga para o relógio do arquivo e do launcher.
const START_SLACK_MS = 5000;
const CLIENT_DLLS = ['AsgardCustom.dll', 'AsgardLua.dll', 'glu32.dll', 'Main.dll'];

// Últimos bytes de um arquivo, como texto. Corta a primeira linha, que pode vir pela metade.
async function readTail(file, max, encoding = 'latin1') {
  try {
    const stat = await fs.stat(file);
    const start = Math.max(0, stat.size - max);
    const fd = await fs.open(file, 'r');
    try {
      const buffer = Buffer.alloc(stat.size - start);
      await fs.read(fd, buffer, 0, buffer.length, start);
      let text = buffer.toString(encoding);
      if (start > 0) text = text.slice(text.indexOf('\n') + 1);
      return text;
    } finally {
      await fs.close(fd);
    }
  } catch {
    return null;
  }
}

// Error.log decodificado, só a última sessão do jogo (cada abertura começa com "###### ... Start ######").
async function readErrorLog(file) {
  try {
    const data = await fs.readFile(file);
    const plain = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) plain[i] = data[i] ^ ERROR_LOG_KEY[i % ERROR_LOG_KEY.length];
    // As linhas coreanas são cp949; o Node não tem esse decodificador. "latin1" mantém o texto em inglês.
    const text = plain.toString('latin1');
    const last = text.lastIndexOf('######');
    const sessionStart = last >= 0 ? text.lastIndexOf('######', last - 1) : -1;
    const session = sessionStart >= 0 ? text.slice(sessionStart) : text;
    return session.length > MAX_LOG ? session.slice(session.length - MAX_LOG) : session;
  } catch {
    return null;
  }
}

function lastMatch(text, regex) {
  if (!text) return null;
  let found = null;
  for (const match of text.matchAll(regex)) found = match;
  return found;
}

async function shortMd5(file) {
  try {
    return crypto.createHash('md5').update(await fs.readFile(file)).digest('hex').slice(0, 8);
  } catch {
    return null;
  }
}

class CrashReport {
  /**
   * @param {object} opts
   * @param {() => string} opts.getGameDirectory  pasta do main.exe
   * @param {string} opts.reportUrl               endpoint do site
   * @param {string} [opts.reportToken]           cabeçalho x-crash-token
   * @param {string} opts.launcherVersion
   * @param {() => string} [opts.getHardwareId]   mesmo hash do anti-cheat
   * @param {(pid: number) => string|null} [opts.getCharacter]
   * @param {(key: string, params?: object) => string} opts.t  tradução do launcher
   * @param {() => string} opts.getLanguage       'Eng' | 'Por' | 'Spa'
   * @param {string} [opts.icon]
   * @param {object} opts.store                   electron-store (relatórios já mostrados)
   * @param {(level: string, message: string) => void} [opts.logEvent]
   */
  constructor(opts) {
    this.opts = opts;
    this.logEvent = opts.logEvent || (() => {});
    this.queue = [];
    this.window = null;
    this.current = null;

    ipcMain.handle('crash-report:get', () => this.current && this.current.view);
    ipcMain.handle('crash-report:send', (event, args) => this.send(args || {}));
    ipcMain.handle('crash-report:close', () => this.closeWindow());
  }

  /** Chamado quando um main.exe aberto pelo launcher fecha. */
  async onGameExit({ pid, exitCode, startedAt }) {
    try {
      // O cliente pode terminar de gravar o dump logo depois do fim do processo.
      await new Promise(resolve => setTimeout(resolve, 2000));
      const crash = await this.findCrash(startedAt);
      if (!crash) return;
      crash.pid = pid;
      crash.exitCode = exitCode;
      this.logEvent('warning', `[CrashReport] Crash do jogo (PID ${pid}, código ${crash.exitCodeHex(exitCode)}): ${crash.stackFile || crash.dumpFile}`);
      this.queue.push(crash);
      if (!this.window) this.showNext();
    } catch (error) {
      this.logEvent('error', `[CrashReport] Falha ao ler o crash: ${error.message}`);
    }
  }

  /** stack_*.txt / crash_*.dmp novos (gravados depois do início do jogo) e ainda não mostrados. */
  async findCrash(startedAt) {
    const dir = path.join(this.opts.getGameDirectory(), 'ErrorLog');
    let names;
    try {
      names = await fs.readdir(dir);
    } catch {
      return null;
    }

    const seen = new Set(this.opts.store.get('crashReportsSeen') || []);
    const fresh = [];
    for (const name of names) {
      const match = name.match(/^(stack|crash)_(\d{8}_\d{4,6})\.(txt|dmp)$/i);
      if (!match || seen.has(name)) continue;
      try {
        const stat = await fs.stat(path.join(dir, name));
        if (stat.mtimeMs >= startedAt - START_SLACK_MS) fresh.push({ name, kind: match[1].toLowerCase(), stamp: match[2], mtime: stat.mtimeMs, size: stat.size });
      } catch { /* arquivo sumiu */ }
    }
    if (!fresh.length) return null;

    // O crash mais recente; stack e dump do mesmo crash têm o mesmo carimbo de data.
    fresh.sort((a, b) => b.mtime - a.mtime);
    const stamp = fresh[0].stamp;
    const stack = fresh.find(f => f.kind === 'stack' && f.stamp === stamp);
    const dump = fresh.find(f => f.kind === 'crash' && f.stamp === stamp);

    // Marca todos como vistos: um crash só é perguntado uma vez.
    const all = [...seen, ...fresh.map(f => f.name)].slice(-200);
    this.opts.store.set('crashReportsSeen', all);

    return {
      dir,
      stamp,
      crashedAt: new Date(fresh[0].mtime).toISOString(),
      stackFile: stack ? stack.name : null,
      dumpFile: dump ? dump.name : null,
      dumpSize: dump ? dump.size : 0,
      exitCodeHex: code => (code === null || code === undefined ? null : `0x${(code >>> 0).toString(16).toUpperCase().padStart(8, '0')}`)
    };
  }

  /** Lê tudo que vai no relatório. */
  async collect(crash) {
    const { dir } = crash;
    const stackText = crash.stackFile ? await readTail(path.join(dir, crash.stackFile), 4000) : null;
    const errorLog = await readErrorLog(path.join(dir, 'Error.log'));

    const address = lastMatch(stackText, /\[Exception Address\]\s*(0x[0-9a-f]+)/gi);
    const code = lastMatch(stackText, /\[Exception Code\]\s*([A-Z0-9_]+)/gi);
    // Os campos do Error.log usam tabulações antes do ":"
    const map = lastMatch(errorLog, /OpenWorld\(\) <(?:start|end)>\s*:\s*(\d+)/g);
    const gpu = lastMatch(errorLog, /^\s*Render\s*: ([^\r\n]+)/gm);
    const cpuFromLog = lastMatch(errorLog, /^\s*CPU Name\s*: ([^\r\n]+)/gm);

    const gameDir = this.opts.getGameDirectory();
    const dlls = [];
    for (const name of CLIENT_DLLS) {
      const md5 = await shortMd5(path.join(gameDir, name));
      if (md5) dlls.push(`${name.replace(/\.dll$/i, '')}=${md5}`);
    }

    return {
      reportKey: crypto.randomUUID(),
      characterName: (this.opts.getCharacter && this.opts.getCharacter(crash.pid)) || null,
      crashedAt: crash.crashedAt,
      exitCode: crash.exitCodeHex(crash.exitCode),
      exceptionCode: code ? code[1] : null,
      exceptionAddress: address ? address[1] : null,
      mapId: map ? Number(map[1]) : null,
      launcherVersion: this.opts.launcherVersion,
      dllVersions: dlls.join('; ') || null,
      osVersion: `${typeof os.version === 'function' ? os.version() : 'Windows'} ${os.release()}`,
      cpu: cpuFromLog ? cpuFromLog[1].trim() : ((os.cpus()[0] || {}).model || '').trim() || null,
      gpu: gpu ? gpu[1].trim() : null,
      ramMb: Math.round(os.totalmem() / 1048576),
      hostname: os.hostname(),
      hardwareId: this.opts.getHardwareId ? this.opts.getHardwareId() : null,
      stackText,
      errorLog,
      customLog: await readTail(path.join(dir, 'AsgardCustom.log'), MAX_LOG),
      luaLog: await readTail(path.join(dir, 'AsgardLua.log'), MAX_LUA_LOG)
    };
  }

  async readDump(crash) {
    if (!crash.dumpFile || !crash.dumpSize) return null;
    try {
      const gz = zlib.gzipSync(await fs.readFile(path.join(crash.dir, crash.dumpFile)), { level: 9 });
      if (gz.length > MAX_DUMP_GZ) {
        this.logEvent('warning', `[CrashReport] Dump grande demais (${gz.length} bytes compactado), vai sem ele`);
        return null;
      }
      return { dumpName: crash.dumpFile, dumpSize: crash.dumpSize, dumpGz: gz.toString('base64') };
    } catch (error) {
      this.logEvent('error', `[CrashReport] Falha ao ler o dump: ${error.message}`);
      return null;
    }
  }

  async showNext() {
    const crash = this.queue.shift();
    if (!crash) return;
    const t = this.opts.t;

    this.current = {
      crash,
      payload: null,
      view: {
        language: this.opts.getLanguage(),
        texts: {
          title: t('crash.title'),
          message: t('crash.message'),
          details: t('crash.details'),
          commentLabel: t('crash.commentLabel'),
          commentPlaceholder: t('crash.commentPlaceholder'),
          send: t('crash.send'),
          dontSend: t('crash.dontSend'),
          sending: t('crash.sending'),
          sent: t('crash.sent'),
          failed: t('crash.failed'),
          close: t('crash.close')
        },
        character: (this.opts.getCharacter && this.opts.getCharacter(crash.pid)) || null,
        crashedAt: crash.crashedAt,
        hasDump: !!crash.dumpFile
      }
    };

    this.window = new BrowserWindow({
      width: 460,
      height: 430,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      frame: false,
      show: false,
      icon: this.opts.icon,
      title: t('crash.title'),
      backgroundColor: '#0f0d0a',
      webPreferences: { nodeIntegration: true, contextIsolation: false, devTools: false }
    });
    this.window.setMenu(null);
    this.window.once('ready-to-show', () => {
      this.window.show();
      this.window.focus();
    });
    this.window.on('closed', () => {
      this.window = null;
      this.current = null;
      // Próximo crash da fila (vários clientes abertos)
      setTimeout(() => this.showNext(), 500);
    });
    this.window.loadFile(path.join(__dirname, '..', 'renderer', 'crash-report.html')).catch(error => {
      this.logEvent('error', `[CrashReport] Falha ao abrir a janela: ${error.message}`);
    });
  }

  closeWindow() {
    if (this.window) this.window.close();
  }

  /** Botão "Enviar". Retorna { ok, error }. */
  async send({ comment }) {
    const current = this.current;
    if (!current) return { ok: false, error: 'no report' };
    if (!this.opts.reportUrl) return { ok: false, error: 'no url' };

    try {
      // O mesmo reportKey em uma nova tentativa: o site não grava duas vezes.
      if (!current.payload) {
        current.payload = {
          ...(await this.collect(current.crash)),
          ...((await this.readDump(current.crash)) || {})
        };
      }
      const body = { ...current.payload, comment: typeof comment === 'string' ? comment.slice(0, 1000) : null };
      const axios = require('axios');
      await axios.post(this.opts.reportUrl, body, {
        timeout: 60000,
        maxBodyLength: 8 * 1024 * 1024,
        headers: this.opts.reportToken ? { 'x-crash-token': this.opts.reportToken } : {}
      });
      this.logEvent('info', `[CrashReport] Relatório enviado (${current.payload.reportKey})`);
      return { ok: true };
    } catch (error) {
      const status = error.response ? ` (HTTP ${error.response.status})` : '';
      this.logEvent('error', `[CrashReport] Falha ao enviar${status}: ${error.message}`);
      return { ok: false, error: `${error.message}${status}` };
    }
  }
}

module.exports = CrashReport;
