// Pastas da instalação. O instalador (build/installer.nsh) põe o launcher (Electron) em
// "<jogo>\Launcher" e um AsgardMU.exe pequeno na pasta do jogo que o abre (build/stub).
// Instalações antigas e a pasta de desenvolvimento têm o launcher junto do jogo.
const path = require('path');
const { execFile } = require('child_process');

const LAUNCHER_FOLDER = 'Launcher';

// Arquivos do jogo que ficam ocultos na pasta do jogo (só no layout com "Launcher\").
// Ficam na pasta do main.exe: o main.exe lê Data\ e carrega as DLLs da própria pasta.
const HIDDEN_GAME_FILES = [
  'Main.dll', 'Main.orig', 'glu32.dll', 'AsgardCustom.dll', 'AsgardLua.dll',
  'discord_game_sdk.dll', 'awesomium.dll', 'awesomium_process.exe', 'icudt.dll',
  'msvcp140.dll', 'vcruntime140.dll', 'muplayer.exe', 'Popup.exe'
];
const HIDDEN_GAME_DIRS = ['Data', 'ErrorLog'];

function launcherDir() {
  return path.dirname(process.execPath);
}

function hasLauncherFolder() {
  return path.basename(launcherDir()).toLowerCase() === LAUNCHER_FOLDER.toLowerCase();
}

function gameDir() {
  return hasLauncherFolder() ? path.dirname(launcherDir()) : launcherDir();
}

// Oculto + sistema nos arquivos, só oculto nas pastas. O Windows não deixa sobrescrever
// um arquivo oculto (EPERM): a atualização chama setGameFilesHidden(false) antes.
function attrib(flags, target) {
  return new Promise(resolve => {
    execFile('attrib', [...flags, target], { windowsHide: true }, error => resolve(!error));
  });
}

async function setGameFilesHidden(hidden) {
  if (!hasLauncherFolder()) return;
  const sign = hidden ? '+' : '-';
  const root = gameDir();
  await Promise.all([
    ...HIDDEN_GAME_FILES.map(name => attrib([`${sign}h`, `${sign}s`], path.join(root, name))),
    ...HIDDEN_GAME_DIRS.map(name => attrib([`${sign}h`], path.join(root, name)))
  ]);
}

module.exports = { LAUNCHER_FOLDER, launcherDir, gameDir, hasLauncherFolder, setGameFilesHidden };
