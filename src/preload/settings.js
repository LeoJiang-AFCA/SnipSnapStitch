const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsApi', {
  getAll: () => ipcRenderer.invoke('settings:get-all'),
  setMany: (obj) => ipcRenderer.invoke('settings:set-many', obj),
  chooseFolder: () => ipcRenderer.invoke('settings:choose-folder'),
  close: () => ipcRenderer.invoke('settings:close'),
});
