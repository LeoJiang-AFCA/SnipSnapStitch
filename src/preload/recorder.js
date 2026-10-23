'use strict';
// Shared preload for every recorder-owned window (setup HUD, control bar, region overlay,
// countdown, cursor halo, hidden capture worker). Only `recorder:` channels are reachable.
const { contextBridge, ipcRenderer } = require('electron');

const ok = (channel) => typeof channel === 'string' && channel.startsWith('recorder:');

contextBridge.exposeInMainWorld('recorderApi', {
  invoke(channel, payload) {
    if (!ok(channel)) return Promise.reject(new Error('Blocked channel: ' + channel));
    return ipcRenderer.invoke(channel, payload);
  },
  send(channel, payload) {
    if (ok(channel)) ipcRenderer.send(channel, payload);
  },
  on(channel, cb) {
    if (!ok(channel)) return () => {};
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
