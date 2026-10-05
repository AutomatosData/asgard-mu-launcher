/**
 * Traduções do Launcher - AsgardMU
 *
 * Idiomas disponíveis (mesmos códigos usados em LauncherOption.if / langSelection):
 *   Eng = English, Por = Português, Spa = Español
 *
 * Para adicionar um texto, crie a mesma chave nos 3 idiomas.
 * Parâmetros usam a sintaxe {nome}, ex.: t('status.downloadingFiles', { current: 1, total: 5 })
 */

const TRANSLATIONS = {
  Eng: {
    // Interface
    'titlebar.settings': 'Settings',
    'loading': 'Loading...',
    'web.error': 'Failed to load content',
    'footer.download': 'Download:',
    'footer.overall': 'Overall:',
    'footer.accounts': 'Connected Accounts',
    'play': 'Play Game',

    // Configurações
    'settings.title': 'Game Settings',
    'settings.tabGame': 'Game',
    'settings.tabAccount': 'Account',
    'settings.displayMode': 'Display Mode',
    'settings.window': 'Window Mode',
    'settings.fullscreen': 'Fullscreen Mode',
    'settings.resolution': 'Resolution',
    'settings.audio': 'Audio Settings',
    'settings.music': 'Enable Music',
    'settings.sound': 'Enable Sound Effects',
    'settings.account': 'Account',
    'settings.accountPlaceholder': 'Enter account ID (max 10 chars)',
    'settings.language': 'Language',
    'settings.cancel': 'Cancel',
    'settings.save': 'Save Settings',

    // Instalação dos dados
    'install.title': 'Installing Game Data',
    'install.overall': 'Overall Progress:',
    'install.initializing': 'Initializing...',

    // Status do rodapé
    'status.initializing': 'Initializing launcher...',
    'status.waitingClient': 'Waiting for client download...',
    'status.waitingData': 'Waiting for game data installation...',
    'status.checking': 'Checking for updates...',
    'status.filesNeedUpdate': '{count} files need update - Starting download...',
    'status.upToDate': 'Game is up to date - Ready to play!',
    'status.checkFailed': 'Failed to check updates - Please try again',
    'status.startingUpdate': 'Starting update process...',
    'status.updateDone': 'Update completed successfully - Ready to play!',
    'status.updateFailedWith': 'Update failed: {error} - Please try again',
    'status.updateFailed': 'Update failed - Please try again',
    'status.dataReady': 'Game data ready - checking for updates...',
    'status.dataError': 'Data installation error',
    'status.manifest': 'Downloading update manifest...',
    'status.downloadingFiles': 'Downloading {current} of {total} files',
    'status.downloadingFile': 'Downloading: {file}',
    'status.file': 'file',
    'status.verifying': 'Verifying downloaded files...',
    'status.ready': 'Ready to play',

    // Notificações
    'notify.initFailed': 'Failed to initialize AsgardMU: {error}',
    'notify.filesNeedUpdate': '{count} files need to be updated',
    'notify.checkFailed': 'Failed to check for updates',
    'notify.updateDone': 'Update completed successfully',
    'notify.updateFailedWith': 'Update failed: {error}',
    'notify.updateFailed': 'Update failed',
    'notify.launching': 'Launching game...',
    'notify.launchFailedWith': 'Failed to launch game: {error}',
    'notify.launchFailed': 'Failed to launch game',
    'notify.settingsSaved': 'Game settings saved successfully',
    'notify.settingsFailed': 'Failed to save settings',
    'notify.settingsFailedWith': 'Failed to save settings: {error}',

    // Progresso da instalação dos dados (data-manager)
    'data.processing': 'Processing...',
    'data.downloadStart': 'Starting game data download...',
    'data.downloading': 'Downloading game data... {progress}%',
    'data.downloadDone': 'Download completed successfully!',
    'data.extractStart': 'Starting data extraction...',
    'data.extracting': 'Extracting files... {progress}%',
    'data.extractDone': 'Data installation completed successfully!',
    'data.exists': 'Game data already installed!',
    'data.installed': 'Game data installed successfully!',
    'data.error': 'Installation error: {error}',

    // Processo principal (bandeja / notificações do Windows)
    'tray.show': 'Show Launcher',
    'tray.launch': 'Launch Game',
    'tray.quit': 'Quit',
    'tray.minimized': 'AsgardMU minimized to system tray',
    'tray.characterSelected': 'Character Selected',
    'tray.characterSelectedMsg': 'Character "{name}" has been selected',
    'menu.inspect': 'Inspect'
  },

  Por: {
    'titlebar.settings': 'Configurações',
    'loading': 'Carregando...',
    'web.error': 'Falha ao carregar o conteúdo',
    'footer.download': 'Download:',
    'footer.overall': 'Geral:',
    'footer.accounts': 'Contas Conectadas',
    'play': 'Jogar',

    'settings.title': 'Configurações do Jogo',
    'settings.tabGame': 'Jogo',
    'settings.tabAccount': 'Conta',
    'settings.displayMode': 'Modo de Exibição',
    'settings.window': 'Modo Janela',
    'settings.fullscreen': 'Tela Cheia',
    'settings.resolution': 'Resolução',
    'settings.audio': 'Áudio',
    'settings.music': 'Ativar Música',
    'settings.sound': 'Ativar Efeitos Sonoros',
    'settings.account': 'Conta',
    'settings.accountPlaceholder': 'Digite o ID da conta (máx. 10 caracteres)',
    'settings.language': 'Idioma',
    'settings.cancel': 'Cancelar',
    'settings.save': 'Salvar',

    'install.title': 'Instalando Dados do Jogo',
    'install.overall': 'Progresso Geral:',
    'install.initializing': 'Inicializando...',

    'status.initializing': 'Inicializando o launcher...',
    'status.waitingClient': 'Aguardando download do cliente...',
    'status.waitingData': 'Aguardando instalação dos dados do jogo...',
    'status.checking': 'Verificando atualizações...',
    'status.filesNeedUpdate': '{count} arquivos precisam ser atualizados - Iniciando download...',
    'status.upToDate': 'Jogo atualizado - Pronto para jogar!',
    'status.checkFailed': 'Falha ao verificar atualizações - Tente novamente',
    'status.startingUpdate': 'Iniciando atualização...',
    'status.updateDone': 'Atualização concluída - Pronto para jogar!',
    'status.updateFailedWith': 'Falha na atualização: {error} - Tente novamente',
    'status.updateFailed': 'Falha na atualização - Tente novamente',
    'status.dataReady': 'Dados do jogo prontos - verificando atualizações...',
    'status.dataError': 'Erro na instalação dos dados',
    'status.manifest': 'Baixando lista de atualizações...',
    'status.downloadingFiles': 'Baixando {current} de {total} arquivos',
    'status.downloadingFile': 'Baixando: {file}',
    'status.file': 'arquivo',
    'status.verifying': 'Verificando arquivos baixados...',
    'status.ready': 'Pronto para jogar',

    'notify.initFailed': 'Falha ao iniciar o AsgardMU: {error}',
    'notify.filesNeedUpdate': '{count} arquivos precisam ser atualizados',
    'notify.checkFailed': 'Falha ao verificar atualizações',
    'notify.updateDone': 'Atualização concluída com sucesso',
    'notify.updateFailedWith': 'Falha na atualização: {error}',
    'notify.updateFailed': 'Falha na atualização',
    'notify.launching': 'Iniciando o jogo...',
    'notify.launchFailedWith': 'Falha ao iniciar o jogo: {error}',
    'notify.launchFailed': 'Falha ao iniciar o jogo',
    'notify.settingsSaved': 'Configurações salvas com sucesso',
    'notify.settingsFailed': 'Falha ao salvar as configurações',
    'notify.settingsFailedWith': 'Falha ao salvar as configurações: {error}',

    'data.processing': 'Processando...',
    'data.downloadStart': 'Iniciando download dos dados do jogo...',
    'data.downloading': 'Baixando dados do jogo... {progress}%',
    'data.downloadDone': 'Download concluído com sucesso!',
    'data.extractStart': 'Iniciando extração dos dados...',
    'data.extracting': 'Extraindo arquivos... {progress}%',
    'data.extractDone': 'Instalação dos dados concluída com sucesso!',
    'data.exists': 'Dados do jogo já instalados!',
    'data.installed': 'Dados do jogo instalados com sucesso!',
    'data.error': 'Erro na instalação: {error}',

    'tray.show': 'Mostrar Launcher',
    'tray.launch': 'Iniciar Jogo',
    'tray.quit': 'Sair',
    'tray.minimized': 'AsgardMU minimizado na bandeja do sistema',
    'tray.characterSelected': 'Personagem Selecionado',
    'tray.characterSelectedMsg': 'O personagem "{name}" foi selecionado',
    'menu.inspect': 'Inspecionar'
  },

  Spa: {
    'titlebar.settings': 'Configuración',
    'loading': 'Cargando...',
    'web.error': 'Error al cargar el contenido',
    'footer.download': 'Descarga:',
    'footer.overall': 'Total:',
    'footer.accounts': 'Cuentas Conectadas',
    'play': 'Jugar',

    'settings.title': 'Configuración del Juego',
    'settings.tabGame': 'Juego',
    'settings.tabAccount': 'Cuenta',
    'settings.displayMode': 'Modo de Pantalla',
    'settings.window': 'Modo Ventana',
    'settings.fullscreen': 'Pantalla Completa',
    'settings.resolution': 'Resolución',
    'settings.audio': 'Audio',
    'settings.music': 'Activar Música',
    'settings.sound': 'Activar Efectos de Sonido',
    'settings.account': 'Cuenta',
    'settings.accountPlaceholder': 'Ingrese el ID de la cuenta (máx. 10 caracteres)',
    'settings.language': 'Idioma',
    'settings.cancel': 'Cancelar',
    'settings.save': 'Guardar',

    'install.title': 'Instalando Datos del Juego',
    'install.overall': 'Progreso Total:',
    'install.initializing': 'Inicializando...',

    'status.initializing': 'Inicializando el launcher...',
    'status.waitingClient': 'Esperando la descarga del cliente...',
    'status.waitingData': 'Esperando la instalación de los datos del juego...',
    'status.checking': 'Buscando actualizaciones...',
    'status.filesNeedUpdate': '{count} archivos necesitan actualizarse - Iniciando descarga...',
    'status.upToDate': 'Juego actualizado - ¡Listo para jugar!',
    'status.checkFailed': 'Error al buscar actualizaciones - Inténtelo de nuevo',
    'status.startingUpdate': 'Iniciando actualización...',
    'status.updateDone': 'Actualización completada - ¡Listo para jugar!',
    'status.updateFailedWith': 'Error en la actualización: {error} - Inténtelo de nuevo',
    'status.updateFailed': 'Error en la actualización - Inténtelo de nuevo',
    'status.dataReady': 'Datos del juego listos - buscando actualizaciones...',
    'status.dataError': 'Error en la instalación de los datos',
    'status.manifest': 'Descargando lista de actualizaciones...',
    'status.downloadingFiles': 'Descargando {current} de {total} archivos',
    'status.downloadingFile': 'Descargando: {file}',
    'status.file': 'archivo',
    'status.verifying': 'Verificando archivos descargados...',
    'status.ready': 'Listo para jugar',

    'notify.initFailed': 'Error al iniciar AsgardMU: {error}',
    'notify.filesNeedUpdate': '{count} archivos necesitan actualizarse',
    'notify.checkFailed': 'Error al buscar actualizaciones',
    'notify.updateDone': 'Actualización completada con éxito',
    'notify.updateFailedWith': 'Error en la actualización: {error}',
    'notify.updateFailed': 'Error en la actualización',
    'notify.launching': 'Iniciando el juego...',
    'notify.launchFailedWith': 'Error al iniciar el juego: {error}',
    'notify.launchFailed': 'Error al iniciar el juego',
    'notify.settingsSaved': 'Configuración guardada con éxito',
    'notify.settingsFailed': 'Error al guardar la configuración',
    'notify.settingsFailedWith': 'Error al guardar la configuración: {error}',

    'data.processing': 'Procesando...',
    'data.downloadStart': 'Iniciando la descarga de los datos del juego...',
    'data.downloading': 'Descargando datos del juego... {progress}%',
    'data.downloadDone': '¡Descarga completada con éxito!',
    'data.extractStart': 'Iniciando la extracción de los datos...',
    'data.extracting': 'Extrayendo archivos... {progress}%',
    'data.extractDone': '¡Instalación de los datos completada con éxito!',
    'data.exists': '¡Los datos del juego ya están instalados!',
    'data.installed': '¡Datos del juego instalados con éxito!',
    'data.error': 'Error en la instalación: {error}',

    'tray.show': 'Mostrar Launcher',
    'tray.launch': 'Iniciar Juego',
    'tray.quit': 'Salir',
    'tray.minimized': 'AsgardMU minimizado en la bandeja del sistema',
    'tray.characterSelected': 'Personaje Seleccionado',
    'tray.characterSelectedMsg': 'El personaje "{name}" ha sido seleccionado',
    'menu.inspect': 'Inspeccionar'
  }
};

const I18N = {
  DEFAULT_LANGUAGE: 'Eng',
  LANGUAGES: Object.keys(TRANSLATIONS),

  // Valor para o atributo lang do HTML
  HTML_LANG: { Eng: 'en', Por: 'pt-BR', Spa: 'es' },

  normalize(lang) {
    return TRANSLATIONS[lang] ? lang : this.DEFAULT_LANGUAGE;
  },

  translate(lang, key, params = {}) {
    const dict = TRANSLATIONS[this.normalize(lang)];
    const text = dict[key] ?? TRANSLATIONS[this.DEFAULT_LANGUAGE][key] ?? key;
    return text.replace(/\{(\w+)\}/g, (match, name) => (params[name] !== undefined ? params[name] : match));
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = I18N;
}
if (typeof window !== 'undefined') {
  window.I18N = I18N;
}
