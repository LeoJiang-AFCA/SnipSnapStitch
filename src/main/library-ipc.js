'use strict';
// IPC + sss:// protocol for the library window. Channels are prefixed `library:`.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { Readable } = require('stream');
const { app, ipcMain, protocol, dialog, clipboard, shell, nativeImage, BrowserWindow, Notification } = require('electron');
const store = require('./store');
const optimizer = require('./video-optimizer');

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.bmp', '.webp', '.gif'];
const MEDIA_EXTS = { '.webm': 'webm', '.mp4': 'mp4', '.gif': 'gif' };
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webm': 'video/webm', '.mp4': 'video/mp4', '.gif': 'image/gif' };

let registered = false;

// Must be called BEFORE app 'ready' (main.js).
function registerProtocolScheme() {
  protocol.registerSchemesAsPrivileged([{
    scheme: 'sss',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  }]);
}

function version(it, thumb) {
  return it.updatedAt || it.createdAt || 0;
}

async function decorate(it) {
  if (!it) return null;
  const thumbPath = await store.getThumbPath(it.id);
  const filePath = await store.getFilePath(it.id);
  const v = version(it);
  return {
    ...it,
    hasThumb: !!thumbPath,
    thumbUrl: thumbPath ? `sss://thumb/${it.id}?v=${v}` : null,
    fileUrl: `sss://file/${it.id}?v=${v}`,
    thumbFileUrl: thumbPath ? pathToFileURL(thumbPath).href + `?v=${v}` : null,
    fileFileUrl: pathToFileURL(filePath).href + `?v=${v}`,
  };
}

function fileResponse(filePath, req) {
  let stat;
  try { stat = fs.statSync(filePath); } catch (_) { return new Response('Not found', { status: 404 }); }
  const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') || '');
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  if (range && (range[1] || range[2])) {
    let start = range[1] ? parseInt(range[1], 10) : Math.max(0, stat.size - parseInt(range[2], 10));
    let end = range[1] && range[2] ? parseInt(range[2], 10) : stat.size - 1;
    end = Math.min(end, stat.size - 1);
    if (start > end || start >= stat.size) return new Response('Bad range', { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
    headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    headers['Content-Length'] = String(end - start + 1);
    return new Response(Readable.toWeb(fs.createReadStream(filePath, { start, end })), { status: 206, headers });
  }
  headers['Content-Length'] = String(stat.size);
  return new Response(Readable.toWeb(fs.createReadStream(filePath)), { status: 200, headers });
}

async function handleProtocol(req) {
  try {
    const u = new URL(req.url);
    const id = u.pathname.replace(/^\//, '');
    if (u.hostname === 'thumb') {
      const tp = await store.getThumbPath(id);
      return tp ? fileResponse(tp, req) : new Response('No thumbnail', { status: 404 });
    }
    if (u.hostname === 'file') {
      const fp = await store.getFilePath(id);
      return fp ? fileResponse(fp, req) : new Response('Not found', { status: 404 });
    }
  } catch (_) { /* fall through */ }
  return new Response('Bad request', { status: 400 });
}

function ids(arg) {
  return [].concat(arg).filter(Boolean);
}

function sanitizeName(n) {
  return String(n || 'capture').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120) || 'capture';
}

function parentWindow(e) {
  return BrowserWindow.fromWebContents(e.sender) || undefined;
}

async function importPaths(files) {
  const added = [];
  for (const f of files) {
    try {
      const ext = path.extname(f).toLowerCase();
      if (!fs.existsSync(f) || !fs.statSync(f).isFile()) continue;
      const name = path.basename(f, path.extname(f));
      if (MEDIA_EXTS[ext]) {
        added.push(await store.addMedia(fs.readFileSync(f), { ext: MEDIA_EXTS[ext], source: 'import', name }));
      } else if (IMAGE_EXTS.includes(ext)) {
        const img = nativeImage.createFromPath(f);
        if (img.isEmpty()) continue;
        added.push(await store.addCapture(img.toPNG(), { source: 'import', name }));
      }
    } catch (err) {
      console.error('[library] import failed for', f, err);
    }
  }
  return added;
}

function register() {
  if (registered) return;
  registered = true;

  const installProtocol = () => {
    try {
      if (!protocol.isProtocolHandled('sss')) protocol.handle('sss', handleProtocol);
    } catch (err) {
      console.error('[library] protocol.handle failed', err);
    }
  };
  if (app.isReady()) installProtocol(); else app.whenReady().then(installProtocol);

  store.events.on('changed', (detail) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send('library:changed', detail);
    }
  });

  ipcMain.handle('library:list', async (_e, filter) => Promise.all((await store.list(filter || {})).map(decorate)));
  // Windows regional format; the renderer's own locale is en-US because only that Chromium locale pack is shipped.
  ipcMain.handle('library:locale', () => app.getSystemLocale());

  // ---- video optimizer (smaller re-encode) ----
  const broadcast = (channel, payload) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send(channel, payload);
    }
  };
  setTimeout(() => { try { optimizer.cleanStale(store.dataDir()); } catch (e) { console.error('cleanStale failed', e); } }, 15000).unref();
  optimizer.events.on('progress', (p) => broadcast('library:optimize-event', { type: 'progress', ...p }));
  optimizer.events.on('done', (r) => {
    broadcast('library:optimize-event', { type: 'done', ...r });
    if (r.notify && !r.error) {
      try {
        if (Notification.isSupported()) {
          const mb = (b) => (b / 1048576).toFixed(1) + ' MB';
          new Notification({
            title: 'SnipSnapStitch video optimized',
            body: r.replaced ? `${mb(r.before)} \u2192 ${mb(r.after)}` : 'The video was already small, so it was left as is.',
          }).show();
        }
      } catch (e) { /* ignore */ }
    }
  });
  store.events.on('changed', (d) => { if (d && d.type === 'remove') optimizer.cancel(d.id); });
  app.once('will-quit', () => { optimizer.cancelAll(); });
  ipcMain.handle('library:optimize', async (_e, arg, preset) => {
    let started = 0;
    for (const id of ids(arg)) {
      const it = await store.get(id);
      if (it && it.type === 'video' && optimizer.optimize(id, { preset: preset === 'smallest' ? 'smallest' : 'balanced' })) started++;
    }
    return started;
  });
  ipcMain.handle('library:optimizeCancel', (_e, id) => optimizer.cancel(id));
  ipcMain.handle('library:optimizing', () => optimizer.active());
  ipcMain.handle('library:get', async (_e, id) => decorate(await store.get(id)));
  ipcMain.handle('library:thumbDataUrl', async (_e, id) => {
    const tp = await store.getThumbPath(id);
    return tp ? 'data:image/jpeg;base64,' + fs.readFileSync(tp).toString('base64') : null;
  });
  ipcMain.handle('library:remove', async (_e, arg) => {
    for (const id of ids(arg)) await store.remove(id);
    return true;
  });
  ipcMain.handle('library:rename', async (_e, id, name) => decorate(await store.rename(id, name)));
  ipcMain.handle('library:favorite', async (_e, arg, fav) => {
    for (const id of ids(arg)) await store.setFavorite(id, fav);
    return true;
  });
  ipcMain.handle('library:tags', async (_e, arg, tags) => {
    for (const id of ids(arg)) await store.setTags(id, tags);
    return true;
  });
  ipcMain.handle('library:setThumb', async (_e, id, dataUrl, dims) => {
    const m = /^data:image\/\w+;base64,(.+)$/.exec(dataUrl || '');
    if (!m) return false;
    await store.setThumb(id, Buffer.from(m[1], 'base64'), dims || {});
    return true;
  });

  ipcMain.handle('library:copy', async (_e, id) => {
    const it = await store.get(id);
    if (!it) return false;
    const fp = await store.getFilePath(id);
    if (it.type === 'image') {
      const img = nativeImage.createFromPath(fp);
      if (img.isEmpty()) return false;
      clipboard.writeImage(img);
    } else {
      clipboard.writeText(fp);
    }
    return true;
  });
  ipcMain.handle('library:reveal', async (_e, id) => {
    const fp = await store.getFilePath(id);
    if (fp) shell.showItemInFolder(fp);
    return !!fp;
  });

  ipcMain.handle('library:export', async (e, arg, format) => {
    const list = ids(arg);
    const win = parentWindow(e);
    const results = [];
    if (!list.length) return results;
    if (list.length === 1) {
      const it = await store.get(list[0]);
      if (!it) return results;
      const fmt = it.type === 'image' ? (format || 'png') : path.extname(it.file).slice(1);
      const ext = fmt === 'jpeg' ? 'jpg' : fmt;
      const r = await dialog.showSaveDialog(win, {
        title: 'Export',
        defaultPath: path.join(app.getPath('pictures'), sanitizeName(it.name) + '.' + ext),
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      });
      if (r.canceled || !r.filePath) return results;
      results.push(await store.exportTo(it.id, r.filePath, { format: fmt }));
      return results;
    }
    const r = await dialog.showOpenDialog(win, { title: 'Export to folder', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return results;
    const used = new Set();
    for (const id of list) {
      const it = await store.get(id);
      if (!it) continue;
      const ext = it.type === 'image' ? (format === 'jpeg' ? 'jpg' : format || 'png') : path.extname(it.file).slice(1);
      let base = sanitizeName(it.name), n = 1, name = `${base}.${ext}`;
      while (used.has(name.toLowerCase()) || fs.existsSync(path.join(r.filePaths[0], name))) name = `${base} (${n++}).${ext}`;
      used.add(name.toLowerCase());
      results.push(await store.exportTo(id, path.join(r.filePaths[0], name), { format: ext }));
    }
    return results;
  });

  ipcMain.handle('library:import', async (e) => {
    const r = await dialog.showOpenDialog(parentWindow(e), {
      title: 'Import images or videos',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Images & videos', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp', 'gif', 'webm', 'mp4'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (r.canceled) return [];
    return importPaths(r.filePaths);
  });
  ipcMain.handle('library:importPaths', async (_e, files) => importPaths(ids(files)));

  ipcMain.handle('library:openEditor', async (_e, id) => {
    const it = await store.get(id);
    if (!it || it.type !== 'image') return false;
    require('./windows').openEditor(id);
    return true;
  });
  ipcMain.handle('library:open-settings', () => {
    require('./windows').openSettings();
    return true;
  });

  ipcMain.on('library:startDrag', async (e, arg) => {
    try {
      const list = ids(arg);
      const files = [];
      for (const id of list) {
        const fp = await store.getFilePath(id);
        if (fp) files.push(fp);
      }
      if (!files.length) return;
      let icon = nativeImage.createEmpty();
      const tp = await store.getThumbPath(list[0]);
      if (tp) icon = nativeImage.createFromPath(tp);
      if (icon.isEmpty()) icon = nativeImage.createFromBitmap(Buffer.alloc(32 * 32 * 4, 128), { width: 32, height: 32 });
      else icon = icon.resize({ width: 96 });
      e.sender.startDrag({ file: files[0], files, icon });
    } catch (err) {
      console.error('[library] startDrag failed', err);
    }
  });
}

module.exports = { register, registerProtocolScheme, importPaths };
