const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class RegistryManager {
    constructor() {
        this.registryPath = 'HKEY_CURRENT_USER\\Software\\Webzen\\Mu\\Config';
    }

    async readRegistryValue(valueName) {
        try {
            const command = `reg query "${this.registryPath}" /v "${valueName}"`;
            const { stdout } = await execAsync(command);
            
            // Parse the output to extract the value
            const lines = stdout.split('\n');
            for (const line of lines) {
                if (line.includes(valueName)) {
                    const parts = line.trim().split(/\s+/);
                    if (parts.length >= 3) {
                        return parts[2];
                    }
                }
            }
            return null;
        } catch (error) {
            console.error(`Failed to read registry value ${valueName}:`, error);
            return null;
        }
    }

    async writeRegistryValue(valueName, valueType, value) {
        try {
            const command = `reg add "${this.registryPath}" /v "${valueName}" /t ${valueType} /d "${value}" /f`;
            await execAsync(command);
            return true;
        } catch (error) {
            console.error(`Failed to write registry value ${valueName}:`, error);
            return false;
        }
    }

    async readGameSettings() {
        try {
            const settings = {};
            
            // Read all game settings
            const resolution = await this.readRegistryValue('Resolution');
            const windowMode = await this.readRegistryValue('WindowMode');
            const musicOnOFF = await this.readRegistryValue('MusicOnOFF');
            const soundOnOFF = await this.readRegistryValue('SoundOnOFF');
            const volumeLevel = await this.readRegistryValue('VolumeLevel');
            const langSelection = await this.readRegistryValue('LangSelection');

            if (resolution) settings.resolution = parseInt(resolution);
            if (windowMode) settings.windowMode = parseInt(windowMode);
            if (musicOnOFF) settings.musicOnOFF = parseInt(musicOnOFF);
            if (soundOnOFF) settings.soundOnOFF = parseInt(soundOnOFF);
            if (volumeLevel) settings.volumeLevel = parseInt(volumeLevel);
            if (langSelection) settings.langSelection = langSelection;

            return settings;
        } catch (error) {
            console.error('Failed to read game settings:', error);
            return {};
        }
    }

    async writeGameSettings(settings) {
        try {
            const results = [];

            if (settings.resolution !== undefined) {
                results.push(await this.writeRegistryValue('Resolution', 'REG_DWORD', settings.resolution));
            }
            
            if (settings.windowMode !== undefined) {
                results.push(await this.writeRegistryValue('WindowMode', 'REG_DWORD', settings.windowMode));
            }
            
            if (settings.musicOnOFF !== undefined) {
                results.push(await this.writeRegistryValue('MusicOnOFF', 'REG_DWORD', settings.musicOnOFF));
            }
            
            if (settings.soundOnOFF !== undefined) {
                results.push(await this.writeRegistryValue('SoundOnOFF', 'REG_DWORD', settings.soundOnOFF));
            }
            
            if (settings.volumeLevel !== undefined) {
                results.push(await this.writeRegistryValue('VolumeLevel', 'REG_DWORD', settings.volumeLevel));
            }
            
            if (settings.langSelection !== undefined) {
                results.push(await this.writeRegistryValue('LangSelection', 'REG_SZ', settings.langSelection));
            }

            return results.every(result => result === true);
        } catch (error) {
            console.error('Failed to write game settings:', error);
            return false;
        }
    }
}

module.exports = RegistryManager;
