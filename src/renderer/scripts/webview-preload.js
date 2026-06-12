const { ipcRenderer, contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    invoke: (channel, data) => ipcRenderer.invoke(channel, data),
    
    log: (message) => {
        console.log(message);
        ipcRenderer.send('webview-log', message);
    },
    
    error: (message) => {
        console.error(message);
        ipcRenderer.send('webview-error', message);
    },
    
    openDevTools: () => ipcRenderer.invoke('open-devtools'),
    
    isAvailable: true
});

window.ipcRenderer = ipcRenderer;

console.log('[WebviewPreload] Preload script loaded successfully');
