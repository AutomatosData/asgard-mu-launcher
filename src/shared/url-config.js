/**
 * Configuração Centralizada de URLs - AsgardMU Launcher
 * 
 * Este arquivo centraliza todas as URLs utilizadas no launcher,
 * facilitando a manutenção e alteração de endpoints.
 * 
 * Para alterar uma URL, modifique apenas este arquivo.
 */

const URL_CONFIG = {
  // ===== SERVIDOR PRINCIPAL =====
  BASE_URL: 'https://asgardmu.com.br/',
  
  // ===== CONFIGURAÇÃO DO JOGO (apenas desenvolvedor) =====
  GAME_EXECUTABLE: 'main.exe',
  // DLL do cliente que carrega o Main.dll no main.exe (proxy do glu32.dll,
  // fonte em Asgard-Mu-ServerS21/MainLoader). Substitui o antigo game.exe.
  // Sem ela, o main.exe abre sem o Main.dll e não conecta ao servidor.
  GAME_LOADER: 'glu32.dll',

  // ===== PING DO SERVIDOR (menu da bandeja) =====
  // Endereço/porta do ConnectServer usado para medir a latência via conexão TCP
  GAME_SERVER: {
    HOST: 'asgardmu.com.br',
    PORT: 44405,
    PING_INTERVAL_MS: 60000
  },

  // ===== ENDPOINTS DO LAUNCHER =====
  LAUNCHER: {
    // Página inicial do launcher (webview): https://asgardmu.com.br/new
    MAIN: 'new'
  },

  // ===== AJUDA NO JOGO (tecla F1) =====
  // Página aberta numa janela do launcher quando o jogador aperta F1 no jogo
  HELP: {
    PATH: 'whitepaper'
  },

  // ===== PUBLICAÇÃO (GitHub Releases) =====
  // Tudo que o launcher baixa fica nos releases do repositório público abaixo.
  // Quem publica é o tools/release.js (ver PUBLICAR.md):
  //   current/update.json         -> manifesto: cliente completo, launcher e patches
  //   current/AsgardMU-Setup.exe  -> instalador atual (link fixo para o site)
  //   client-<versão>/*.zip       -> cliente completo em partes (primeira instalação)
  //   patch-<versão>/<md5>        -> arquivos alterados depois do cliente completo
  //   launcher-v<versão>/*.exe    -> instaladores do launcher
  // As URLs dos arquivos vêm no manifesto; só a URL do manifesto fica fixa aqui.
  GITHUB: {
    OWNER: 'AutomatosData', // Usuário do GitHub dono do repositório do jogo
    REPO: 'asgard-mu-client', // Nome do repositório do jogo
    CURRENT_TAG: 'current', // Release com o manifesto atual
    get DOWNLOAD_URL() {
      return `https://github.com/${this.OWNER}/${this.REPO}/releases/download/`;
    }
  },

  UPDATE: {
    MANIFEST: 'update.json'
  },

  // ===== ANTI-CHEAT (histórico de detecções) =====
  // O launcher faz POST do evento em BASE_URL + REPORT_PATH. TOKEN, quando
  // preenchido, deve ser igual à variável ANTICHEAT_TOKEN do site; serve só
  // para barrar POSTs triviais de fora (não é um segredo forte).
  ANTICHEAT: {
    REPORT_PATH: 'api/anticheat/report',
    TOKEN: '',
    SCAN_INTERVAL_MS: 7000
  },

  // ===== RELATÓRIO DE CRASH =====
  // Quando o jogo trava, o launcher pergunta ao jogador e faz POST do relatório em
  // BASE_URL + REPORT_PATH (src/main/crash-report.js). TOKEN, quando preenchido, deve ser
  // igual à variável CRASH_REPORT_TOKEN (ou ANTICHEAT_TOKEN) do site.
  CRASH: {
    REPORT_PATH: 'api/crash/report',
    TOKEN: ''
  },

  // ===== CDN EXTERNOS =====
  CDN: {
    // Font Awesome (ícones)
    FONT_AWESOME: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'
  },
  
  // ===== URLS COMPLETAS =====
  get LAUNCHER_URL() {
    return `${this.BASE_URL}${this.LAUNCHER.MAIN}`;
  },

  // Whitepaper aberto pelo F1: https://asgardmu.com.br/whitepaper
  get HELP_URL() {
    return `${this.BASE_URL}${this.HELP.PATH}`;
  },
  
  
  // Manifesto: https://github.com/<OWNER>/<REPO>/releases/download/current/update.json
  // A variável de ambiente ASGARD_MANIFEST_URL troca o manifesto (teste local
  // com "npm run release:serve", ver PUBLICAR.md)
  get UPDATE_MANIFEST_URL() {
    const override = typeof process !== 'undefined' && process.env && process.env.ASGARD_MANIFEST_URL;
    return override || `${this.GITHUB.DOWNLOAD_URL}${this.GITHUB.CURRENT_TAG}/${this.UPDATE.MANIFEST}`;
  },

  // Pasta do manifesto (URLs relativas no manifesto partem daqui)
  get UPDATE_URL() {
    return this.UPDATE_MANIFEST_URL.replace(/[^/]*$/, '');
  },

  // Endpoint do histórico de anti-cheat (BASE_URL + REPORT_PATH)
  get ANTICHEAT_REPORT_URL() {
    return `${this.BASE_URL}${this.ANTICHEAT.REPORT_PATH}`;
  },

  // Endpoint do relatório de crash (BASE_URL + CRASH.REPORT_PATH)
  get CRASH_REPORT_URL() {
    return `${this.BASE_URL}${this.CRASH.REPORT_PATH}`;
  },

  // ===== FUNÇÕES AUXILIARES =====
  
  
  /**
   * Gera URL do launcher com parâmetros
   * @param {Object} params - Parâmetros da URL
   * @returns {string} URL completa do launcher
   */
  getLauncherUrlWithParams(params = {}) {
    const urlParams = new URLSearchParams(params);
    const queryString = urlParams.toString();
    return queryString ? 
      `${this.LAUNCHER_URL}?${queryString}` : 
      this.LAUNCHER_URL;
  },
  
  /**
   * Valida se uma URL é válida
   * @param {string} url - URL para validar
   * @returns {boolean} True se válida
   */
  isValidUrl(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  },
  
  /**
   * Obtém o domínio base da URL
   * @param {string} url - URL completa
   * @returns {string} Domínio base
   */
  getDomain(url) {
    try {
      return new URL(url).origin;
    } catch {
      return '';
    }
  }
};

// ===== EXPORTAÇÃO =====
if (typeof module !== 'undefined' && module.exports) {
  // Node.js (main process)
  module.exports = URL_CONFIG;
} else if (typeof window !== 'undefined') {
  // Browser (renderer process)
  window.URL_CONFIG = URL_CONFIG;
} else {
  // Outros ambientes
  global.URL_CONFIG = URL_CONFIG;
}

// ===== LOG DE INICIALIZAÇÃO (apenas em desenvolvimento) =====
if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development') {
  console.log('URL Config loaded:', {
    baseUrl: URL_CONFIG.BASE_URL,
    launcherUrl: URL_CONFIG.LAUNCHER_URL,
    updateUrl: URL_CONFIG.UPDATE_URL
  });
}
