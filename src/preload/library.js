'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const inv = (ch, ...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('libraryApi', {
  list: (filter) => inv('library:list', filter),
  locale: () => inv('library:locale'),
  get: (id) => inv('library:get', id),
  thumbDataUrl: (id) => inv('library:thumbDataUrl', id),
  remove: (ids) => inv('library:remove', ids),
  rename: (id, name) => inv('library:rename', id, name),
  setFavorite: (ids, fav) => inv('library:favorite', ids, fav),
  setTags: (ids, tags) => inv('library:tags', ids, tags),
  setThumb: (id, dataUrl, dims) => inv('library:setThumb', id, dataUrl, dims),
  copy: (id) => inv('library:copy', id),
  reveal: (id) => inv('library:reveal', id),
  exportItems: (ids, format) => inv('library:export', ids, format),
  importDialog: () => inv('library:import'),
  importPaths: (paths) => inv('library:importPaths', paths),
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch (_) { return ''; }
  },
  openEditor: (id) => inv('library:openEditor', id),
  openSettings: () => inv('library:open-settings'),
  startDrag: (ids) => ipcRenderer.send('library:startDrag', ids),
  capture: (kind) => inv('capture:' + kind), // region | fullscreen | window | scrolling
  startRecording: () => inv('recorder:start'),
  optimize: (ids, preset) => inv('library:optimize', ids, preset),
  optimizeCancel: (id) => inv('library:optimizeCancel', id),
  optimizing: () => inv('library:optimizing'),
  onOptimize: (cb) => {
    const h = (_e, detail) => cb(detail);
    ipcRenderer.on('library:optimize-event', h);
    return () => ipcRenderer.removeListener('library:optimize-event', h);
  },
  onChanged: (cb) => {
    const h = (_e, detail) => cb(detail);
    ipcRenderer.on('library:changed', h);
    return () => ipcRenderer.removeListener('library:changed', h);
  },
});
