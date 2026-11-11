class GameSettings {
    constructor() {
        this.registryPath = 'HKEY_CURRENT_USER\\Software\\Webzen\\Mu\\Config';
        // Resoluções do monitor na ordem do jogo; o valor de cada opção é o DevModeIndex
        this.displayModes = null;
        this.workArea = null;
        // Proporção padrão da janela de configurações
        this.defaultRatio = '16:9';
        
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

        // Proporção: mostra só as resoluções da proporção marcada
        document.querySelectorAll('input[name="aspectRatio"]').forEach(radio => {
            radio.addEventListener('change', () => {
                if (radio.checked) this.fillResolutions(radio.value, null);
            });
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

    // Monta a lista de resoluções igual à do jogo (src/main/display-modes.js)
    async loadDisplayModes() {
        if (this.displayModes) return this.displayModes;
        let modes = [], workArea = null;
        try {
            if (window.ipcRenderer) {
                const result = await window.ipcRenderer.invoke('get-display-modes');
                modes = result.modes || [];
                workArea = result.workArea;
            }
        } catch (error) {
            console.error('Failed to read display modes:', error);
        }
        this.displayModes = modes;
        this.workArea = workArea;
        return modes;
    }

    isTooBig(mode) {
        // Em modo janela o jogo encolhe o que não cabe na área livre da tela
        const area = this.workArea;
        return !!area && (mode.width > area.width || mode.height > area.height);
    }

    setRatioRadio(ratio) {
        const radio = document.querySelector(`input[name="aspectRatio"][value="${ratio}"]`);
        if (radio) radio.checked = true;
    }

    // Preenche a lista só com as resoluções da proporção. O valor de cada opção
    // continua o DevModeIndex da lista completa. selectedIndex null = escolhe a
    // maior resolução que cabe na tela.
    fillResolutions(ratio, selectedIndex) {
        const select = document.getElementById('resolutionSelect');
        if (!select) return;
        const modes = (this.displayModes || []).filter(m => m.ratio === ratio);
        select.innerHTML = '';
        for (const mode of modes) {
            const option = document.createElement('option');
            option.value = String(mode.index);
            option.textContent = `${mode.width}x${mode.height}${this.isTooBig(mode) ? ' *' : ''}`;
            select.appendChild(option);
        }
        if (!modes.length) return;
        let pick = modes.find(m => m.index === selectedIndex);
        if (!pick) {
            const fitting = modes.filter(m => !this.isTooBig(m));
            pick = fitting.length ? fitting[fitting.length - 1] : modes[0];
        }
        select.value = String(pick.index);
    }

    async loadCurrentSettings() {
        try {
            await this.loadDisplayModes();
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
            resolution: 11, // DevModeIndex padrão do LauncherOption.if
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
        // Abre na proporção da resolução salva; sem resolução válida, 16:9
        const modes = this.displayModes || [];
        const saved = modes.find(m => m.index === settings.resolution);
        const ratio = saved ? saved.ratio : this.defaultRatio;
        this.setRatioRadio(ratio);
        this.fillResolutions(ratio, saved ? saved.index : null);

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

    async saveSettings() {
        try {
            const settings = this.collectSettingsFromUI();
            await this.applySettingsToRegistry(settings);

            // Aplicar o novo idioma na interface imediatamente
            if (window.i18n && settings.langSelection) {
                window.i18n.setLanguage(settings.langSelection);
            }

            // Show success notification
            if (window.muDMG && window.muDMG.showNotification) {
                window.muDMG.showNotification(window.i18n.t('notify.settingsSaved'), 'success');
            }

            // Close modal
            const modal = document.getElementById('settingsModal');
            if (modal) modal.style.display = 'none';

        } catch (error) {
            console.error('Failed to save settings:', error);
            if (window.muDMG && window.muDMG.showNotification) {
                window.muDMG.showNotification(window.i18n.t('notify.settingsFailed'), 'error');
            }
        }
    }

    collectSettingsFromUI() {
        const settings = {};

        // Resolution
        const resolutionSelect = document.getElementById('resolutionSelect');
        if (resolutionSelect && resolutionSelect.value) {
            settings.resolution = parseInt(resolutionSelect.value, 10);
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
