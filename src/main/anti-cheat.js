const { exec } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const execAsync = promisify(exec);

/**
 * Anti-cheat local — detecção no lado do cliente.
 *
 * Varre os processos em execução a cada `scanIntervalMs`. Quando o nome do
 * processo OU o título da janela casa com a lista de proibidos, o launcher:
 *   1. encerra o jogo (callback `killGame`);
 *   2. registra o evento no histórico do site (POST na API, só para consulta);
 *   3. avisa a interface (callback `onDetection`).
 *
 * O banimento NÃO é feito aqui. A tabela web.anticheat_detections guarda apenas
 * o histórico; a decisão de banir fica com o administrador.
 *
 * As regras padrão abaixo podem ser sobrescritas por um arquivo JSON opcional
 * (ver `loadRules`), para o admin ajustar a lista sem recompilar o launcher.
 */

// Tokens casados como SUBSTRING do nome do processo (sem ".exe"), em minúsculas.
const DEFAULT_PROCESS_TOKENS = [
  'cheatengine', 'cheat engine', 'artmoney', 'wemod',
  'speedhack', 'speedgear', 'speeder', 'squallmeta',
  'ollydbg', 'x64dbg', 'x32dbg', 'windbg', 'ghidra', 'scyllahide',
  'processhacker', 'injector', 'extremeinjector', 'xenos',
  'wpepro', 'wpe pro', 'rpe', 'fiddler', 'wireshark', 'charles',
  'openkore', 'autoit', 'ahk', 'autohotkey', 'mhs', 'tsearch'
];

// Tokens casados como SUBSTRING do título da janela, em minúsculas.
const DEFAULT_WINDOW_TOKENS = [
  'cheat engine', 'artmoney', 'wemod', 'process hacker',
  'x64dbg', 'x32dbg', 'ollydbg', 'ida -', 'ida pro',
  'wpe pro', 'winject', 'extreme injector'
];

// Processos do jogo, para extrair os personagens ativos (título "... Name: X ...").
const GAME_PROCESS_NAMES = ['main'];

class AntiCheat {
  /**
   * @param {object} opts
   * @param {(level: string, message: string) => void} [opts.logEvent]
   * @param {(reason: object) => void} [opts.killGame]      encerra o jogo
   * @param {(payload: object) => void} [opts.onDetection]  notifica a interface
   * @param {string} [opts.reportUrl]   endpoint do site (POST). Vazio = não reporta.
   * @param {string} [opts.reportToken] token compartilhado enviado no cabeçalho
   * @param {string} [opts.rulesFile]   caminho de um JSON de regras opcional
   */
  constructor(opts = {}) {
    this.logEvent = opts.logEvent || (() => {});
    this.killGame = opts.killGame || (() => {});
    this.onDetection = opts.onDetection || (() => {});
    this.reportUrl = opts.reportUrl || '';
    this.reportToken = opts.reportToken || '';

    const rules = this.loadRules(opts.rulesFile);
    this.processTokens = rules.processTokens;
    this.windowTokens = rules.windowTokens;

    this.scanInterval = null;
    this.isScanning = false;
    this.hardwareId = this.computeHardwareId();
    // Evita reportar o mesmo ofensor repetidamente dentro de uma sessão.
    this.reported = new Set();
  }

  /** Mescla as regras padrão com um JSON opcional ({ processTokens, windowTokens }). */
  loadRules(rulesFile) {
    const base = {
      processTokens: [...DEFAULT_PROCESS_TOKENS],
      windowTokens: [...DEFAULT_WINDOW_TOKENS]
    };
    if (!rulesFile) return base;
    try {
      if (!fs.existsSync(rulesFile)) return base;
      const custom = JSON.parse(fs.readFileSync(rulesFile, 'utf8'));
      const norm = (list) => (Array.isArray(list) ? list.map((s) => String(s).toLowerCase().trim()).filter(Boolean) : []);
      // O JSON substitui a lista correspondente quando ela vem preenchida.
      const p = norm(custom.processTokens);
      const w = norm(custom.windowTokens);
      return {
        processTokens: p.length ? p : base.processTokens,
        windowTokens: w.length ? w : base.windowTokens
      };
    } catch (error) {
      this.logEvent('warning', `[AntiCheat] Falha ao ler regras (${rulesFile}): ${error.message}`);
      return base;
    }
  }

  /** ID estável da máquina: hostname + primeiro MAC físico, em SHA-256 (16 bytes). */
  computeHardwareId() {
    try {
      const ifaces = os.networkInterfaces();
      let mac = '';
      for (const name of Object.keys(ifaces)) {
        for (const net of ifaces[name] || []) {
          if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
            mac = net.mac;
            break;
          }
        }
        if (mac) break;
      }
      const raw = `${os.hostname()}|${mac}`;
      return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32);
    } catch {
      return '';
    }
  }

  /** Uma varredura. Retorna a lista de ofensores encontrados. */
  async scanOnce() {
    if (process.platform !== 'win32') return [];

    let processes;
    try {
      processes = await this.listProcesses();
    } catch (error) {
      this.logEvent('error', `[AntiCheat] Falha na varredura: ${error.message}`);
      return [];
    }

    const characters = this.extractCharacters(processes);
    const hits = [];

    for (const proc of processes) {
      const name = (proc.name || '').toLowerCase();
      const title = (proc.title || '').toLowerCase();
      if (GAME_PROCESS_NAMES.includes(name)) continue;

      const byProcess = this.processTokens.find((token) => name.includes(token));
      const byWindow = this.windowTokens.find((token) => title && title.includes(token));
      if (!byProcess && !byWindow) continue;

      hits.push({
        detectionType: byProcess ? 'process' : 'window',
        offenderName: proc.name || '(desconhecido)',
        offenderDetail: byProcess ? `match: ${byProcess}` : `title: ${proc.title}`,
        offenderPath: proc.path || null,
        pid: proc.pid || null,
        characters
      });
    }

    return hits;
  }

  /** Lista processos (Id, nome, título, caminho) via PowerShell. */
  async listProcesses() {
    const psScript = [
      'Get-Process -ErrorAction SilentlyContinue |',
      'Select-Object Id, ProcessName, MainWindowTitle, @{N="Path";E={$_.Path}} |',
      'ConvertTo-Json -Compress'
    ].join(' ');

    const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
    const { stdout } = await execAsync(
      `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`,
      { maxBuffer: 8 * 1024 * 1024 }
    );

    if (!stdout || !stdout.trim()) return [];
    const parsed = JSON.parse(stdout);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.map((p) => ({
      pid: p.Id,
      name: p.ProcessName || '',
      title: (p.MainWindowTitle || '').trim(),
      path: p.Path || null
    }));
  }

  /** Extrai nomes de personagem dos títulos das janelas do jogo (padrão "Name: X"). */
  extractCharacters(processes) {
    const names = [];
    for (const proc of processes) {
      if (!GAME_PROCESS_NAMES.includes((proc.name || '').toLowerCase())) continue;
      const match = (proc.title || '').match(/Name:\s*([a-zA-Z0-9_-]{3,20})/i);
      if (match && !names.includes(match[1])) names.push(match[1]);
    }
    return names;
  }

  /** Trata os ofensores: encerra o jogo, reporta e notifica a interface. */
  async handleHits(hits) {
    if (!hits.length) return;

    const first = hits[0];
    this.logEvent('warning', `[AntiCheat] Programa não permitido: ${first.offenderName} (${first.detectionType})`);

    this.killGame({ reason: 'anticheat', offender: first.offenderName });
    this.onDetection({ offenderName: first.offenderName, detectionType: first.detectionType });

    for (const hit of hits) {
      const key = `${hit.detectionType}:${hit.offenderName}:${hit.offenderDetail}`;
      if (this.reported.has(key)) continue;
      this.reported.add(key);
      await this.report(hit);
    }
  }

  /** Grava o evento no histórico do site. Falha de rede nunca derruba o launcher. */
  async report(hit) {
    if (!this.reportUrl) return;
    try {
      const axios = require('axios');
      await axios.post(
        this.reportUrl,
        {
          detectionType: hit.detectionType,
          offenderName: hit.offenderName,
          offenderDetail: hit.offenderDetail,
          offenderPath: hit.offenderPath,
          characterName: hit.characters[0] || null,
          characters: hit.characters,
          hostname: os.hostname(),
          hardwareId: this.hardwareId
        },
        {
          timeout: 8000,
          headers: this.reportToken ? { 'x-anticheat-token': this.reportToken } : {}
        }
      );
      this.logEvent('info', `[AntiCheat] Detecção registrada: ${hit.offenderName}`);
    } catch (error) {
      const status = error.response ? ` (HTTP ${error.response.status})` : '';
      this.logEvent('error', `[AntiCheat] Falha ao registrar detecção${status}: ${error.message}`);
    }
  }

  startMonitoring(intervalMs = 5000) {
    if (this.scanInterval) clearInterval(this.scanInterval);
    this.isScanning = true;
    const tick = async () => {
      try {
        const hits = await this.scanOnce();
        await this.handleHits(hits);
      } catch (error) {
        this.logEvent('error', `[AntiCheat] Erro no monitoramento: ${error.message}`);
      }
    };
    tick();
    this.scanInterval = setInterval(tick, intervalMs);
    this.logEvent('info', `[AntiCheat] Monitoramento iniciado (intervalo ${intervalMs} ms)`);
  }

  stopMonitoring() {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    this.isScanning = false;
  }

  isActive() {
    return this.isScanning;
  }
}

module.exports = AntiCheat;
