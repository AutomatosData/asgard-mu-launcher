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
    // Página inicial do launcher (webview): https://asgardmu.com.br/new
    MAIN: 'new'
  },

  // ===== PATCHES (Cloudflare R2) =====
  // Bucket público servido em domínio próprio. Conteúdo = pasta gerada pelo update-creator:
  //   update.json            -> manifesto (path, size, hash MD5)
  //   <path do arquivo>      -> arquivos do jogo, na mesma estrutura de pastas do cliente
  UPDATE: {
    BASE_URL: 'https://updates.asgardmu.com.br/', // deve terminar com "/"
    MANIFEST: 'update.json'
  },

  // ===== CLIENTE COMPLETO (GitHub Releases) =====
  GITHUB: {
    OWNER: 'AutomatosData', // Usuário do GitHub dono do repositório do jogo
    REPO: 'asgard-mu-client', // Nome do repositório do jogo
    // Nome fixo do ZIP do cliente em todo release (permite usar /releases/latest/download)
    CLIENT_ASSET: 'AsgardMU-Client.zip',
    // URL base para downloads de releases
    get RELEASES_URL() {
      return `https://api.github.com/repos/${this.OWNER}/${this.REPO}/releases`;
    },
    // URL para download de assets de um release específico
    getAssetDownloadUrl(tag, assetName) {
      return `https://github.com/${this.OWNER}/${this.REPO}/releases/download/${tag}/${assetName}`;
    },
    // URL do ZIP do cliente no release mais recente
    get CLIENT_DOWNLOAD_URL() {
      return `https://github.com/${this.OWNER}/${this.REPO}/releases/latest/download/${this.CLIENT_ASSET}`;
    }
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
  
  
  // Base dos patches (pasta onde ficam update.json e os arquivos)
  get UPDATE_URL() {
    return this.UPDATE.BASE_URL;
  },

  get UPDATE_MANIFEST_URL() {
    return `${this.UPDATE.BASE_URL}${this.UPDATE.MANIFEST}`;
  },

  get CLIENT_DOWNLOAD_URL() {
    return this.GITHUB.CLIENT_DOWNLOAD_URL;
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
