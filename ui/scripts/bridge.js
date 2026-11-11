// Ponte entre a interface e o launcher em Rust (src-tauri/src/main.rs).
//
// A interface usa canais com o nome antigo: ipcRenderer.invoke('get-config').
// O comando Rust tem o mesmo nome com "_" no lugar de "-" e ":" (get_config).
// O argumento do canal chega no comando como "payload".
(function () {
    const tauri = window.__TAURI__;

    window.ipcRenderer = {
        invoke(channel, payload) {
            const command = channel.replace(/[-:]/g, '_');
            return tauri.core.invoke(command, payload === undefined ? {} : { payload });
        },
        // Eventos enviados pelo launcher: o ouvinte recebe (evento, dados)
        on(channel, listener) {
            tauri.event.listen(channel, event => listener(event, event.payload));
        }
    };

    // Sem o menu do navegador (voltar, recarregar, imprimir)
    document.addEventListener('contextmenu', event => event.preventDefault());

    // O site fica em um webview por cima da interface e cobre o HTML. Com a janela
    // de configurações aberta, o launcher esconde o site.
    document.addEventListener('DOMContentLoaded', () => {
        const modal = document.getElementById('settingsModal');
        if (!modal) return;
        let covered = false;
        const sync = () => {
            const open = getComputedStyle(modal).display !== 'none';
            if (open !== covered) {
                covered = open;
                window.ipcRenderer.invoke('site-set-covered', open);
            }
        };
        new MutationObserver(sync).observe(modal, { attributes: true, attributeFilter: ['class', 'style'] });
    });
})();
