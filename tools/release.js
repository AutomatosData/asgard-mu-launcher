#!/usr/bin/env node
/**
 * Publicação do AsgardMU nos GitHub Releases (passo a passo em PUBLICAR.md)
 *
 *   node tools/release.js status     mostra o que está publicado e o que mudou na pasta do cliente
 *   node tools/release.js client     publica o cliente completo em partes .zip (primeira instalação)
 *   node tools/release.js patch      publica os arquivos do cliente alterados desde a última publicação
 *   node tools/release.js launcher   publica dist/AsgardMU-Setup-<versão>.exe (rode "npm run dist" antes)
 *
 * Opções:
 *   --client <pasta>   pasta do cliente (padrão: ../Asgard-Mu-ClientS21)
 *   --dry-run          mostra o que seria publicado e não envia nada
 *   --local            publica em .release-local/ em vez do GitHub (teste: npm run release:serve)
 *   --yes              não pede confirmação
 *   --part-size <MB>   (client) tamanho máximo de cada parte, antes de compactar (padrão 1800)
 *   --force            (client) publica mesmo com alterações que ainda não saíram em patch
 *   --reset            (client) recomeça do zero: manifesto sem patches; apaga os releases client-* antigos
 *                      e todos os patch-*. Quem já tem o jogo não recebe as alterações pendentes
 *
 * Releases no repositório GitHub de url-config.js (GITHUB.OWNER / GITHUB.REPO):
 *   current              update.json (manifesto lido pelo launcher) e AsgardMU-Setup.exe (link fixo)
 *   client-<versão>      partes .zip do cliente + client-files.json (MD5 de cada arquivo)
 *   patch-<versão>       um arquivo por alteração, com o nome "<md5>-<nome>"
 *   launcher-v<versão>   AsgardMU-Setup-<versão>.exe
 * O update.json é sempre o último envio: o jogador nunca recebe um manifesto que aponta
 * para arquivos ainda não enviados.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { spawnSync } = require('child_process');
const StreamZip = require('node-stream-zip');
const URL_CONFIG = require('../src/shared/url-config');

const ROOT = path.resolve(__dirname, '..');
const PKG = require(path.join(ROOT, 'package.json'));
const { OWNER, REPO, CURRENT_TAG } = URL_CONFIG.GITHUB;
const MANIFEST = URL_CONFIG.UPDATE.MANIFEST;
const SNAPSHOT = 'client-files.json';
const SETUP_STABLE = 'AsgardMU-Setup.exe';

const CACHE_FILE = path.join(ROOT, '.release-cache', 'hashes.json');
const LOCAL_DIR = path.join(ROOT, '.release-local');
const OUT_DIR = path.join(ROOT, '.release-out');
const DEFAULT_CLIENT = path.resolve(ROOT, '..', 'Asgard-Mu-ClientS21');
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');

const MB = 1024 * 1024;
// GitHub: no máximo 2 GiB por arquivo e 1000 arquivos por release (com folga)
const ASSET_LIMIT = 2048 * MB - 32 * MB;
const MAX_ASSETS = 900;

// ===== REGRAS DOS ARQUIVOS DO CLIENTE =====
// Caminhos relativos à pasta do cliente, com "/" e em minúsculas.

// Arquivos do launcher (Electron): vêm do instalador, nunca do cliente. O instalador põe o
// launcher em "Launcher/" e um AsgardMU.exe pequeno na raiz (build/installer.nsh); as
// instalações antigas têm os arquivos na raiz
const LAUNCHER_FILES = new Set([
  'asgardmu.exe', 'uninstall asgardmu.exe', 'chrome_100_percent.pak', 'chrome_200_percent.pak',
  'resources.pak', 'icudtl.dat', 'snapshot_blob.bin', 'v8_context_snapshot.bin', 'version',
  'vk_swiftshader.dll', 'vk_swiftshader_icd.json', 'vulkan-1.dll', 'ffmpeg.dll',
  'd3dcompiler_47.dll', 'dxcompiler.dll', 'dxil.dll', 'libegl.dll', 'libglesv2.dll',
  'license.electron.txt', 'licenses.chromium.html'
]);
const LAUNCHER_DIRS = ['launcher/', 'resources/', 'locales/'];

// Nunca publicados: logs, backups, dados locais do jogador e do desenvolvedor
const IGNORE = [
  /\.log$/, /\.bak$/, /\.bak-[^/]*$/, /\.download$/, /(^|\/)thumbs\.db$/, /(^|\/)desktop\.ini$/,
  /^_backup\//, /^errorlog\//, /^screenshots\//, /^data\/launcher\//, /^data\/temp\//,
  /^data\/custom\/luascript\/inbox\//,
  // Cache das texturas do Jewel Bank: o JewelBank.lua grava a cada login. Vai só a pasta
  // vazia (pastas sem arquivos publicados entram vazias no zip; o Lua não cria a pasta)
  /^data\/custom\/jewelbank\/_tmp\//,
  /^launcheroption\.if$/, // resolução, conta e idioma do jogador (o launcher cria)
  /^diagnostico_mu\.txt$/, /^main\.bat$/
];

// Preferências do jogador: vão no cliente completo; no patch só se forem arquivos novos,
// com "keep" (o launcher baixa só se o jogador não tiver o arquivo)
const SEED = [
  /^option\.ini$/,
  /^data\/sound\/option\.ini$/, // volume e mudo dos canais de som (o jogo grava)
  /\.pos$/ // posição das janelas Lua
];

function classify(rel) {
  const key = rel.toLowerCase();
  if (LAUNCHER_FILES.has(key) || LAUNCHER_DIRS.some(dir => key.startsWith(dir))) return 'launcher';
  if (IGNORE.some(rule => rule.test(key))) return 'ignore';
  if (SEED.some(rule => rule.test(key))) return 'seed';
  return 'game';
}

// ===== UTILITÁRIOS =====

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      const next = argv[i + 1];
      if (['client', 'part-size', 'from'].includes(name)) {
        args[name] = next;
        i++;
      } else {
        args[name] = true;
      }
    } else {
      args._.push(arg);
    }
  }
  return args;
}

function fail(message) {
  const error = new Error(message);
  error.userError = true;
  throw error;
}

function formatSize(bytes) {
  if (bytes >= 1024 * MB) return `${(bytes / 1024 / MB).toFixed(2)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

// "1.2.10" > "1.2.9" (mesma regra de src/main/launcher-update.js)
function isNewer(remote, local) {
  const a = String(remote).split('.').map(n => parseInt(n, 10) || 0);
  const b = String(local).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

// Versão por data e hora local: 2026.10.22-1530
function newVersion() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

async function md5File(filePath) {
  const hash = crypto.createHash('md5');
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

// Nome de asset aceito pelo GitHub sem renomear
function assetName(hash, rel) {
  const base = path.posix.basename(rel).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+|[._]+$/g, '');
  return `${hash}-${base || 'file'}`;
}

async function confirm(question, args) {
  if (args.yes) return true;
  if (!process.stdin.isTTY) fail('Sem terminal para confirmar. Rode de novo com --yes.');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise(resolve => rl.question(`${question} (s/N) `, resolve));
  rl.close();
  return /^s(im)?$/i.test(answer.trim());
}

// O GitHub recusa (HTTP 403, limite secundário) mais de ~80 criações por minuto. Cada arquivo enviado
// conta: no máximo UPLOAD_BATCH arquivos a cada UPLOAD_PACE_MS; depois de uma recusa, espera UPLOAD_WAITS.
const UPLOAD_BATCH = 40;
const UPLOAD_PACE_MS = 40000;
const UPLOAD_WAITS = [30, 60, 120, 300, 600, 900, 900];
const UPLOAD_TRIES = UPLOAD_WAITS.length + 1;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true, ...options });
  if (result.error) throw result.error;
  return result.status;
}

// ===== DESTINO: GITHUB OU PASTA LOCAL =====

class GitHubTarget {
  constructor() {
    this.repo = `${OWNER}/${REPO}`;
    this.label = `GitHub ${this.repo}`;
    this.baseUrl = URL_CONFIG.GITHUB.DOWNLOAD_URL;
  }

  check() {
    const result = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8', windowsHide: true });
    if (result.error) fail('GitHub CLI (gh) não encontrado. Instale com: winget install GitHub.cli');
    if (result.status !== 0) fail('GitHub CLI sem login. Rode: gh auth login');
  }

  async download(tag, name) {
    const response = await fetch(`${this.baseUrl}${tag}/${encodeURIComponent(name)}?t=${Date.now()}`);
    if (response.status === 404) return null;
    if (!response.ok) fail(`Falha ao baixar ${tag}/${name}: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  releaseExists(tag) {
    const result = spawnSync('gh', ['release', 'view', tag, '--repo', this.repo, '--json', 'tagName'],
      { encoding: 'utf8', windowsHide: true });
    return result.status === 0;
  }

  releaseTags() {
    const list = spawnSync('gh', ['release', 'list', '--repo', this.repo, '--limit', '1000', '--json', 'tagName'],
      { encoding: 'utf8', windowsHide: true });
    if (list.status !== 0) fail('Falha ao listar os releases');
    return JSON.parse(list.stdout).map(release => release.tagName);
  }

  deleteRelease(tag) {
    if (run('gh', ['release', 'delete', tag, '--repo', this.repo, '--cleanup-tag', '--yes']) !== 0) {
      fail(`Falha ao apagar o release ${tag}`);
    }
  }

  createRelease(tag, { title, notes, latest }) {
    const args = ['release', 'create', tag, '--repo', this.repo, '--title', title, '--notes', notes,
      `--latest=${latest ? 'true' : 'false'}`];
    // A conexão com o GitHub às vezes cai: tenta de novo; o release pode ter sido criado mesmo assim
    for (let attempt = 1; ; attempt++) {
      if (run('gh', args) === 0 || this.releaseExists(tag)) return;
      if (attempt === UPLOAD_TRIES) fail(`Falha ao criar o release ${tag}`);
      console.log(`  falhou ao criar ${tag}; nova tentativa ${attempt + 1}/${UPLOAD_TRIES} em ${UPLOAD_WAITS[attempt - 1]} s`);
      sleepSync(UPLOAD_WAITS[attempt - 1] * 1000);
    }
  }

  // Arquivos completos que já estão nos releases patch-* (nome -> { tag, size }). Um envio que caiu deixa
  // um release com parte dos arquivos; o próximo patch reaproveita esses arquivos em vez de enviar de novo.
  patchAssets() {
    const found = new Map();
    for (const tagName of this.releaseTags()) {
      if (!tagName.startsWith('patch-')) continue;
      const view = spawnSync('gh', ['release', 'view', tagName, '--repo', this.repo, '--json', 'assets'],
        { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * MB });
      if (view.status !== 0) fail(`Falha ao ler o release ${tagName}`);
      for (const asset of JSON.parse(view.stdout).assets) {
        if (asset.state === 'uploaded' && !found.has(asset.name)) found.set(asset.name, { tag: tagName, size: asset.size });
      }
    }
    return found;
  }

  // files (caminhos locais) que ainda não estão completos no release; apaga os que ficaram pela metade
  unfinished(tag, files) {
    const view = spawnSync('gh', ['api', '--paginate', `repos/${this.repo}/releases/tags/${tag}`, '--jq',
      '.assets[] | [.id, .name, .state, .size] | @tsv'], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * MB });
    if (view.status !== 0) return files;
    const assets = new Map(view.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => {
      const [id, name, state, size] = line.split('\t');
      return [name, { id, state, size: Number(size) }];
    }));
    return files.filter(file => {
      const asset = assets.get(path.basename(file));
      if (!asset) return true;
      if (asset.state === 'uploaded' && asset.size === fs.statSync(file).size) return false;
      spawnSync('gh', ['api', '-X', 'DELETE', `repos/${this.repo}/releases/assets/${asset.id}`],
        { encoding: 'utf8', windowsHide: true });
      return true;
    });
  }

  upload(tag, files, { clobber = false } = {}) {
    // Em lotes, para não passar do limite da linha de comando do Windows
    for (let i = 0; i < files.length; i += UPLOAD_BATCH) {
      const batch = files.slice(i, i + UPLOAD_BATCH);
      const started = Date.now();
      // Uma nova tentativa envia só o que falta: um envio que caiu deixa arquivos completos (pulados) e
      // arquivos pela metade (estado diferente de "uploaded"), que bloqueiam o nome até serem apagados
      let pending = batch;
      for (let attempt = 1; ; attempt++) {
        if (attempt > 1) pending = this.unfinished(tag, pending);
        if (!pending.length) break;
        const args = ['release', 'upload', tag, ...pending, '--repo', this.repo];
        if (clobber) args.push('--clobber');
        if (run('gh', args) === 0) break;
        if (attempt === UPLOAD_TRIES) fail(`Falha ao enviar arquivos para o release ${tag}`);
        console.log(`  lote ${i / UPLOAD_BATCH + 1} falhou; nova tentativa ${attempt + 1}/${UPLOAD_TRIES} em ${UPLOAD_WAITS[attempt - 1]} s`);
        sleepSync(UPLOAD_WAITS[attempt - 1] * 1000);
      }
      if (i + UPLOAD_BATCH < files.length) sleepSync(Math.max(0, UPLOAD_PACE_MS - (Date.now() - started)));
      if (files.length > UPLOAD_BATCH) console.log(`  ${Math.min(i + UPLOAD_BATCH, files.length)}/${files.length} arquivos enviados`);
    }
  }
}

// Mesma estrutura do GitHub em .release-local/<tag>/<arquivo> (servida por tools/serve-local.js)
class LocalTarget {
  constructor() {
    this.label = `pasta local ${LOCAL_DIR}`;
  }

  check() {}

  async download(tag, name) {
    try {
      return await fsp.readFile(path.join(LOCAL_DIR, tag, name));
    } catch {
      return null;
    }
  }

  releaseExists(tag) {
    return fs.existsSync(path.join(LOCAL_DIR, tag));
  }

  createRelease(tag) {
    fs.mkdirSync(path.join(LOCAL_DIR, tag), { recursive: true });
  }

  releaseTags() {
    return fs.existsSync(LOCAL_DIR) ? fs.readdirSync(LOCAL_DIR) : [];
  }

  deleteRelease(tag) {
    fs.rmSync(path.join(LOCAL_DIR, tag), { recursive: true, force: true });
  }

  patchAssets() {
    const found = new Map();
    if (!fs.existsSync(LOCAL_DIR)) return found;
    for (const tag of fs.readdirSync(LOCAL_DIR)) {
      if (!tag.startsWith('patch-')) continue;
      for (const name of fs.readdirSync(path.join(LOCAL_DIR, tag))) {
        if (!found.has(name)) found.set(name, { tag, size: fs.statSync(path.join(LOCAL_DIR, tag, name)).size });
      }
    }
    return found;
  }

  upload(tag, files) {
    const dir = path.join(LOCAL_DIR, tag);
    fs.mkdirSync(dir, { recursive: true });
    for (const file of files) {
      fs.copyFileSync(file, path.join(dir, path.basename(file)));
    }
  }
}

// URL relativa ao update.json (current/update.json) -> { tag, name }
function parseRelativeUrl(url) {
  const match = /^\.\.\/([^/]+)\/([^/?#]+)$/.exec(url || '');
  return match ? { tag: match[1], name: decodeURIComponent(match[2]) } : null;
}

async function loadManifest(target) {
  const data = await target.download(CURRENT_TAG, MANIFEST);
  return data ? JSON.parse(data.toString('utf8')) : null;
}

async function loadSnapshot(target, manifest) {
  const ref = parseRelativeUrl(manifest.client && manifest.client.snapshot);
  if (!ref) fail('update.json sem client.snapshot');
  const data = await target.download(ref.tag, ref.name);
  if (!data) fail(`Não achei ${ref.tag}/${ref.name}`);
  return JSON.parse(data.toString('utf8'));
}

function ensureCurrentRelease(target) {
  if (!target.releaseExists(CURRENT_TAG)) {
    target.createRelease(CURRENT_TAG, {
      title: 'AsgardMU - versão atual',
      notes: [
        'Release usado pelo launcher. Não apague.',
        '',
        `- \`${MANIFEST}\`: manifesto (cliente completo, launcher e patches)`,
        `- \`${SETUP_STABLE}\`: instalador atual do launcher`
      ].join('\n'),
      latest: true
    });
  }
}

async function publishManifest(target, manifest) {
  ensureCurrentRelease(target);
  const dir = path.join(OUT_DIR, CURRENT_TAG);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, MANIFEST);
  fs.writeFileSync(file, JSON.stringify(manifest, null, 1));
  target.upload(CURRENT_TAG, [file], { clobber: true });
}

// ===== LEITURA DA PASTA DO CLIENTE =====

async function scanClient(clientDir) {
  if (!fs.existsSync(path.join(clientDir, URL_CONFIG.GAME_EXECUTABLE))) {
    fail(`Pasta do cliente sem ${URL_CONFIG.GAME_EXECUTABLE}: ${clientDir}`);
  }

  const files = [];
  const emptyDirs = [];
  const counts = { launcher: 0, ignore: 0 };

  async function walk(dirRel) {
    const entries = await fsp.readdir(path.join(clientDir, dirRel), { withFileTypes: true });
    let published = 0;
    for (const entry of entries) {
      const rel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (LAUNCHER_DIRS.includes(`${rel.toLowerCase()}/`)) {
          counts.launcher++;
          continue;
        }
        published += await walk(rel);
      } else if (entry.isFile()) {
        const kind = classify(rel);
        if (kind === 'launcher' || kind === 'ignore') {
          counts[kind]++;
          continue;
        }
        if (/[^\x20-\x7e]/.test(rel)) fail(`Nome com acento ou caractere especial (renomeie): ${rel}`);
        files.push({ path: rel, seed: kind === 'seed' });
        published++;
      }
    }
    // Pastas que o jogo espera e que ficariam vazias (ex.: ScreenShots) vão no zip mesmo assim
    if (dirRel && published === 0) emptyDirs.push(dirRel);
    return published;
  }

  await walk('');
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return { files, emptyDirs, counts };
}

// Tamanho e MD5 de cada arquivo; o cache evita recalcular o que não mudou
async function hashFiles(clientDir, files) {
  let cache = {};
  try {
    cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {}

  let done = 0;
  let lastPrint = 0;
  const queue = [...files];
  async function worker() {
    while (queue.length) {
      const file = queue.shift();
      const full = path.join(clientDir, file.path);
      const stats = await fsp.stat(full);
      const key = full.toLowerCase();
      const cached = cache[key];
      file.size = stats.size;
      if (cached && cached[0] === stats.size && cached[1] === stats.mtimeMs) {
        file.hash = cached[2];
      } else {
        file.hash = await md5File(full);
        cache[key] = [stats.size, stats.mtimeMs, file.hash];
      }
      done++;
      if (Date.now() - lastPrint > 2000) {
        lastPrint = Date.now();
        process.stdout.write(`\r  Calculando MD5: ${done}/${files.length}`);
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  process.stdout.write(`\r  Calculando MD5: ${done}/${files.length}\n`);

  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
}

async function readClient(args) {
  const clientDir = path.resolve(args.client || DEFAULT_CLIENT);
  console.log(`Cliente: ${clientDir}`);
  const scan = await scanClient(clientDir);
  await hashFiles(clientDir, scan.files);
  const total = scan.files.reduce((sum, file) => sum + file.size, 0);
  console.log(`  ${scan.files.length} arquivos (${formatSize(total)}); fora da publicação: ` +
    `${scan.counts.launcher} do launcher, ${scan.counts.ignore} logs/backups/dados locais`);
  return { clientDir, ...scan, total };
}

// O que o jogador tem hoje: cliente completo + patches do manifesto
function publishedState(snapshot, manifest) {
  const state = new Map();
  for (const [rel, [size, hash]] of Object.entries(snapshot.files)) {
    state.set(rel.toLowerCase(), { path: rel, size, hash });
  }
  for (const file of manifest.files || []) {
    state.set(file.path.toLowerCase(), file);
  }
  return state;
}

function diffClient(local, state) {
  const changed = [];
  const added = [];
  const seen = new Set();
  for (const file of local.files) {
    const key = file.path.toLowerCase();
    seen.add(key);
    const published = state.get(key);
    if (!published) {
      added.push(file);
    } else if (published.size !== file.size || published.hash !== file.hash) {
      // Preferência do jogador alterada: fica a do jogador
      if (!file.seed) changed.push(file);
    }
  }
  const removed = [...state.values()].filter(file => !seen.has(file.path.toLowerCase()) &&
    !['launcher', 'ignore'].includes(classify(file.path)));
  return { changed, added, removed };
}

function printList(title, files, max = 25) {
  if (!files.length) return;
  console.log(`  ${title}: ${files.length}`);
  for (const file of files.slice(0, max)) {
    console.log(`    ${file.path}${file.size !== undefined ? ` (${formatSize(file.size)})` : ''}`);
  }
  if (files.length > max) console.log(`    ... e mais ${files.length - max}`);
}

// ===== COMANDOS =====

async function cmdStatus(target, args) {
  const manifest = await loadManifest(target);
  console.log(`Destino: ${target.label}`);
  if (!manifest) {
    console.log('Nada publicado ainda. Comece com: npm run release:client');
    return;
  }

  console.log(`Manifesto: versão ${manifest.version} (${manifest.updatedAt || '?'})`);
  if (manifest.client) {
    const size = manifest.client.parts.reduce((sum, part) => sum + part.size, 0);
    console.log(`  Cliente completo: ${manifest.client.tag}, ${manifest.client.parts.length} partes, ${formatSize(size)}`);
  } else {
    console.log('  Cliente completo: não publicado');
  }
  console.log(`  Launcher: ${manifest.launcher ? manifest.launcher.version : 'não publicado'}`);
  console.log(`  Arquivos em patch: ${(manifest.files || []).length}`);

  if (!manifest.client) return;
  const snapshot = await loadSnapshot(target, manifest);
  const local = await readClient(args);
  const diff = diffClient(local, publishedState(snapshot, manifest));
  if (!diff.changed.length && !diff.added.length && !diff.removed.length) {
    console.log('Pasta do cliente igual ao publicado.');
    return;
  }
  console.log('Diferenças da pasta do cliente para o publicado:');
  printList('Alterados', diff.changed);
  printList('Novos', diff.added);
  printList('Apagados (o patch não apaga arquivos no jogador)', diff.removed);
}

async function cmdClient(target, args) {
  const manifest = await loadManifest(target);
  const local = await readClient(args);

  if (manifest && manifest.client && !args.force && !args.reset) {
    const snapshot = await loadSnapshot(target, manifest);
    const diff = diffClient(local, publishedState(snapshot, manifest));
    if (diff.changed.length || diff.added.filter(file => !file.seed).length) {
      fail('Há alterações ainda não publicadas em patch. Quem já tem o jogo não recebe o cliente novo.\n' +
        'Rode "npm run release:patch" antes, ou use --force.');
    }
  }

  const partLimit = Math.min(ASSET_LIMIT, (parseInt(args['part-size'], 10) || 1800) * MB);
  const parts = [];
  let current = null;
  for (const file of local.files) {
    if (file.size > ASSET_LIMIT) fail(`Arquivo maior que o limite do GitHub (2 GB): ${file.path}`);
    if (!current || (current.size + file.size > partLimit && current.files.length)) {
      current = { files: [], size: 0 };
      parts.push(current);
    }
    current.files.push(file);
    current.size += file.size;
  }

  const version = newVersion();
  const tag = `client-${version}`;
  console.log(`\nCliente ${version}: ${parts.length} parte(s)`);
  parts.forEach((part, i) => console.log(`  parte ${i + 1}: ${part.files.length} arquivos, ${formatSize(part.size)} sem compactar`));
  if (args['dry-run']) {
    console.log('\n--dry-run: nada foi compactado nem enviado.');
    return;
  }

  // Compactar com o tar.exe do Windows (o "tar" do Git Bash não cria .zip)
  if (!fs.existsSync(TAR)) fail(`tar.exe não encontrado em ${TAR}`);
  const outDir = path.join(OUT_DIR, tag);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const partInfo = [];
  for (const [i, part] of parts.entries()) {
    const name = `AsgardMU-Client-${version}.part${i + 1}.zip`;
    const zipPath = path.join(outDir, name);
    const listPath = path.join(outDir, `part${i + 1}.txt`);
    const entries = part.files.map(file => file.path);
    // Pasta sem "/" no fim: com a barra, o tar.exe do Windows lê lixo no lugar do nome
    if (i === 0) entries.unshift(...local.emptyDirs);
    fs.writeFileSync(listPath, entries.join('\n') + '\n');

    console.log(`Compactando parte ${i + 1}/${parts.length}...`);
    // -n: sem recursão (pastas da lista entram vazias; arquivos só os listados)
    if (run(TAR, ['-a', '-c', '-n', '-f', zipPath, '-C', local.clientDir, '-T', listPath]) !== 0) {
      fail(`tar.exe falhou na parte ${i + 1}`);
    }

    const size = fs.statSync(zipPath).size;
    if (size > ASSET_LIMIT) fail(`Parte ${i + 1} ficou com ${formatSize(size)}. Use um --part-size menor.`);
    const zip = new StreamZip.async({ file: zipPath });
    const count = await zip.entriesCount;
    await zip.close();
    if (count !== entries.length) fail(`Parte ${i + 1}: ${count} itens no zip, esperado ${entries.length}`);

    partInfo.push({ name, url: `../${tag}/${name}`, size, hash: await md5File(zipPath) });
    fs.rmSync(listPath);
    console.log(`  ${name}: ${formatSize(size)}`);
  }

  const snapshot = {
    version,
    files: Object.fromEntries(local.files.map(file => [file.path, [file.size, file.hash]]))
  };
  const snapshotPath = path.join(outDir, SNAPSHOT);
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot));

  const zipped = partInfo.reduce((sum, part) => sum + part.size, 0);
  console.log(`\nCliente ${version}: ${partInfo.length} parte(s), ${formatSize(zipped)} para baixar`);
  if (args.reset) console.log('--reset: o manifesto fica sem patches e os releases client-*/patch-* antigos serão apagados.');
  if (!await confirm(`Publicar o cliente em ${target.label}?`, args)) {
    console.log(`Cancelado. Arquivos em ${outDir}`);
    return;
  }

  target.check();
  target.createRelease(tag, {
    title: `Cliente ${version}`,
    notes: `Cliente completo do AsgardMU (primeira instalação pelo launcher).\n\n` +
      `${local.files.length} arquivos, ${formatSize(local.total)} instalados, ${partInfo.length} parte(s).`,
    latest: false
  });
  target.upload(tag, [...partInfo.map(part => path.join(outDir, part.name)), snapshotPath]);

  await publishManifest(target, {
    format: 1,
    version,
    updatedAt: new Date().toISOString(),
    client: {
      version,
      tag,
      files: local.files.length,
      installedSize: local.total,
      snapshot: `../${tag}/${SNAPSHOT}`,
      parts: partInfo
    },
    launcher: manifest ? manifest.launcher : null,
    files: manifest && !args.reset ? manifest.files || [] : []
  });

  fs.rmSync(outDir, { recursive: true, force: true });
  console.log(`\nCliente ${version} publicado.`);

  // Só depois do manifesto novo: o launcher nunca aponta para um release apagado
  if (args.reset) {
    const old = target.releaseTags().filter(name => name.startsWith('patch-') || (name.startsWith('client-') && name !== tag));
    for (const name of old) {
      console.log(`Apagando ${name}...`);
      target.deleteRelease(name);
    }
    console.log(`${old.length} release(s) antigo(s) apagado(s).`);
  }
}

async function cmdPatch(target, args) {
  const manifest = await loadManifest(target);
  if (!manifest || !manifest.client) fail('Nenhum cliente publicado. Rode "npm run release:client" primeiro.');

  const local = await readClient(args);
  let state;
  if (args.from) {
    // --from <pasta>: compara com uma instalação antiga, não com o manifesto.
    // Usado depois de um --reset: quem tinha a base antiga recebe a diferença em patch.
    console.log('Comparando com a instalação em --from:');
    const old = await readClient({ client: args.from });
    state = new Map(old.files.map(file => [file.path.toLowerCase(), file]));
    // Arquivos já no manifesto com o mesmo conteúdo não entram de novo
    for (const file of manifest.files || []) {
      const key = file.path.toLowerCase();
      const mine = local.files.find(f => f.path.toLowerCase() === key);
      if (mine && mine.size === file.size && mine.hash === file.hash) state.set(key, file);
    }
  } else {
    const snapshot = await loadSnapshot(target, manifest);
    state = publishedState(snapshot, manifest);
  }
  const diff = diffClient(local, state);

  printList('Alterados', diff.changed);
  printList('Novos', diff.added);
  printList('Apagados (o patch não apaga arquivos no jogador; ignorados)', diff.removed);

  const files = [...diff.changed, ...diff.added];
  if (!files.length) {
    console.log('Nenhuma alteração para publicar.');
    return;
  }

  for (const file of files) {
    if (file.size > ASSET_LIMIT) fail(`Arquivo maior que o limite do GitHub (2 GB): ${file.path}`);
  }

  // Um asset por conteúdo; acima de MAX_ASSETS, mais de um release
  const version = newVersion();
  const assets = new Map();
  for (const file of files) {
    const name = assetName(file.hash, file.path);
    if (!assets.has(name)) assets.set(name, file);
  }
  const tagOf = new Map();
  let names = [...assets.keys()];
  if (!args['dry-run']) {
    const existing = target.patchAssets();
    names = names.filter(name => {
      const found = existing.get(name);
      if (!found || found.size !== assets.get(name).size) return true;
      tagOf.set(name, found.tag);
      return false;
    });
    if (tagOf.size) console.log(`Já no GitHub (patch que não terminou): ${tagOf.size} arquivo(s); faltam ${names.length}`);
  }
  const releases = [];
  for (let i = 0; i < names.length; i += MAX_ASSETS) {
    const tag = `patch-${version}${i ? `-${i / MAX_ASSETS + 1}` : ''}`;
    releases.push({ tag, names: names.slice(i, i + MAX_ASSETS) });
  }
  for (const release of releases) {
    for (const name of release.names) tagOf.set(name, release.tag);
  }

  const size = files.reduce((sum, file) => sum + file.size, 0);
  console.log(`\nPatch ${version}: ${files.length} arquivo(s), ${formatSize(size)}`);
  if (args['dry-run']) {
    console.log('--dry-run: nada foi enviado.');
    return;
  }
  if (!await confirm(`Publicar o patch em ${target.label}?`, args)) {
    console.log('Cancelado.');
    return;
  }
  target.check();

  for (const release of releases) {
    const outDir = path.join(OUT_DIR, release.tag);
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    const staged = release.names.map(name => {
      const dest = path.join(outDir, name);
      fs.copyFileSync(path.join(local.clientDir, assets.get(name).path), dest);
      return dest;
    });

    const listed = files.filter(file => tagOf.get(assetName(file.hash, file.path)) === release.tag);
    const notes = ['Arquivos deste patch:', '', ...listed.slice(0, 300).map(file => `- \`${file.path}\``)];
    if (listed.length > 300) notes.push(`- ... e mais ${listed.length - 300}`);
    target.createRelease(release.tag, { title: `Patch ${version}`, notes: notes.join('\n'), latest: false });
    target.upload(release.tag, staged);
    fs.rmSync(outDir, { recursive: true, force: true });
  }

  // Manifesto: entradas antigas + as deste patch (o mesmo caminho é substituído)
  const entries = new Map((manifest.files || []).map(file => [file.path.toLowerCase(), file]));
  for (const file of files) {
    const name = assetName(file.hash, file.path);
    const entry = { path: file.path, size: file.size, hash: file.hash, url: `../${tagOf.get(name)}/${name}` };
    if (file.seed) entry.keep = true;
    entries.set(file.path.toLowerCase(), entry);
  }

  await publishManifest(target, {
    ...manifest,
    version,
    updatedAt: new Date().toISOString(),
    files: [...entries.values()].sort((a, b) => a.path.localeCompare(b.path, 'en'))
  });
  console.log(`\nPatch ${version} publicado (${files.length} arquivos).`);
}

async function cmdLauncher(target, args) {
  const version = PKG.version;
  const setupName = `AsgardMU-Setup-${version}.exe`;
  const setupPath = path.join(ROOT, 'dist', setupName);
  if (!fs.existsSync(setupPath)) fail(`Não achei dist/${setupName}. Rode "npm run dist" antes.`);

  const size = fs.statSync(setupPath).size;
  const hash = await md5File(setupPath);
  const manifest = await loadManifest(target);
  const published = manifest && manifest.launcher;
  if (published && !isNewer(version, published.version)) {
    if (published.version === version && published.hash === hash) {
      console.log(`Launcher ${version} já publicado.`);
      return;
    }
    fail(`O launcher publicado é ${published.version}. Aumente "version" no package.json, ` +
      'rode "npm run dist" e publique de novo (o launcher só se atualiza para versão maior).');
  }

  const tag = `launcher-v${version}`;
  console.log(`Launcher ${version}: ${setupName} (${formatSize(size)})`);
  if (args['dry-run']) {
    console.log('--dry-run: nada foi enviado.');
    return;
  }
  if (!await confirm(`Publicar o launcher em ${target.label}?`, args)) {
    console.log('Cancelado.');
    return;
  }
  target.check();

  target.createRelease(tag, { title: `Launcher ${version}`, notes: `Instalador do launcher AsgardMU ${version}.`, latest: false });
  target.upload(tag, [setupPath]);

  // Cópia com nome fixo no release "current" (link do site)
  const stableDir = path.join(OUT_DIR, CURRENT_TAG);
  fs.mkdirSync(stableDir, { recursive: true });
  const stablePath = path.join(stableDir, SETUP_STABLE);
  fs.copyFileSync(setupPath, stablePath);
  ensureCurrentRelease(target);
  target.upload(CURRENT_TAG, [stablePath], { clobber: true });

  await publishManifest(target, {
    format: 1,
    client: null,
    files: [],
    ...manifest,
    version: newVersion(),
    updatedAt: new Date().toISOString(),
    launcher: { version, url: `../${tag}/${setupName}`, size, hash }
  });

  console.log(`\nLauncher ${version} publicado.`);
  console.log(`Link fixo para o site: ${URL_CONFIG.GITHUB.DOWNLOAD_URL}${CURRENT_TAG}/${SETUP_STABLE}`);
  console.log(`Google Drive: envie ${setupPath}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  const commands = { status: cmdStatus, client: cmdClient, patch: cmdPatch, launcher: cmdLauncher };
  if (!commands[command]) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*\n/, '').replace(/^ \* ?/gm, ''));
    process.exit(command ? 1 : 0);
  }
  const target = args.local ? new LocalTarget() : new GitHubTarget();
  await commands[command](target, args);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`\nErro: ${error.userError ? error.message : error.stack}`);
    process.exit(1);
  });
}

module.exports = { classify };
