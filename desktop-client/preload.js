const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vmsDesktop', {
  getServerUrl: () => ipcRenderer.invoke('vms:get-server-url'),
  saveServerUrl: (url) => ipcRenderer.invoke('vms:save-server-url', url),
  onInit: (handler) => {
    ipcRenderer.on('vms-connect-init', (_event, payload) => handler(payload));
  },
});
