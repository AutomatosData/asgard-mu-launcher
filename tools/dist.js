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
console.log(`\nInstalador: ${out} (${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB)`);
