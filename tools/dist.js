#!/usr/bin/env node
/**
 * Gera o instalador do launcher: "npm run dist".
 *
 * Roda "tauri build" (Rust + NSIS) e copia o instalador para
 * dist/AsgardMU-Setup-<versão>.exe, o nome que tools/release.js publica.
 * A versão vem do package.json (src-tauri/tauri.conf.json aponta para ele).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const { version } = require(path.join(ROOT, 'package.json'));

const tauri = path.join(ROOT, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
const build = spawnSync(process.execPath, [tauri, 'build'], { cwd: ROOT, stdio: 'inherit' });
if (build.status !== 0) {
  console.error('\nERRO: o "tauri build" falhou.');
  process.exit(build.status || 1);
}

const bundleDir = path.join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
const setup = path.join(bundleDir, `AsgardMU_${version}_x64-setup.exe`);
if (!fs.existsSync(setup)) {
  console.error(`\nERRO: não achei ${setup}`);
  process.exit(1);
}

const outDir = path.join(ROOT, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `AsgardMU-Setup-${version}.exe`);
fs.copyFileSync(setup, out);

// O Windows Defender já marcou um instalador como "Trojan:Win32/Bearfoos.A!ml" (launcher 2.0.0,
// 2026-11-11): falso positivo de heurística, que muda de um build para outro. O instalador
// só sai daqui depois de uma verificação limpa. Com detecção, rode "npm run dist" de novo.
const defender = path.join(process.env.ProgramFiles || 'C:/Program Files', 'Windows Defender', 'MpCmdRun.exe');
if (fs.existsSync(defender)) {
  const scan = spawnSync(defender, ['-Scan', '-ScanType', '3', '-File', out, '-DisableRemediation'], { encoding: 'utf8' });
  const text = `${scan.stdout || ''}${scan.stderr || ''}`;
  const threat = /^Threat\s*:\s*(.+)$/m.exec(text);
  if (threat || !/found no threats/i.test(text)) {
    try { fs.unlinkSync(out); } catch {}
    console.error(`\nERRO: o Windows Defender não aprovou o instalador${threat ? ` (${threat[1].trim()})` : ''}.`);
    console.error('Rode "npm run dist" de novo. Não publique um instalador com detecção.');
    process.exit(1);
  }
  console.log('Windows Defender: nenhuma ameaça no instalador.');
} else {
  console.log('AVISO: MpCmdRun.exe não encontrado; o instalador não foi verificado pelo Windows Defender.');
}
console.log(`\nInstalador: ${out} (${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB)`);
