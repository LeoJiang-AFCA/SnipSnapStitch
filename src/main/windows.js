const path = require('path');
const { BrowserWindow } = require('electron');
const perf = require('./perf');

const root = path.join(__dirname, '..');
const ICON = path.join(root, '..', 'assets', 'icon.ico');
const EDITOR_HTML = path.join(root, 'renderer', 'editor', 'index.html');
const wins = { library: null, settings: null };
const editors = new Map();
const SPARE_SHOW_TIMEOUT_MS = 1500;

function baseOptions(preload, extra = {}) {
  return {
    backgroundColor: '#1b1d22',
    icon: ICON,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(root, 'preload', preload),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    ...extra,
  };
}

function focusOrCreate(key, create) {
  const existing = wins[key];
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return existing;
  }
  const win = create();
  wins[key] = win;
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    if (wins[key] === win) wins[key] = null;
  });
  return win;
}

function openLibrary() {
  return focusOrCreate('library', () => {
    const win = new BrowserWindow(baseOptions('library.js', { width: 1200, height: 780, minWidth: 760, minHeight: 480, title: 'SnipSnapStitch' }));
    win.loadFile(path.join(root, 'renderer', 'library', 'index.html'));
    return win;
  });
}

function openSettings() {
  return focusOrCreate('settings', () => {
    const win = new BrowserWindow(baseOptions('settings.js', { width: 560, height: 700, resizable: false, minimizable: false, title: 'SnipSnapStitch Settings' }));
    win.loadFile(path.join(root, 'renderer', 'settings', 'index.html'));
    return win;
  });
}

function editorWindow() {
  return new BrowserWindow(baseOptions('editor.js', { width: 1280, height: 820, minWidth: 800, minHeight: 520, title: 'SnipSnapStitch Editor' }));
}

function revealEditor(win) {
  if (win.isDestroyed() || win.isVisible()) return;
  win.show();
  win.focus();
  perf.step('editor on screen');
}

// A hidden, fully loaded editor is kept in reserve (like the capture overlays), so opening a capture only has to send
// it the item id: no window creation or page load while the user waits. Each spare is used once and then replaced.
let spare = null; // { win, loaded }
let spareTimer = null;
let spareMarked = false;

function prewarmEditor(delay = 0) {
  clearTimeout(spareTimer);
  spareTimer = setTimeout(() => {
    if (spare) return;
    const win = editorWindow();
    const s = { win, loaded: false };
    spare = s;
    // Hidden pages are throttled; the spare must react at full speed when it is handed an item.
    win.webContents.setBackgroundThrottling(false);
    win.webContents.once('did-finish-load', () => {
      s.loaded = true;
      if (!spareMarked) { spareMarked = true; perf.mark('spare editor pre-loaded'); }
    });
    const drop = () => { if (spare === s) spare = null; };
    win.on('closed', drop);
    win.webContents.on('render-process-gone', () => { drop(); if (!win.isDestroyed()) win.destroy(); });
    win.loadFile(EDITOR_HTML).catch(() => {});
  }, delay);
  spareTimer.unref();
}

function takeSpare() {
  const s = spare;
  if (!s || !s.loaded || s.win.isDestroyed()) return null;
  spare = null;
  return s.win;
}

function openEditor(id) {
  const existing = editors.get(id);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return existing;
  }
  let win = takeSpare();
  if (win) {
    win.webContents.send('editor:open', id);
    // Shown once the editor reports the image is loaded (editorReady), so it never flashes "Loading…".
    const t = setTimeout(() => revealEditor(win), SPARE_SHOW_TIMEOUT_MS);
    win.once('show', () => {
      clearTimeout(t);
      if (!win.isDestroyed()) win.webContents.setBackgroundThrottling(true);
    });
  } else {
    win = editorWindow();
    win.loadFile(EDITOR_HTML, { query: { id } });
    win.once('ready-to-show', () => revealEditor(win));
  }
  win.on('closed', () => { if (editors.get(id) === win) editors.delete(id); });
  editors.set(id, win);
  prewarmEditor(3000);
  return win;
}

// The editor page has its item loaded and drawn.
function editorReady(win) {
  if (!win || win.isDestroyed()) return;
  perf.step('editor content ready');
  revealEditor(win);
}

function openRecorder(opts) {
  return require('./recorder').startRecording(opts || {});
}

function getMainWindow() {
  return wins.library && !wins.library.isDestroyed() ? wins.library : null;
}

// The editor window showing item `id`, if one is open.
function getEditor(id) {
  const win = editors.get(id);
  return win && !win.isDestroyed() ? win : null;
}

module.exports = { openLibrary, openSettings, openEditor, openRecorder, getMainWindow, getEditor, prewarmEditor, editorReady };
