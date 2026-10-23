const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scrollBar', {
  action: (name) => ipcRenderer.send('scrollbar:action', name),
  onStatus: (cb) => ipcRenderer.on('scrollbar:status', (_e, status) => cb(status)),
});
