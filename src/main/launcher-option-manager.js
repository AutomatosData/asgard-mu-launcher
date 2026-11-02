const fs = require('fs-extra');
const path = require('path');
const installDirs = require('./install-dirs');

// Idioma do launcher -> idioma do cliente. index é o ID em
// Data/Custom/LangManager.xml (LauncherOption.if Language) e code é a pasta
// do Lang.mpr / Data/Local (registro LangSelection).
const CLIENT_LANGUAGES = {
  Eng: { index: 0, code: 'Eng' },
  Spa: { index: 1, code: 'Spn' },
  Por: { index: 2, code: 'Por' }
};

class LauncherOptionManager {
  // store: electron-store onde fica o idioma escolhido (chave gameLanguage)
  constructor(store) {
    this.fileName = 'LauncherOption.if';
    this.store = store;
  }

  getFilePath() {
    return path.join(installDirs.gameDir(), this.fileName);
  }

  async readLauncherOptions() {
    try {
      const filePath = this.getFilePath();
      
      if (!await fs.pathExists(filePath)) {
        console.log('LauncherOption.if not found, using default settings');
        return this.getDefaultOptions();
      }

      const content = await fs.readFile(filePath, 'utf8');
      const options = {};
      
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine && trimmedLine.includes(':')) {
          const [key, value] = trimmedLine.split(':');
          options[key.trim()] = value.trim();
        }
      }

      console.log('LauncherOption.if loaded:', options);
      return options;
    } catch (error) {
      console.error('Failed to read LauncherOption.if:', error);
      return this.getDefaultOptions();
    }
  }

  async writeLauncherOptions(options) {
    try {
      const filePath = this.getFilePath();
      
      let content = '';
      
      // Build the file content with the specified format
      content += `DevModeIndex:${options.DevModeIndex !== undefined ? options.DevModeIndex : 11}\n`;
      content += `WindowMode:${options.WindowMode !== undefined ? options.WindowMode : 1}\n`;
      content += `ID:${options.ID !== undefined ? options.ID : ''}\n`;
      content += `Language:${options.Language !== undefined ? options.Language : 0}\n`;

      await fs.writeFile(filePath, content, 'utf8');
      // Índice que o launcher gravou: outro valor no arquivo veio da tecla O do jogo
      if (this.store && options.Language !== undefined) {
        this.store.set('clientLanguageIndex', String(options.Language));
      }
      console.log('LauncherOption.if saved successfully');
      return true;
    } catch (error) {
      console.error('Failed to write LauncherOption.if:', error);
      return false;
    }
  }

  getDefaultOptions() {
    return {
      DevModeIndex: 11,
      WindowMode: 1,
      ID: '',
      Language: 0
    };
  }

  // Convert from game settings format to LauncherOption.if format
  convertFromGameSettings(gameSettings) {
    if (gameSettings.langSelection !== undefined && this.store) {
      this.store.set('gameLanguage', gameSettings.langSelection);
    }

    return {
      // Posição na lista de modos do monitor filtrada como o jogo (src/main/display-modes.js)
      DevModeIndex: Number.isInteger(gameSettings.resolution) ? gameSettings.resolution : 11,
      WindowMode: gameSettings.windowMode !== undefined ? gameSettings.windowMode : 1,
      ID: gameSettings.ID || '',
      Language: LauncherOptionManager.clientLanguage(gameSettings.langSelection).index
    };
  }

  // Convert from LauncherOption.if format to game settings format
  convertToGameSettings(launcherOptions) {
    // Ordem das versões antigas do launcher, que gravavam o idioma só no
    // arquivo; depois da primeira execução o idioma fica no store
    const languageMap = {
      0: 'Eng',
      1: 'Por',
      2: 'Spa'
    };

    // A janela da tecla O do jogo (AsgardCustom.dll) também troca o idioma e grava o
    // Language do arquivo; se ele não é mais o que o launcher gravou, vale o do jogo
    const written = this.store && this.store.get('clientLanguageIndex');
    if (written !== undefined && launcherOptions.Language !== undefined
        && String(launcherOptions.Language) !== written) {
      const fromGame = LauncherOptionManager.languageForClientIndex(launcherOptions.Language);
      if (fromGame) {
        this.store.set('gameLanguage', fromGame);
        this.store.set('clientLanguageIndex', String(launcherOptions.Language));
      }
    }

    return {
      resolution: launcherOptions.DevModeIndex !== undefined ? parseInt(launcherOptions.DevModeIndex) : 11,
      windowMode: launcherOptions.WindowMode !== undefined ? parseInt(launcherOptions.WindowMode) : 1,
      musicOnOFF: 1,
      soundOnOFF: 1,
      volumeLevel: 10,
      // Idioma salvo pelo launcher; o Language do arquivo segue o índice do
      // cliente (CLIENT_LANGUAGES), por isso só vale para quem ainda não tem store
      langSelection: (this.store && this.store.get('gameLanguage'))
        || (launcherOptions.Language !== undefined ? languageMap[parseInt(launcherOptions.Language)] : 'Eng'),
      ID: launcherOptions.ID || ''
    };
  }

  // Índice e código do cliente para um idioma do launcher (padrão: inglês)
  static clientLanguage(language) {
    return CLIENT_LANGUAGES[language] || CLIENT_LANGUAGES.Eng;
  }

  // Idioma do launcher para um índice do cliente (undefined se não existe)
  static languageForClientIndex(index) {
    return Object.keys(CLIENT_LANGUAGES).find(key => String(CLIENT_LANGUAGES[key].index) === String(index));
  }
}

module.exports = LauncherOptionManager;
