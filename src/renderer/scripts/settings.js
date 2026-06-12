class SettingsManager {
    constructor() {
        this.init();
    }

    init() {
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Settings modal events
        document.getElementById('closeSettings')?.addEventListener('click', () => {
            this.closeSettings();
        });

        document.getElementById('cancelSettings')?.addEventListener('click', () => {
            this.closeSettings();
        });

        document.getElementById('saveSettings')?.addEventListener('click', () => {
            this.saveSettings();
        });

        // Browse game path button
        document.getElementById('browseGamePath')?.addEventListener('click', () => {
            this.browseGamePath();
        });

        // Sistema de credenciais removido - agora usa Auto Login via xAccounts.ini

        // Close modal when clicking outside
        document.getElementById('settingsModal')?.addEventListener('click', (e) => {
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
        // Tabs switching
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
                btn.classList.add('active');
                const tabId = `${btn.getAttribute('data-tab')}-tab`;
                document.getElementById(tabId)?.classList.add('active');
            });
        });
    }

    async browseGamePath() {
        try {
            const result = await window.ipcRenderer.invoke('select-game-path');
            
            if (result.success) {
                document.getElementById('gamePath').value = result.path;
                this.showNotification('Game directory selected successfully', 'success');
            } else {
                this.showNotification(result.error, 'error');
            }
        } catch (error) {
            console.error('Failed to browse game path:', error);
            this.showNotification('Failed to select game directory', 'error');
        }
    }

    // Método toggleCredentialsFields removido pois não é mais necessário

    async saveSettings() {
        try {
            // Coletar valores dos campos
            const config = {
                displayMode: document.querySelector('input[name="displayMode"]:checked')?.value || 'window',
                resolution: document.getElementById('resolutionSelect')?.value || '1920x1080',
                musicEnabled: document.getElementById('musicEnabled')?.checked || false,
                soundEnabled: document.getElementById('soundEnabled')?.checked || false,
                language: document.querySelector('input[name="language"]:checked')?.value || 'Eng'
            };

            // Salvar configurações gerais no config.json
            const result = await ipcRenderer.invoke('save-config', config);
            
            if (result.success) {
                console.log('[Settings] Settings saved successfully to config.json');
                
                this.closeSettings();
                
                // Atualizar configuração global
                if (window.muDMG) {
                    window.muDMG.config = { ...window.muDMG.config, ...config };
                }
            } else {
                this.showNotification(`Failed to save settings: ${result.error}`, 'error');
            }
        } catch (error) {
            console.error('Failed to save settings:', error);
            this.showNotification('Failed to save settings', 'error');
        }
    }

    closeSettings() {
        console.log('[Settings] Closing settings modal...');
        const modal = document.getElementById('settingsModal');
        if (modal) {
            modal.classList.remove('show');
            console.log('[Settings] Modal closed');
            // Garantir que o modal não fique "preso"
            setTimeout(() => {
                if (modal.classList.contains('show')) {
                    modal.classList.remove('show');
                    console.log('[Settings] Modal force-closed');
                }
            }, 100);
        } else {
            console.log('[Settings] Modal not found!');
        }
    }

    showNotification(message, type = 'info') {
        // Usar o sistema de notificação do MU Online principal se disponível
        if (window.muDMG && window.muDMG.showNotification) {
            window.muDMG.showNotification(message, type);
        } else {
            // Fallback para notificação simples
            console.log(`${type.toUpperCase()}: ${message}`);
        }
    }

    // Método para carregar configurações nos campos do modal
    async loadSettingsToForm(config) {
        // Carregar campos do HTML
        const displayModeInput = document.querySelector(`input[name="displayMode"][value="${config.displayMode || 'window'}"]`);
        const resolutionSelect = document.getElementById('resolutionSelect');
        const musicEnabledCheckbox = document.getElementById('musicEnabled');
        const soundEnabledCheckbox = document.getElementById('soundEnabled');
        const languageInput = document.querySelector(`input[name="language"][value="${config.language || 'Eng'}"]`);

        if (displayModeInput) displayModeInput.checked = true;
        if (resolutionSelect) resolutionSelect.value = config.resolution || '1920x1080';
        if (musicEnabledCheckbox) musicEnabledCheckbox.checked = config.musicEnabled || false;
        if (soundEnabledCheckbox) soundEnabledCheckbox.checked = config.soundEnabled || false;
        if (languageInput) languageInput.checked = true;
    }


    // Método para resetar configurações
    async resetSettings() {
        try {
            const defaultConfig = {
                displayMode: 'window',
                resolution: '1920x1080',
                musicEnabled: true,
                soundEnabled: true,
                language: 'Eng'
            };

            const result = await ipcRenderer.invoke('save-config', defaultConfig);
            
            if (result.success) {
                this.loadSettingsToForm(defaultConfig);
                this.showNotification('Settings reset to default', 'success');
                
                // Atualizar configuração global
                if (window.muDMG) {
                    window.muDMG.config = { ...window.muDMG.config, ...defaultConfig };
                }
            } else {
                this.showNotification('Failed to reset settings', 'error');
            }
        } catch (error) {
            console.error('Failed to reset settings:', error);
            this.showNotification('Failed to reset settings', 'error');
        }
    }

    // Método para validar configurações
    validateSettings(config) {
        const errors = [];

        if (!config.gamePath) {
            errors.push('Game directory is required');
        }

        if (!config.serverUrl) {
            errors.push('Server URL is required');
        } else {
            try {
                new URL(config.serverUrl);
            } catch (error) {
                errors.push('Invalid server URL format');
            }
        }

        // Validação de credenciais removida - sistema não é mais usado

        return {
            isValid: errors.length === 0,
            errors: errors
        };
    }

    // Método para exportar configurações
    exportSettings() {
        if (!window.muDMG || !window.muDMG.config) {
            this.showNotification('No settings to export', 'warning');
            return;
        }

        try {
            const configData = JSON.stringify(window.muDMG.config, null, 2);
            const blob = new Blob([configData], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = 'mudmg-settings.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            this.showNotification('Settings exported successfully', 'success');
        } catch (error) {
            console.error('Failed to export settings:', error);
            this.showNotification('Failed to export settings', 'error');
        }
    }

    // Método para importar configurações
    async importSettings() {
        try {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                try {
                    const text = await file.text();
                    const config = JSON.parse(text);
                    
                    const validation = this.validateSettings(config);
                    if (!validation.isValid) {
                        this.showNotification(`Invalid settings file: ${validation.errors.join(', ')}`, 'error');
                        return;
                    }

                    const result = await ipcRenderer.invoke('save-config', config);
                    
                    if (result.success) {
                        this.loadSettingsToForm(config);
                        this.showNotification('Settings imported successfully', 'success');
                        
                        // Atualizar configuração global
                        if (window.muDMG) {
                            window.muDMG.config = config;
                            window.muDMG.updateUIFromConfig();
                        }
                    } else {
                        this.showNotification('Failed to import settings', 'error');
                    }
                } catch (error) {
                    console.error('Failed to import settings:', error);
                    this.showNotification('Failed to import settings file', 'error');
                }
            };
            
            input.click();
        } catch (error) {
            console.error('Failed to import settings:', error);
            this.showNotification('Failed to import settings', 'error');
        }
    }
}

// Inicializar o gerenciador de configurações quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
    window.settingsManager = new SettingsManager();
});

// Exportar para uso em outros módulos
module.exports = SettingsManager;
