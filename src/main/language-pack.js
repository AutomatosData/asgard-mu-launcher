const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

/**
 * Tradução do jogo por troca de arquivos.
 *
 * O cliente S21 (MuDevs) só funciona completo em inglês: em outro idioma ele
 * cai num modo coreano incompleto. Por isso o jogo roda sempre em inglês e o
 * idioma escolhido é aplicado copiando os arquivos traduzidos por cima dos
 * arquivos em inglês antes de abrir o jogo.
 *
 * Pacote de um idioma: <jogo>/Data/Translations/<Idioma>/<caminho relativo ao jogo>
 *   ex.: Data/Translations/Por/Data/Lang.mpr -> Data/Lang.mpr
 *
 * Os originais em inglês ficam em <userData>/language-backup (fora da pasta do
 * jogo, para não entrar no manifesto de update). restore() os devolve antes de
 * verificar updates, assim o MD5 do manifesto continua batendo.
 */

const PACKS_DIR = path.join('Data', 'Translations');
const DEFAULT_LANGUAGE = 'Eng';

const backupDir = () => path.join(app.getPath('userData'), 'language-backup');
const statePath = () => path.join(backupDir(), 'state.json');

async function md5(filePath) {
  const data = await fs.readFile(filePath);
  return crypto.createHash('md5').update(data).digest('hex');
}

async function listFiles(dir, base = dir) {
  if (!await fs.pathExists(dir)) return [];
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(full, base));
    else out.push(path.relative(base, full));
  }
  return out;
}

async function readState() {
  try {
    return await fs.readJson(statePath());
  } catch {
    return { language: DEFAULT_LANGUAGE, files: {} };
  }
}

/** Devolve os arquivos em inglês que ainda estão com a tradução aplicada. */
async function restore(gameDir) {
  const state = await readState();
  for (const [rel, translatedHash] of Object.entries(state.files)) {
    const target = path.join(gameDir, rel);
    const backup = path.join(backupDir(), rel);
    try {
      // Se o update já trocou o arquivo, o MD5 não bate e o arquivo novo fica.
      if (await fs.pathExists(target) && await md5(target) === translatedHash && await fs.pathExists(backup)) {
        await fs.copy(backup, target, { overwrite: true });
      }
    } catch (error) {
      console.error(`[LanguagePack] Failed to restore ${rel}:`, error.message);
    }
  }
  await fs.outputJson(statePath(), { language: DEFAULT_LANGUAGE, files: {} });
}

/** Aplica o pacote do idioma. Sem pacote (ou inglês), deixa os arquivos originais. */
async function apply(gameDir, language) {
  await restore(gameDir);
  if (!language || language === DEFAULT_LANGUAGE) return;

  const packDir = path.join(gameDir, PACKS_DIR, language);
  const files = await listFiles(packDir);
  const state = { language, files: {} };
  for (const rel of files) {
    const target = path.join(gameDir, rel);
    try {
      if (await fs.pathExists(target)) {
        await fs.copy(target, path.join(backupDir(), rel), { overwrite: true });
      }
      await fs.copy(path.join(packDir, rel), target, { overwrite: true });
      state.files[rel] = await md5(target);
    } catch (error) {
      console.error(`[LanguagePack] Failed to apply ${rel}:`, error.message);
    }
  }
  await fs.outputJson(statePath(), state);
  console.log(`[LanguagePack] ${language}: ${Object.keys(state.files).length} files applied`);
}

module.exports = { apply, restore };
