// Gerenciador de idioma da interface do launcher.
// Elementos com data-i18n / data-i18n-title / data-i18n-placeholder são traduzidos automaticamente.
class I18nManager {
    constructor() {
        this.lang = I18N.DEFAULT_LANGUAGE;
        this.listeners = [];
    }

    // Lê o idioma salvo em LauncherOption.if
    async init() {
        try {
            const result = await window.ipcRenderer.invoke('get-launcher-options');
            if (result.success && result.settings) {
                this.lang = I18N.normalize(result.settings.langSelection);
            }
        } catch (error) {
            console.error('[i18n] Failed to read language:', error);
        }
        this.apply();
    }

    t(key, params) {
        return I18N.translate(this.lang, key, params);
    }

    setLanguage(lang) {
        const normalized = I18N.normalize(lang);
        if (normalized === this.lang) return;
        this.lang = normalized;
        this.apply();
        this.listeners.forEach(listener => listener(this.lang));
    }

    onChange(listener) {
        this.listeners.push(listener);
    }

    apply() {
        document.documentElement.lang = I18N.HTML_LANG[this.lang] || 'en';

        document.querySelectorAll('[data-i18n]').forEach(el => {
            el.textContent = this.t(el.dataset.i18n);
        });
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            el.title = this.t(el.dataset.i18nTitle);
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            el.placeholder = this.t(el.dataset.i18nPlaceholder);
        });
    }
}

window.i18n = new I18nManager();
