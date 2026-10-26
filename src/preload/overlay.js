'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayApi', {
  // The window is pre-loaded and idle; main pushes the init payload when a capture starts.
  onInit: (cb) => {
    ipcRenderer.once('overlay:init', (_e, init) => cb(init));
    ipcRenderer.send('overlay:loaded');
  },
  ready: () => ipcRenderer.send('overlay:ready'),
  activate: () => ipcRenderer.send('overlay:activate'),
  confirm: (rect) => ipcRenderer.send('overlay:confirm', rect),
  cancel: () => ipcRenderer.send('overlay:cancel'),
  // Snip Area mode bar: 'scrolling' | 'record' | 'fullscreen'.
  switchMode: (mode) => ipcRenderer.send('overlay:switch', mode),
  onMode: (cb) => ipcRenderer.on('overlay:mode', (_e, m) => cb(m)),
  onCountdown: (cb) => ipcRenderer.on('overlay:countdown', (_e, n) => cb(n)),
});
