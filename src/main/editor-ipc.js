'use strict';
const fs = require('fs');
const path = require('path');
const { ipcMain, dialog, clipboard, nativeImage, BrowserWindow } = require('electron');
const store = require('./store');

function decodeDataUrl(dataURL) {
  if (dataURL && typeof dataURL !== 'string') return Buffer.from(dataURL.buffer || dataURL, dataURL.byteOffset || 0, dataURL.byteLength); // raw PNG bytes
  const m = /^data:image\/[a-z0-9.+-]+;base64,(.*)$/i.exec(String(dataURL || ''));
  if (!m) throw new Error('Invalid image data');
  return Buffer.from(m[1], 'base64');
}

async function fileToDataUrl(file) {
  if (!file) return null;
  const buf = await fs.promises.readFile(file);
  return 'data:image/png;base64,' + buf.toString('base64');
}

async function writeImage(id, dataURL) {
  await store.updateImage(id, decodeDataUrl(dataURL));
  return true;
}

const handlers = {
  getItem: id => store.get(id),
  loadImage: async id => fileToDataUrl(await store.getFilePath(id)),
  loadOriginal: async id => {
    const p = await store.getOriginalPath(id);
    if (p && fs.existsSync(p)) return fileToDataUrl(p);
    return fileToDataUrl(await store.getFilePath(id));
  },
  loadAnnotations: id => store.getAnnotations(id),
  saveAnnotations: async (id, obj) => { await store.saveAnnotations(id, obj); return true; },
  saveImage: (id, dataURL) => writeImage(id, dataURL),
  copyToClipboard: dataURL => {
    const img = nativeImage.createFromBuffer(decodeDataUrl(dataURL));
    if (img.isEmpty()) throw new Error('Empty image');
    clipboard.writeImage(img);
    return true;
  },
  // The saved image is exactly what the editor shows: no need to send pixels back and forth.
  copySaved: async id => {
    const fp = await store.getFilePath(id);
    const img = fp ? nativeImage.createFromPath(fp) : null;
    if (!img || img.isEmpty()) throw new Error('Empty image');
    clipboard.writeImage(img);
    return true;
  },
  // Raw RGBA pixels from a canvas: skips the (slow) PNG encode/decode round trip.
  copyPixels: (width, height, rgba) => {
    const buf = Buffer.from(rgba.buffer || rgba, rgba.byteOffset || 0, rgba.byteLength);
    if (buf.length !== width * height * 4) throw new Error('Bad pixel data');
    const px = new Uint32Array(buf.buffer, buf.byteOffset, buf.length / 4);
    for (let i = 0; i < px.length; i++) {
      const v = px[i];
      px[i] = (v & 0xff00ff00) | ((v & 0xff) << 16) | ((v >>> 16) & 0xff); // RGBA -> BGRA
    }
    clipboard.writeImage(nativeImage.createFromBitmap(buf, { width, height }));
    return true;
  },
  saveAs: async (dataURL, suggestedName) => {
    const buf = decodeDataUrl(dataURL);
    const win = BrowserWindow.getFocusedWindow() || undefined;
    const base = path.basename(String(suggestedName || 'image.png'));
    const res = await dialog.showSaveDialog(win, {
      title: 'Save image as',
      defaultPath: base,
      filters: [{ name: 'PNG image', extensions: ['png'] }, { name: 'JPEG image', extensions: ['jpg', 'jpeg'] }]
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    const ext = path.extname(res.filePath).toLowerCase();
    let out = buf;
    if (ext === '.jpg' || ext === '.jpeg') out = nativeImage.createFromBuffer(buf).toJPEG(90);
    await fs.promises.writeFile(res.filePath, out);
    return { canceled: false, filePath: res.filePath };
  },
  openLibrary: () => {
    require('./windows').openLibrary();
    return true;
  }
};

let registered = false;

// Removes a capture from the library and closes the editor window showing it. opts.confirm asks first.
// Only the editor that has the item open may delete it.
async function deleteItem(win, id, opts) {
  if (!win || require('./windows').getEditor(id) !== win) return false;
  if (opts && opts.confirm) {
    const it = await store.get(id);
    const res = await dialog.showMessageBox(win, {
      type: 'warning',
      title: 'Delete capture',
      message: `Delete "${(it && it.name) || 'this capture'}"?`,
      detail: 'It is removed from the library. This can\'t be undone.',
      buttons: ['Delete', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (res.response !== 0) return false;
  }
  await store.remove(id);
  if (win && !win.isDestroyed()) win.close();
  return true;
}

function register() {
  for (const [name, fn] of Object.entries(handlers)) {
    const ch = 'editor:' + name;
    ipcMain.removeHandler(ch);
    ipcMain.handle(ch, (_e, ...args) => fn(...args));
  }
  ipcMain.removeHandler('editor:deleteItem');
  ipcMain.handle('editor:deleteItem', (e, id, opts) => deleteItem(BrowserWindow.fromWebContents(e.sender), id, opts));
  if (registered) ipcMain.removeAllListeners('editor:ready');
  ipcMain.on('editor:ready', (e) => require('./windows').editorReady(BrowserWindow.fromWebContents(e.sender)));
  if (registered) ipcMain.removeAllListeners('editor:autosave');
  ipcMain.on('editor:autosave', async (_e, id, obj, dataURL) => {
    try {
      if (dataURL) await writeImage(id, dataURL);
      if (obj) await store.saveAnnotations(id, obj);
    } catch (err) {
      console.error('[editor] autosave failed:', err && err.message);
    }
  });
  registered = true;
}

module.exports = { register };
