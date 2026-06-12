/**
 * Configuração Centralizada de URLs - MU Online Launcher
 * 
 * Este arquivo centraliza todas as URLs utilizadas no launcher,
 * facilitando a manutenção e alteração de endpoints.
 * 
 * Para alterar uma URL, modifique apenas este arquivo.
 */

const URL_CONFIG = {
  // ===== SERVIDOR PRINCIPAL =====
  BASE_URL: 'http://localhost/',
  
  // ===== CONFIGURAÇÃO DO JOGO (apenas desenvolvedor) =====
  /** Nome do executável do jogo (ex: main.exe). Altere aqui se o cliente usar outro .exe */
  GAME_EXECUTABLE: 'main.exe',

  // ===== ENDPOINTS DO LAUNCHER =====
  LAUNCHER: {
    // Página principal do launcher (webview)
    MAIN: 'launcher',
    
    
    // API de atualização
    UPDATE: 'update'
  },
  
  // ===== GITHUB DOWNLOAD =====
  GITHUB_DOWNLOAD: 'https://github.com/MUONLINE.zip',
  
  // ===== CDN EXTERNOS =====
  CDN: {
    // Font Awesome (ícones)
    FONT_AWESOME: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'
  },
  
  // ===== URLS COMPLETAS (geradas automaticamente) =====
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
      `${this.LAUNCHER_URL}&${queryString}` : 
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
