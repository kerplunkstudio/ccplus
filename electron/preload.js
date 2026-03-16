const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  getServerUrl: () => ipcRenderer.invoke('get-server-url'),
  onMenuAction: (callback) => {
    ipcRenderer.on('menu-action', callback);
  },
  removeMenuActionListener: (callback) => {
    ipcRenderer.removeListener('menu-action', callback);
  },
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});

// Keep legacy 'electron' for backward compatibility
contextBridge.exposeInMainWorld('electron', {
  getServerUrl: () => ipcRenderer.invoke('get-server-url'),
});
