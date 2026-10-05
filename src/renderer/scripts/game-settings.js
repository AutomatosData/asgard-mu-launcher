class GameSettings {
    constructor() {
        this.registryPath = 'HKEY_CURRENT_USER\\Software\\Webzen\\Mu\\Config';
        this.resolutionMap = {
            '800x600': 1,
            '1024x768': 2,
            '1150x900': 3,
            '1280x768': 4,
            '1280x1024': 6,
            '1440x900': 5,
            '1600x900': 8,
            '1680x1050': 7,
            '1680x1080': 10,
            '1600x1200': 9,
            '1920x1080': 11,
            '1920x1200': 12,
            '1920x1440': 13,
            '2560x1440': 15,
            'MAX': 0
        };
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.loadCurrentSettings();
    }

    setupEventListeners() {
        // Tab switching
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.switchTab(btn.dataset.tab);
            });
        });

        // Save settings
        document.getElementById('saveSettings').addEventListener('click', () => {
            this.saveSettings();
        });

        // Close settings button
        document.getElementById('closeSettings').addEventListener('click', () => {
            this.closeSettings();
        });

        // Cancel settings button
        document.getElementById('cancelSettings').addEventListener('click', () => {
            this.closeSettings();
        });

        // Close modal when clicking outside
        document.getElementById('settingsModal').addEventListener('click', (e) => {
            if (e.target.id === 'settingsModal') {
                this.closeSettings();
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeSettings();
            }
        });
    }

    switchTab(tabName) {
        // Remove active class from all tabs and contents
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });

        // Add active class to selected tab and content
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        document.getElementById(`${tabName}-tab`).classList.add('active');
    }

    async loadCurrentSettings() {
        try {
            // Load current registry values
            const settings = await this.getRegistrySettings();

            // Apply settings to UI
            this.applySettingsToUI(settings);
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
    }

    async reloadSettings() {
        await this.loadCurrentSettings();
    }

    async getRegistrySettings() {
        try {
            if (window.ipcRenderer) {
                const result = await window.ipcRenderer.invoke('get-launcher-options');
                if (result.success) {
                    return result.settings;
                } else {
                    console.error('Failed to get launcher options:', result.error);
                    return this.getDefaultSettings();
                }
            } else {
                console.warn('ipcRenderer not available, using default settings');
                return this.getDefaultSettings();
            }
        } catch (error) {
            console.error('Failed to read LauncherOption.if:', error);
            return this.getDefaultSettings();
        }
    }

    getDefaultSettings() {
        return {
            resolution: 8, // 1920x1080
            windowMode: 1, // Window mode
            musicOnOFF: 1, // Music enabled
            soundOnOFF: 1, // Sound enabled
            volumeLevel: 10, // Max volume
            langSelection: 'Eng', // English
            ID: '' // Account ID
        };
    }

    applySettingsToUI(settings) {
        // Apply resolution
        const resolutionValue = this.getResolutionByValue(settings.resolution);
        if (resolutionValue) {
            const resolutionSelect = document.getElementById('resolutionSelect');
            if (resolutionSelect) {
                resolutionSelect.value = resolutionValue;
            }
        }

        // Apply display mode
        const displayMode = settings.windowMode === 1 ? 'window' : 'fullscreen';
        const displayRadio = document.querySelector(`input[name="displayMode"][value="${displayMode}"]`);
        if (displayRadio) displayRadio.checked = true;

        // Apply audio settings
        const musicCheckbox = document.getElementById('musicEnabled');
        const soundCheckbox = document.getElementById('soundEnabled');

        if (musicCheckbox) musicCheckbox.checked = settings.musicOnOFF === 1;
        if (soundCheckbox) soundCheckbox.checked = settings.soundOnOFF === 1;

        // Apply account ID
        const accountIdInput = document.getElementById('accountId');
        if (accountIdInput) accountIdInput.value = settings.ID || '';

        // Apply language
        const languageRadio = document.querySelector(`input[name="language"][value="${settings.langSelection}"]`);
        if (languageRadio) languageRadio.checked = true;
    }

    getResolutionByValue(value) {
        for (const [resolution, val] of Object.entries(this.resolutionMap)) {
            if (val === value) return resolution;
        }
        return '1920x1080'; // Default
    }

    async saveSettings() {
        try {
            const settings = this.collectSettingsFromUI();
            await this.applySettingsToRegistry(settings);
            
            // Show success notification
            if (window.muDMG && window.muDMG.showNotification) {
                window.muDMG.showNotification('Game settings saved successfully', 'success');
            }

            // Close modal
            const modal = document.getElementById('settingsModal');
            if (modal) modal.style.display = 'none';

        } catch (error) {
            console.error('Failed to save settings:', error);
            if (window.muDMG && window.muDMG.showNotification) {
                window.muDMG.showNotification('Failed to save settings', 'error');
            }
        }
    }

    collectSettingsFromUI() {
        const settings = {};

        // Resolution
        const resolutionSelect = document.getElementById('resolutionSelect');
        if (resolutionSelect && resolutionSelect.value) {
            settings.resolution = this.resolutionMap[resolutionSelect.value];
        }

        // Display mode
        const selectedDisplayMode = document.querySelector('input[name="displayMode"]:checked');
        if (selectedDisplayMode) {
            settings.windowMode = selectedDisplayMode.value === 'window' ? 1 : 0;
        }

        // Audio settings
        const musicEnabled = document.getElementById('musicEnabled');
        const soundEnabled = document.getElementById('soundEnabled');

        if (musicEnabled) settings.musicOnOFF = musicEnabled.checked ? 1 : 0;
        if (soundEnabled) settings.soundOnOFF = soundEnabled.checked ? 1 : 0;
        
        // Set volume to max when audio is enabled
        if (musicEnabled && musicEnabled.checked) {
            settings.volumeLevel = 10;
        }

        // Account ID
        const accountIdInput = document.getElementById('accountId');
        if (accountIdInput) {
            settings.ID = accountIdInput.value.substring(0, 10); // Limit to 10 chars
        }

        // Language
        const selectedLanguage = document.querySelector('input[name="language"]:checked');
        if (selectedLanguage) {
            settings.langSelection = selectedLanguage.value;
        }

        return settings;
    }

    async applySettingsToRegistry(settings) {
        try {
            // Use IPC to save settings to LauncherOption.if
            if (window.ipcRenderer) {
                const result = await window.ipcRenderer.invoke('save-launcher-options', settings);
                if (!result.success) {
                    throw new Error(result.error || 'Failed to save settings');
                }
                return true;
            } else {
                console.warn('ipcRenderer not available, settings not saved');
                return false;
            }
        } catch (error) {
            console.error('Failed to apply settings to LauncherOption.if:', error);
            throw error;
        }
    }

    closeSettings() {
        const modal = document.getElementById('settingsModal');
        if (modal) {
            modal.classList.remove('show');
        }
    }
}

// Initialize game settings when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.gameSettings = new GameSettings();
});
