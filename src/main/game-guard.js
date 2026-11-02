// O jogo só abre pelo launcher: o launcher passa "-a<código>" junto com o "-k<GetTickCount>"
// e a AsgardCustom.dll (Asgard-Mu-ServerS21/AsgardCustom, LAUNCH) confere o código e a hora.
// Sem eles o main.exe mostra uma mensagem e fecha. O main.exe também fica oculto na pasta.
const { execFile } = require('child_process');

// Mesmo valor de LAUNCH_SECRET na asgard_custom.c
const LAUNCH_SECRET = 'eb4b9fe523215110a4a6aea85960cdbc';

// FNV-1a 64 bits de "<segredo>:<tick>", 16 dígitos hex (igual à launch_token da DLL)
function launchToken(tickCount) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of Buffer.from(`${LAUNCH_SECRET}:${tickCount}`, 'latin1')) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

// Oculto + sistema: some do Explorer na configuração padrão. O Windows não deixa sobrescrever
// um arquivo oculto (createWriteStream dá EPERM), então a atualização mostra o arquivo antes.
function setHidden(file, hidden) {
  const flag = hidden ? '+' : '-';
  return new Promise(resolve => {
    execFile('attrib', [`${flag}h`, `${flag}s`, file], { windowsHide: true }, error => resolve(!error));
  });
}

module.exports = { launchToken, setHidden };
