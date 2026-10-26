'use strict';
const path = require('path');
const { BrowserWindow, ipcMain } = require('electron');
const { keepTransparent } = require('./transparent');

const BAR_HTML = path.join(__dirname, '..', 'renderer', 'scrollbar', 'index.html');
const BAR_PRELOAD = path.join(__dirname, '..', 'preload', 'scrollbar.js');
const FRAME_HTML =
  'data:text/html;charset=utf-8,' +
  encodeURIComponent(
    '<html><body style="margin:0;background:transparent;overflow:hidden">' +
      '<div style="position:fixed;inset:0;box-sizing:border-box;border:3px solid #4f8cff;border-radius:2px"></div></body></html>'
  );
const BAR_W = 460;
const BAR_H = 104;
const FRAME_PAD = 3;

function floating(opts) {
  const win = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    ...opts,
  });
  keepTransparent(win);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setMenuBarVisibility(false);
  // Keeps the helper windows out of the captured frames (Windows 10 2004+).
  win.setContentProtection(true);
  return win;
}

function createHelpers() {
  const frame = floating({ webPreferences: { sandbox: true, contextIsolation: true } });
  frame.setIgnoreMouseEvents(true);
  frame.loadURL(FRAME_HTML).catch(() => {});
  const bar = floating({
    width: BAR_W,
    height: BAR_H,
    webPreferences: { preload: BAR_PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  const loaded = new Promise((resolve) => bar.webContents.once('did-finish-load', resolve));
  bar.loadFile(BAR_HTML).catch(() => {});
  return { frame, bar, loaded };
}

/**
 * Floating helpers for scrolling capture: a click-through border around the capture area and a small control bar.
 * The control bar window never takes focus, so the application being scrolled keeps receiving the wheel/keys.
 * Both windows are created when the capture starts (so they load while the user picks the area) and shown with present().
 */
class ScrollUI {
  constructor(onAction) {
    this.onAction = onAction;
    this.closed = false;
    this.pending = null;
    const set = createHelpers();
    this.frame = set.frame;
    this.bar = set.bar;
    this.barId = this.bar.webContents.id;
    this.loaded = set.loaded;
    this.onIpc = (e, name) => {
      if (e.sender.id === this.barId && !this.closed) this.onAction(String(name));
    };
    ipcMain.on('scrollbar:action', this.onIpc);
  }

  // rect: capture area in global DIP coordinates { x, y, w, h }; displayBounds: DIP bounds of its display.
  async present(rect, displayBounds) {
    await Promise.race([this.loaded, new Promise((r) => setTimeout(r, 10000).unref())]);
    if (this.closed) return;
    const x = Math.round(rect.x);
    const y = Math.round(rect.y);
    const w = Math.round(rect.w);
    const h = Math.round(rect.h);
    this.frame.setBounds({ x: x - FRAME_PAD, y: y - FRAME_PAD, width: w + FRAME_PAD * 2, height: h + FRAME_PAD * 2 });
    this.frame.showInactive();

    const d = displayBounds;
    let by = y + h + 12;
    if (by + BAR_H > d.y + d.height) by = y - BAR_H - 12;
    if (by < d.y) by = Math.min(y + h - BAR_H - 8, d.y + d.height - BAR_H); // no room outside: sit inside the area
    let bx = Math.round(x + w / 2 - BAR_W / 2);
    bx = Math.max(d.x, Math.min(bx, d.x + d.width - BAR_W));
    this.bar.setBounds({ x: bx, y: Math.max(d.y, Math.round(by)), width: BAR_W, height: BAR_H });
    this.bar.showInactive();
    this.bar.setAlwaysOnTop(true, 'screen-saver');
    if (this.pending) this.setStatus(this.pending);
  }

  setStatus(status) {
    this.pending = status;
    if (this.closed || this.bar.isDestroyed() || this.bar.webContents.isLoading()) return;
    this.bar.webContents.send('scrollbar:status', status);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    ipcMain.removeListener('scrollbar:action', this.onIpc);
    for (const win of [this.frame, this.bar]) {
      try { if (!win.isDestroyed()) { win.hide(); win.destroy(); } } catch {}
    }
  }
}

module.exports = { ScrollUI };
