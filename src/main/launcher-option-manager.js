const fs = require('fs-extra');
const path = require('path');

class LauncherOptionManager {
  constructor() {
    this.fileName = 'LauncherOption.if';
  }

  getFilePath() {
    const execDir = path.dirname(process.execPath);
    return path.join(execDir, this.fileName);
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
    const resolutionMap = {
      1: 1,   // 800x600
      2: 2,   // 1024x768
      3: 3,   // 1150x900
      4: 4,   // 1280x768
      6: 6,   // 1280x1024
      5: 5,   // 1440x900
      8: 8,   // 1600x900
      7: 7,   // 1680x1050
      10: 10, // 1680x1080
      9: 9,   // 1600x1200
      11: 11, // 1920x1080
      12: 12, // 1920x1200
      13: 13, // 1920x1440
      15: 15, // 2560x1440
      0: 0    // Max monitor support
    };

    const languageMap = {
      'Eng': 0,
      'Por': 1,
      'Spa': 2
    };

    return {
      DevModeIndex: gameSettings.resolution !== undefined ? resolutionMap[gameSettings.resolution] : 11,
      WindowMode: gameSettings.windowMode !== undefined ? gameSettings.windowMode : 1,
      ID: gameSettings.ID || '',
      Language: gameSettings.langSelection !== undefined ? languageMap[gameSettings.langSelection] : 0
    };
  }

  // Convert from LauncherOption.if format to game settings format
  convertToGameSettings(launcherOptions) {
    const resolutionMap = {
      0: 0,
      1: 1,
      2: 2,
      3: 3,
      4: 4,
      5: 5,
      6: 6,
      7: 7,
      8: 8,
      9: 9,
      10: 10,
      11: 11,
      12: 12,
      13: 13,
      15: 15
    };

    const languageMap = {
      0: 'Eng',
      1: 'Por',
      2: 'Spa'
    };

    return {
      resolution: launcherOptions.DevModeIndex !== undefined ? resolutionMap[parseInt(launcherOptions.DevModeIndex)] : 8,
      windowMode: launcherOptions.WindowMode !== undefined ? parseInt(launcherOptions.WindowMode) : 1,
      musicOnOFF: 1,
      soundOnOFF: 1,
      volumeLevel: 10,
      langSelection: launcherOptions.Language !== undefined ? languageMap[parseInt(launcherOptions.Language)] : 'Eng',
      ID: launcherOptions.ID || ''
    };
  }
}

module.exports = LauncherOptionManager;
