'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch, ...args) => ipcRenderer.invoke('editor:' + ch, ...args);

contextBridge.exposeInMainWorld('editorApi', {
  getItem: id => invoke('getItem', id),
  loadImage: id => invoke('loadImage', id),
  loadOriginal: id => invoke('loadOriginal', id),
  loadAnnotations: id => invoke('loadAnnotations', id),
  saveAnnotations: (id, obj) => invoke('saveAnnotations', id, obj),
  saveImage: (id, dataURL) => invoke('saveImage', id, dataURL),
  copyToClipboard: dataURL => invoke('copyToClipboard', dataURL),
  copySaved: id => invoke('copySaved', id),
  copyPixels: (width, height, rgba) => invoke('copyPixels', width, height, rgba),
  saveAs: (dataURL, suggestedName) => invoke('saveAs', dataURL, suggestedName),
  openLibrary: () => invoke('openLibrary'),
  // Removes the capture and closes this editor; opts.confirm asks first. Resolves false when not deleted.
  deleteItem: (id, opts) => invoke('deleteItem', id, opts),
  // A pre-loaded (hidden) editor is handed its item by main; cb(id) runs once.
  onOpen: cb => ipcRenderer.once('editor:open', (_e, id) => cb(String(id))),
  // The item is loaded: main shows the window.
  ready: () => ipcRenderer.send('editor:ready'),
  // fire-and-forget; used while the window is closing
  autosave: (id, obj, dataURL) => ipcRenderer.send('editor:autosave', id, obj, dataURL)
});
