// Canais do launcher (ui/scripts/bridge.js); settings.js usa esta mesma variável
const ipcRenderer = window.ipcRenderer;

class MuDMG {
    constructor() {
        this.config = {};
        this.isUpdating = false;
        this.playLocked = true; // Jogar travado até a verificação liberar (o HTML já começa disabled)
        this.connectedAccounts = 0;
        this.maxAccounts = Infinity; // Sem limite de contas
        this.accountCheckInterval = null;
        this.lastStatus = null; // { key, params } do status do rodapé, para retraduzir
        this.init();
    }

    async init() {
        try {
            // Carregar idioma salvo e retraduzir textos dinâmicos quando mudar
            await window.i18n.init();
            window.i18n.onChange(() => this.refreshTranslations());

            // Título com a versão do package.json: "AsgardMU - v1.0.2"
            this.showVersionInTitle();

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

    async showVersionInTitle() {
        try {
            const version = await ipcRenderer.invoke('get-app-version');
            const title = `AsgardMU - v${version}`;
            document.title = title;
            const titleText = document.querySelector('.title-bar .title');
            if (titleText) titleText.textContent = title;
        } catch (error) {
            console.error('Failed to read launcher version:', error);
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

    // O site abre em um webview do launcher, por cima da área de conteúdo
    // (site_load em src-tauri/src/main.rs). O launcher avisa o estado da página.
    loadWebContent() {
        const area = document.getElementById('webContent');
        const loadingSpinner = document.getElementById('webLoading');
        const errorState = document.getElementById('webError');
        if (!area) {
            console.error('Web content area not found!');
            return;
        }

        ipcRenderer.on('site-ready', () => {
            loadingSpinner.style.display = 'none';
            errorState.style.display = 'none';
            // Esconder loader principal após um pequeno delay
            setTimeout(() => this.hideMainLoader(), 1000);
        });

        ipcRenderer.on('site-loading', () => {
            loadingSpinner.style.display = 'flex';
            errorState.style.display = 'none';
        });

        ipcRenderer.on('site-error', () => {
            loadingSpinner.style.display = 'none';
            errorState.style.display = 'flex';
            // Esconder loader principal mesmo se falhar
            setTimeout(() => this.hideMainLoader(), 1000);
        });

        const rect = area.getBoundingClientRect();
        ipcRenderer.invoke('site-load', { x: rect.left, y: rect.top, width: rect.width, height: rect.height });
    }

    async checkForUpdates() {
        // Uma verificação por vez (init e game-data-state podem chamar juntos)
        if (this.checkingUpdates) return;
        this.checkingUpdates = true;
        this.disablePlayButton();
        try {
            // Launcher novo publicado: o main baixa o instalador, abre e fecha o launcher
            if (!this.launcherUpdateChecked) {
                this.launcherUpdateChecked = true;
                this.setStatus('status.launcherCheck');
                const launcherUpdate = await ipcRenderer.invoke('check-launcher-update');
                if (launcherUpdate && launcherUpdate.updating) {
                    this.disablePlayButton();
                    this.handleUpdateProgress({
                        type: 'waiting',
                        key: 'status.launcherUpdate',
                        params: { version: launcherUpdate.version }
                    });
                    return;
                }
            }

            // Primeiro verificar se os dados do jogo estão prontos
            const gameDataState = await ipcRenderer.invoke('get-game-data-state');
            
            if (!gameDataState.success) {
                console.error('Failed to get game data state:', gameDataState.error);
                this.enablePlayButton();
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
            
            // Sem o cliente: baixar o cliente completo e depois verificar os patches
            if (!state.isInstalled) {
                console.log('Game data not installed, downloading the client');
                this.installGameData();
                return;
            }
            
            // Dados instalados, pode verificar updates
            console.log('Game data ready, checking for updates...');
            this.handleUpdateProgress({
                type: 'check'
            });
            
            // Obter o diretório correto do jogo
            const gameDirResult = await ipcRenderer.invoke('get-game-directory');
            const gamePath = gameDirResult.success ? gameDirResult.gamePath : (this.config.gamePath || '');
            
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
                this.enablePlayButton();
            }
        } catch (error) {
            console.error('Update check failed:', error);
            this.showNotification(this.t('notify.checkFailed'), 'error');
            this.handleUpdateProgress({
                type: 'ready',
                key: 'status.checkFailed'
            });
            this.enablePlayButton();
        } finally {
            this.checkingUpdates = false;
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
            // Sem limite de contas; só desabilita durante verificação, instalação do cliente ou um patch
            playBtn.disabled = Boolean(this.playLocked || this.isInstallingData || this.isUpdating);
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
            const gamePath = gameDirResult.success ? gameDirResult.gamePath : (this.config.gamePath || '');
            
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
                this.enablePlayButton();
            }
        } catch (error) {
            console.error('Update failed:', error);
            this.showNotification(this.t('notify.updateFailed'), 'error');
            this.handleUpdateProgress({
                type: 'ready',
                key: 'status.updateFailed'
            });
            this.enablePlayButton();
        } finally {
            this.isUpdating = false;
            this.updatePlayButtonState();
        }
    }

    // Primeira instalação: baixa e extrai o cliente completo (progresso em data-installation-progress)
    async installGameData() {
        if (this.isInstallingData) return;
        this.isInstallingData = true;
        this.disablePlayButton();
        this.handleUpdateProgress({
            type: 'waiting',
            key: 'status.waitingClient'
        });

        try {
            const result = await ipcRenderer.invoke('install-game-data');
            if (result.success) {
                this.handleUpdateProgress({
                    type: 'ready',
                    key: 'status.dataReady'
                });
                setTimeout(() => {
                    this.checkForUpdates();
                }, 1000);
            } else {
                console.error('Game client installation failed:', result.error);
                this.handleUpdateProgress({
                    type: 'error',
                    key: 'status.installFailed'
                });
                // O botão Jogar tenta de novo
                this.enablePlayButton();
            }
        } finally {
            this.isInstallingData = false;
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
        this.updatePlayButtonState();
    }

    // Chave e parâmetros do texto de cada evento da instalação dos dados (data-manager)
    getDataProgressStatus(progress) {
        const gb = bytes => (bytes / 1024 ** 3).toFixed(2);
        switch (progress.type) {
            case 'download-start':
                return { key: 'data.downloadStart' };
            case 'download-progress':
                return {
                    key: 'data.downloadingSize',
                    params: {
                        done: gb(progress.downloaded || 0),
                        total: gb(progress.total || 0),
                        speed: (progress.speed || 0).toFixed(1)
                    }
                };
            case 'extract-start':
                return { key: 'data.extractStart' };
            case 'extract-progress':
                return { key: 'data.extracting', params: { progress: progress.progress || 0 } };
            case 'installation-complete':
                return { key: 'data.installed' };
            case 'data-exists':
                return { key: 'data.exists' };
            case 'installation-error':
                if (progress.code === 'NO_SPACE') return { key: 'data.noSpace', params: progress.params };
                if (progress.code === 'NO_CLIENT') return { key: 'data.noClient' };
                return { key: 'data.error', params: { error: progress.error || progress.message || '' } };
            default:
                return { key: 'data.processing' };
        }
    }

    async launchGame() {
        console.log('Play button clicked - Starting game launch...');
        try {
            // Cliente ainda não instalado (download falhou antes): tentar de novo
            const gameDataState = await ipcRenderer.invoke('get-game-data-state');
            if (gameDataState.success && !gameDataState.state.isInstalled) {
                if (!gameDataState.state.isInstalling) {
                    this.installGameData();
                }
                return;
            }

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
        this.playLocked = false;
        this.updatePlayButtonState();
    }

    disablePlayButton() {
        this.playLocked = true;
        this.updatePlayButtonState();
    }

    toggleCredentialsFields() {
    }

    // Os avisos aparecem em uma janela transparente por cima do launcher (ui/toast.html):
    // o webview do site cobre o HTML desta página
    showNotification(message, type = 'info') {
        ipcRenderer.invoke('toast-show', { message, type });
    }

    // Primeira instalação: o progresso usa as barras do rodapé
    // (Download = etapa atual: download ou extração; Geral = instalação inteira)
    handleDataInstallationProgress(progress) {
        const setBar = (fillId, textId, value) => {
            const percent = Math.min(100, Math.max(0, Math.floor(value || 0)));
            const fill = document.getElementById(fillId);
            const text = document.getElementById(textId);
            if (fill) fill.style.width = `${percent}%`;
            if (text) text.textContent = `${percent}%`;
        };

        const status = this.getDataProgressStatus(progress);
        this.setStatus(status.key, status.params);

        if (['download-start', 'download-progress', 'extract-start', 'extract-progress'].includes(progress.type)) {
            setBar('downloadProgressFooter', 'downloadTextFooter', progress.progress);
        }
        if (typeof progress.overall === 'number') {
            setBar('overallProgressFooter', 'overallTextFooter', progress.overall);
        }

        switch (progress.type) {
            case 'installation-complete':
                setBar('downloadProgressFooter', 'downloadTextFooter', 100);
                setBar('overallProgressFooter', 'overallTextFooter', 100);
                this.showNotification(this.t('data.installed'), 'success');
                break;
            case 'installation-error':
                this.showNotification(this.t(status.key, status.params), 'error');
                break;
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
