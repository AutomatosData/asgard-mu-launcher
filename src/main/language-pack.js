const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

/**
 * Limpeza da tradução por troca de arquivos (versões anteriores do launcher).
 *
 * Antes, o jogo rodava sempre em inglês e o launcher copiava os arquivos
 * traduzidos por cima dos arquivos em inglês, guardando os originais em
 * <userData>/language-backup. Agora o cliente troca de idioma sozinho, então
 * restore() só devolve os originais que ainda estiverem trocados.
 */

const DEFAULT_LANGUAGE = 'Eng';

const backupDir = () => path.join(app.getPath('userData'), 'language-backup');
const statePath = () => path.join(backupDir(), 'state.json');

async function md5(filePath) {
  const data = await fs.readFile(filePath);
  return crypto.createHash('md5').update(data).digest('hex');
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

module.exports = { restore };
