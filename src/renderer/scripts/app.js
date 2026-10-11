const { ipcRenderer } = require('electron');

// Expor ipcRenderer globalmente para outros scripts
window.ipcRenderer = ipcRenderer;

class MuDMG {
    constructor() {
        this.config = {};
        this.isUpdating = false;
        this.connectedAccounts = 0;
        this.maxAccounts = Infinity; // Sem limite de contas
        this.accountCheckInterval = null;
        this.lastStatus = null; // { key, params } do status do rodapé, para retraduzir
        this.lastDataProgress = null; // último progresso da instalação dos dados
        this.init();
    }

    async init() {
        try {
            // Carregar idioma salvo e retraduzir textos dinâmicos quando mudar
            await window.i18n.init();
            window.i18n.onChange(() => this.refreshTranslations());

            // Mostrar loader principal
            this.showMainLoader();
            
            // Carregar configurações
            await this.loadConfig();
            
            // Inicializar interface
            this.initUI();
            
            // Configurar event listeners
            this.setupEventListeners();
            
            // Carregar webview
            this.loadWebContent();
            
            // Mostrar status inicial
            this.handleUpdateProgress({
                type: 'ready',
                key: 'status.initializing'
            });
            
            // Verificar atualizações automaticamente
            setTimeout(() => {
                this.checkForUpdates();
            }, 2000);
            
            // Iniciar monitoramento de contas conectadas
            this.startAccountMonitoring();
            
            // Listener para mudanças de estado dos dados do jogo
            ipcRenderer.on('game-data-state', (event, stateData) => {
                this.handleGameDataStateChange(stateData);
            });
        } catch (error) {
            console.error('Failed to initialize:', error);
            this.showNotification(this.t('notify.initFailed', { error: error.message }), 'error');
        }
    }

    showMainLoader() {
        const mainLoader = document.getElementById('mainLoader');
        if (mainLoader) {
            mainLoader.style.display = 'flex';
        }
    }

    hideMainLoader() {
        const mainLoader = document.getElementById('mainLoader');
        if (mainLoader) {
            mainLoader.classList.add('hidden');
            setTimeout(() => {
                mainLoader.style.display = 'none';
            }, 500);
        }
    }

    async loadConfig() {
        try {
            this.config = await ipcRenderer.invoke('get-config');
        } catch (error) {
            console.error('Failed to load configuration:', error);
            this.config = {
                gamePath: ''
            };
        }
    }

    initUI() {
        // Atualizar elementos da interface com as configurações
        this.updateUIFromConfig();
    }

    updateUIFromConfig() {
        // Atualizar campos de configuração se existirem
        const gamePathInput = document.getElementById('gamePath');
        const serverUrlInput = document.getElementById('serverUrl');

        if (gamePathInput) gamePathInput.value = this.config.gamePath || '';
        if (serverUrlInput) serverUrlInput.value = this.config.serverUrl || '';

        // Mostrar/ocultar campos de credenciais
        this.toggleCredentialsFields();
    }

    setupEventListeners() {
        // Title bar buttons
        document.getElementById('minimizeBtn').addEventListener('click', () => {
            ipcRenderer.invoke('minimize-to-tray');
        });

        document.getElementById('closeBtn').addEventListener('click', () => {
            ipcRenderer.invoke('close-app');
        });

        // Settings button
        document.getElementById('settingsBtn').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.openSettings();
        });

        // Play button
        document.getElementById('playBtn').addEventListener('click', () => {
            this.launchGame();
        });

        // Listen for update progress
        ipcRenderer.on('update-progress', (event, progress) => {
            this.handleUpdateProgress(progress);
        });

        // Listen for external URL requests
        document.addEventListener('click', (e) => {
            if (e.target.tagName === 'A' && e.target.href) {
                e.preventDefault();
                ipcRenderer.invoke('open-external-url', e.target.href);
            }
        });

        // Listen for tray launch game request
        ipcRenderer.on('launch-game-from-tray', () => {
            this.launchGame();
        });

        // Anti-cheat: aviso quando um programa não permitido é detectado
        ipcRenderer.on('anticheat-detection', (event, data) => {
            this.showNotification(this.t('notify.anticheatClosed', { name: data?.offenderName || '' }), 'error');
        });

        // Listen for data installation progress
        ipcRenderer.on('data-installation-progress', (event, progress) => {
            this.handleDataInstallationProgress(progress);
        });
    }

    loadWebContent() {
        const webview = document.getElementById('newWebview');
        const loadingSpinner = document.getElementById('webLoading');
        const errorState = document.getElementById('webError');
        
        if (!webview) {
            console.error('Webview element not found!');
            return;
        }

        // Configurar webview
        webview.addEventListener('dom-ready', () => {
            loadingSpinner.style.display = 'none';
            errorState.style.display = 'none';
            webview.style.display = 'block';
            
            // Esconder loader principal após um pequeno delay
            setTimeout(() => {
                this.hideMainLoader();
            }, 1000);
        });

        webview.addEventListener('did-fail-load', (event) => {
            // Ignorar falhas de iframes e navegacoes canceladas (ERR_ABORTED)
            if (!event.isMainFrame || event.errorCode === -3) return;
            console.error('Webview failed to load:', event);
            loadingSpinner.style.display = 'none';
            errorState.style.display = 'flex';
            
            // Esconder loader principal mesmo se falhar
            setTimeout(() => {
                this.hideMainLoader();
            }, 1000);
        });

        // Mostrar spinner apenas em navegacoes da pagina principal
        // (did-start-loading tambem dispara para iframes e nunca era escondido)
        webview.addEventListener('did-start-navigation', (event) => {
            if (!event.isMainFrame || event.isInPlace) return;
            loadingSpinner.style.display = 'flex';
            errorState.style.display = 'none';
        });

        webview.addEventListener('did-stop-loading', () => {
            loadingSpinner.style.display = 'none';
        });

        // Carregar URL do launcher usando a configuração centralizada
        const launcherUrl = URL_CONFIG.LAUNCHER_URL;
        
        // Garantir que a webview esteja visível
        webview.style.display = 'block';
        
        // Carregar a URL
        webview.src = launcherUrl;
    }

    async checkForUpdates() {
        try {
            // Primeiro verificar se os dados do jogo estão prontos
            const gameDataState = await ipcRenderer.invoke('get-game-data-state');
            
            if (!gameDataState.success) {
                console.error('Failed to get game data state:', gameDataState.error);
                return;
            }
            
            const state = gameDataState.state;
            
            // Se está instalando dados, aguardar
            if (state.isInstalling) {
                console.log('Game data is being installed, waiting...');
                this.handleUpdateProgress({
                    type: 'waiting',
                    key: 'status.waitingClient'
                });
                
                // Tentar novamente em 5 segundos
                setTimeout(() => {
                    this.checkForUpdates();
                }, 5000);
                return;
            }
            
            // Se dados não estão instalados, não pode fazer update
            if (!state.isInstalled) {
                console.log('Game data not installed, cannot check for updates');
                this.handleUpdateProgress({
                    type: 'waiting',
                    key: 'status.waitingData'
                });
                
                // Tentar novamente em 5 segundos
                setTimeout(() => {
                    this.checkForUpdates();
                }, 5000);
                return;
            }
            
            // Dados instalados, pode verificar updates
            console.log('Game data ready, checking for updates...');
            this.handleUpdateProgress({
                type: 'check'
            });
            
            // Obter o diretório correto do jogo
            const gameDirResult = await ipcRenderer.invoke('get-game-directory');
            const gamePath = gameDirResult.success ? gameDirResult.gamePath : (this.config.gamePath || process.cwd());
            
            // Usar sistema de update web
            const result = await ipcRenderer.invoke('check-updates', {
                gamePath: gamePath,
                serverUrl: URL_CONFIG.UPDATE_URL
            });

            if (result.success) {
                if (result.filesNeedingUpdate > 0) {
                    this.showNotification(this.t('notify.filesNeedUpdate', { count: result.filesNeedingUpdate }), 'warning');
                    this.handleUpdateProgress({
                        type: 'ready',
                        key: 'status.filesNeedUpdate',
                        params: { count: result.filesNeedingUpdate }
                    });
                    this.startUpdate();
                } else {
                    this.handleUpdateProgress({
                        type: 'ready',
                        key: 'status.upToDate'
                    });
                    this.enablePlayButton();
                }
            } else {
                this.showNotification(this.t('notify.checkFailed'), 'error');
                this.handleUpdateProgress({
                    type: 'ready',
                    key: 'status.checkFailed'
                });
            }
        } catch (error) {
            console.error('Update check failed:', error);
            this.showNotification(this.t('notify.checkFailed'), 'error');
            this.handleUpdateProgress({
                type: 'ready',
                key: 'status.checkFailed'
            });
        }
    }

    // Monitoramento de contas conectadas
    startAccountMonitoring() {
        // Verificar contas imediatamente
        this.checkConnectedAccounts();
        
        // Verificar a cada 3 segundos
        this.accountCheckInterval = setInterval(() => {
            this.checkConnectedAccounts();
        }, 3000);
        
        console.log('Account monitoring started');
    }

    async checkConnectedAccounts() {
        try {
            const result = await ipcRenderer.invoke('get-connected-accounts');
            this.connectedAccounts = result.count || 0;
            this.updateAccountCounter();
            this.updatePlayButtonState();
        } catch (error) {
            console.error('Error checking connected accounts:', error);
        }
    }

    updateAccountCounter() {
        const counterElement = document.getElementById('connectedAccounts');
        const counterContainer = document.getElementById('accountCounter');
        
        if (counterElement) {
            counterElement.textContent = this.connectedAccounts;
        }
        
        if (counterContainer) {
            // Sem limite - remover classe de limite atingido
            counterContainer.classList.remove('limit-reached');
        }
    }

    updatePlayButtonState() {
        const playBtn = document.getElementById('playBtn');
        if (playBtn) {
            // Sem limite de contas - botão sempre habilitado
            playBtn.disabled = false;
            playBtn.title = this.t('play');
        }
    }

    stopAccountMonitoring() {
        if (this.accountCheckInterval) {
            clearInterval(this.accountCheckInterval);
            this.accountCheckInterval = null;
            console.log('Account monitoring stopped');
        }
    }

        async startUpdate() {
        if (this.isUpdating) return;

        this.isUpdating = true;
        this.disablePlayButton();
        
        // Mostrar status inicial do update
        this.handleUpdateProgress({
            type: 'ready',
            key: 'status.startingUpdate'
        });

        try {
            // Obter o diretório correto do jogo
            const gameDirResult = await ipcRenderer.invoke('get-game-directory');
            const gamePath = gameDirResult.success ? gameDirResult.gamePath : (this.config.gamePath || process.cwd());
            
            // Usar sistema de update web
            const result = await ipcRenderer.invoke('perform-update', {
                gamePath: gamePath,
                serverUrl: URL_CONFIG.UPDATE_URL
            });

            if (result.success) {
                this.showNotification(this.t('notify.updateDone'), 'success');
                this.handleUpdateProgress({
                    type: 'ready',
                    key: 'status.updateDone'
                });
                this.enablePlayButton();
            } else {
                this.showNotification(this.t('notify.updateFailedWith', { error: result.error }), 'error');
                this.handleUpdateProgress({
                    type: 'ready',
                    key: 'status.updateFailedWith',
                    params: { error: result.error }
                });
            }
        } catch (error) {
            console.error('Update failed:', error);
            this.showNotification(this.t('notify.updateFailed'), 'error');
            this.handleUpdateProgress({
                type: 'ready',
                key: 'status.updateFailed'
            });
        } finally {
            this.isUpdating = false;
        }
    }

    handleGameDataStateChange(stateData) {
        console.log('Handling game data state change:', stateData);
        
        switch (stateData.type) {
            case 'installing':
                this.handleUpdateProgress({
                    type: 'waiting',
                    key: 'status.waitingClient'
                });
                break;
                
            case 'ready-for-update':
                this.handleUpdateProgress({
                    type: 'ready',
                    key: 'status.dataReady'
                });
                // Verificar updates quando dados estiverem prontos
                setTimeout(() => {
                    this.checkForUpdates();
                }, 1000);
                break;
                
            case 'error':
                this.handleUpdateProgress({
                    type: 'error',
                    key: 'status.dataError'
                });
                break;
        }
    }

    handleUpdateProgress(progress) {
        const updateProgressFooter = document.getElementById('updateProgressFooter');
        const downloadProgressFooter = document.getElementById('downloadProgressFooter');
        const downloadTextFooter = document.getElementById('downloadTextFooter');
        const overallProgressFooter = document.getElementById('overallProgressFooter');
        const overallTextFooter = document.getElementById('overallTextFooter');
        const currentFileInfo = document.getElementById('currentFileInfo');
        if (!updateProgressFooter) return;

        switch (progress.type) {
            case 'manifest':
                this.setStatus('status.manifest');
                // Reset progress bars
                downloadProgressFooter.style.width = '0%';
                downloadTextFooter.textContent = '0%';
                overallProgressFooter.style.width = '0%';
                overallTextFooter.textContent = '0%';
                break;
            case 'check':
                this.setStatus('status.checking');
                // Reset progress bars
                downloadProgressFooter.style.width = '0%';
                downloadTextFooter.textContent = '0%';
                overallProgressFooter.style.width = '0%';
                overallTextFooter.textContent = '0%';
                break;
            case 'download':
                this.setStatus('status.downloadingFiles', { current: progress.current, total: progress.total });
                // Verificar se total é válido para evitar NaN
                if (progress.total && progress.total > 0) {
                    const overallPercent = Math.round((progress.current / progress.total) * 100);
                    overallProgressFooter.style.width = `${overallPercent}%`;
                    overallTextFooter.textContent = `${overallPercent}%`;
                } else {
                    // Se não há arquivos para baixar, mostrar 0%
                    overallProgressFooter.style.width = '0%';
                    overallTextFooter.textContent = '0%';
                }
                break;
            case 'download-progress':
                downloadProgressFooter.style.width = `${progress.progress}%`;
                downloadTextFooter.textContent = `${progress.progress}%`;
                this.setStatus('status.downloadingFile', { file: progress.file || this.t('status.file') });
                break;
            case 'verify':
                this.setStatus('status.verifying');
                // Não alterar a barra overall durante verificação
                break;
            case 'ready':
                this.setStatus(progress.key || 'status.ready', progress.params);
                downloadProgressFooter.style.width = '100%';
                downloadTextFooter.textContent = '100%';
                overallProgressFooter.style.width = '100%';
                overallTextFooter.textContent = '100%';
                break;
            case 'waiting':
            case 'error':
                this.setStatus(progress.key, progress.params);
                break;
        }
    }

    t(key, params) {
        return window.i18n.t(key, params);
    }

    // Atualiza o texto de status do rodapé guardando a chave para retraduzir
    setStatus(key, params) {
        this.lastStatus = { key, params };
        const statusText = document.querySelector('#currentFileInfo .status-text');
        if (statusText) {
            statusText.textContent = this.t(key, params);
        }
    }

    // Chamado quando o usuário salva um novo idioma
    refreshTranslations() {
        if (this.lastStatus) {
            this.setStatus(this.lastStatus.key, this.lastStatus.params);
        }
        if (this.lastDataProgress) {
            const currentStatus = document.getElementById('currentStatusText');
            if (currentStatus) currentStatus.textContent = this.getDataProgressText(this.lastDataProgress);
        }
        this.updatePlayButtonState();
    }

    // Texto traduzido para os eventos de progresso da instalação dos dados (data-manager)
    getDataProgressText(progress) {
        switch (progress.type) {
            case 'download-start':
                return this.t('data.downloadStart');
            case 'download-progress':
                return this.t('data.downloading', { progress: progress.progress || 0 });
            case 'download-complete':
                return this.t('data.downloadDone');
            case 'extract-start':
                return this.t('data.extractStart');
            case 'extract-progress':
                return this.t('data.extracting', { progress: progress.progress || 0 });
            case 'extract-complete':
                return this.t('data.extractDone');
            case 'installation-complete':
            case 'success':
                return this.t('data.installed');
            case 'data-exists':
                return this.t('data.exists');
            case 'installation-error':
            case 'error':
                return this.t('data.error', { error: progress.error || progress.message || '' });
            default:
                return progress.message || this.t('data.processing');
        }
    }

    async launchGame() {
        console.log('Play button clicked - Starting game launch...');
        try {
            console.log('Invoking launch-game IPC...');
            const result = await ipcRenderer.invoke('launch-game');
            console.log('Launch result received:', result);
            
            if (result.success) {
                console.log('Game launch successful');
                this.showNotification(this.t('notify.launching'), 'success');
                // Esconder loader principal ao lançar jogo
                this.hideMainLoader();
            } else {
                console.error('Game launch failed:', result.error);
                this.showNotification(this.t('notify.launchFailedWith', { error: result.error }), 'error');
            }
        } catch (error) {
            console.error('Exception during game launch:', error);
            this.showNotification(this.t('notify.launchFailed'), 'error');
        }
    }

    async openSettings() {
        const settingsBtn = document.getElementById('settingsBtn');
        const modal = document.getElementById('settingsModal');

        if (modal) {
            this.resetSettingsModal();

            await this.loadConfig();

            if (window.settingsManager && window.settingsManager.loadSettingsToForm) {
                await window.settingsManager.loadSettingsToForm(this.config);
            } else {
            }

            // Reload game settings from LauncherOption.if
            if (window.gameSettings && window.gameSettings.reloadSettings) {
                await window.gameSettings.reloadSettings();
            }

            setTimeout(() => {
                modal.classList.add('show');

                setTimeout(() => {
                    const isVisible = modal.classList.contains('show');
                    if (!isVisible) {
                        modal.classList.add('show');
                    }
                }, 100);
            }, 50);
        } else {
        }
    }

    resetSettingsModal() {
        const modal = document.getElementById('settingsModal');
        if (modal) {
            modal.className = 'modal';
            modal.style.display = '';
            modal.style.visibility = '';
            modal.style.opacity = '';
        }
    }

    closeSettings() {
        if (window.settingsManager && window.settingsManager.closeSettings) {
            window.settingsManager.closeSettings();
        } else {
            const modal = document.getElementById('settingsModal');
            if (modal) {
                modal.classList.remove('show');
            }
        }
    }

    enablePlayButton() {
        const playBtn = document.getElementById('playBtn');
        if (playBtn) {
            playBtn.disabled = false;
        }
    }

    disablePlayButton() {
        const playBtn = document.getElementById('playBtn');
        if (playBtn) {
            playBtn.disabled = true;
        }
    }

    toggleCredentialsFields() {
    }

    showNotification(message, type = 'info') {
        const container = document.getElementById('notificationContainer');
        if (!container) return;

        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;

        container.appendChild(notification);

        setTimeout(() => {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 5000);
    }

    handleDataInstallationProgress(progress) {
        console.log('[App] Data installation progress:', progress);
        
        switch (progress.type) {
            case 'start':
            case 'download-start':
                this.showDataInstallationModal();
                this.updateDataInstallationModal(progress);
                break;
                
            case 'download-progress':
                if (!document.getElementById('dataInstallationModal').classList.contains('show')) {
                    this.showDataInstallationModal();
                }
                this.updateDataInstallationModal(progress);
                break;
                
            case 'download-complete':
            case 'extract-start':
                this.updateDataInstallationModal(progress);
                break;
                
            case 'extract-progress':
                this.updateDataInstallationModal(progress);
                break;
                
            case 'extract-complete':
            case 'installation-complete':
            case 'success':
                this.updateDataInstallationModal(progress);
                setTimeout(() => {
                    this.hideDataInstallationModal();
                    this.showNotification(this.getDataProgressText(progress), 'success');
                }, 2000);
                this.enablePlayButton();
                break;
                
            case 'data-exists':
                this.handleUpdateProgress({
                    type: 'ready',
                    key: 'data.exists'
                });
                this.enablePlayButton();
                break;
                
            case 'installation-error':
            case 'error':
                this.updateDataInstallationModal(progress);
                setTimeout(() => {
                    this.hideDataInstallationModal();
                    this.showNotification(this.getDataProgressText(progress), 'error');
                }, 3000);
                break;
                
            default:
                console.log('[App] Unknown data installation progress type:', progress.type);
                break;
        }
    }

    showDataInstallationModal() {
        const modal = document.getElementById('dataInstallationModal');
        if (modal) {
            modal.classList.add('show');
            console.log('[App] Data installation modal shown');
        }
    }

    hideDataInstallationModal() {
        const modal = document.getElementById('dataInstallationModal');
        if (modal) {
            modal.classList.remove('show');
            console.log('[App] Data installation modal hidden');
        }
    }

    updateDataInstallationModal(progress) {
        const modal = document.getElementById('dataInstallationModal');
        if (!modal) return;

        const downloadSection = document.getElementById('downloadProgressSection');
        const currentStatus = document.getElementById('currentStatusText');

        this.lastDataProgress = progress;
        if (currentStatus) {
            currentStatus.textContent = this.getDataProgressText(progress);
        }

        if (downloadSection) {
            const downloadPercentage = document.getElementById('downloadProgressPercentage');
            const downloadFill = document.getElementById('downloadProgressFill');
            const downloadSpeed = document.getElementById('downloadSpeed');

            if (progress.type === 'download-progress' || progress.type === 'download-start') {
                if (downloadPercentage) {
                    downloadPercentage.textContent = `${progress.progress || 0}%`;
                }
                if (downloadFill) {
                    downloadFill.style.width = `${progress.progress || 0}%`;
                }
                if (downloadSpeed && progress.speed !== undefined) {
                    const speedMBps = progress.speed.toFixed(1);
                    downloadSpeed.textContent = `${speedMBps} MB/s`;
                }
            }
        }

        this.updateOverallProgress(progress);
    }

    updateOverallProgress(progress) {
        const overallPercentage = document.getElementById('overallProgressPercentage');
        const overallFill = document.getElementById('overallProgressFill');

        let overallProgress = 0;

        switch (progress.type) {
            case 'download-start':
                overallProgress = 10;
                break;
            case 'download-progress':
                overallProgress = 10 + (progress.progress * 0.4); // 10-50%
                break;
            case 'download-complete':
            case 'extract-start':
                overallProgress = 50;
                break;
            case 'extract-progress':
                overallProgress = 50 + (progress.progress * 0.4); // 50-90%
                break;
            case 'extract-complete':
            case 'installation-complete':
            case 'success':
                overallProgress = 100;
                break;
            case 'error':
            case 'installation-error':
                overallProgress = 0;
                break;
        }

        if (overallPercentage) {
            overallPercentage.textContent = `${Math.round(overallProgress)}%`;
        }
        if (overallFill) {
            overallFill.style.width = `${overallProgress}%`;
        }
    }

    cleanup() {
        this.stopAccountMonitoring();
        console.log('AsgardMU cleanup completed');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.muDMG = new MuDMG();
});

window.addEventListener('beforeunload', () => {
    if (window.muDMG) {
        window.muDMG.cleanup();
    }
});

module.exports = MuDMG;
