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

  // ===== ENDPOINTS DO LAUNCHER =====
  LAUNCHER: {
    // Página inicial do launcher (webview): https://asgardmu.com.br/news
    MAIN: 'news',
    
    // API de atualização
    UPDATE: 'api/update/update.json'
  },
  
  // ===== GITHUB RELEASES =====
  GITHUB: {
    OWNER: 'seu-usuario', // Altere para seu usuário do GitHub
    REPO: 'asgardmu-game', // Nome do repositório do jogo
    // URL base para downloads de releases
    get RELEASES_URL() {
      return `https://api.github.com/repos/${this.OWNER}/${this.REPO}/releases`;
    },
    // URL para download de assets de um release específico
    getAssetDownloadUrl(tag, assetName) {
      return `https://github.com/${this.OWNER}/${this.REPO}/releases/download/${tag}/${assetName}`;
    }
  },
  
  // ===== GITHUB DOWNLOAD (legado) =====
  GITHUB_DOWNLOAD: 'https://github.com/AsgardMU.zip',
  
  // ===== CDN EXTERNOS =====
  CDN: {
    // Font Awesome (ícones)
    FONT_AWESOME: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'
  },
  
  // ===== URLS COMPLETAS =====
  get LAUNCHER_URL() {
    return `${this.BASE_URL}${this.LAUNCHER.MAIN}`;
  },
  
  
  get UPDATE_URL() {
    return `${this.BASE_URL}${this.LAUNCHER.UPDATE}`;
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
