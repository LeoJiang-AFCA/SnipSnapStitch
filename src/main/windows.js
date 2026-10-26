const path = require('path');
const { BrowserWindow } = require('electron');

const root = path.join(__dirname, '..');
const ICON = path.join(root, '..', 'assets', 'icon.ico');
const wins = { library: null, settings: null };
const editors = new Map();

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

function openEditor(id) {
  const existing = editors.get(id);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return existing;
  }
  const win = new BrowserWindow(baseOptions('editor.js', { width: 1280, height: 820, minWidth: 800, minHeight: 520, title: 'SnipSnapStitch Editor' }));
  win.loadFile(path.join(root, 'renderer', 'editor', 'index.html'), { query: { id } });
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });
  win.on('closed', () => editors.delete(id));
  editors.set(id, win);
  return win;
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

module.exports = { openLibrary, openSettings, openEditor, openRecorder, getMainWindow, getEditor };
