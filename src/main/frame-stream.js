'use strict';
const path = require('path');
const { BrowserWindow, desktopCapturer, ipcMain, screen } = require('electron');

const PRELOAD = path.join(__dirname, '..', 'preload', 'framestream.js');
const PAGE = path.join(__dirname, '..', 'renderer', 'framestream', 'index.html');

function createHost() {
  const win = new BrowserWindow({
    show: false,
    width: 200,
    height: 200,
    // A separate storage partition keeps the capture loop in its own renderer process even with process-per-site.
    webPreferences: { preload: PRELOAD, contextIsolation: false, sandbox: false, nodeIntegration: false, backgroundThrottling: false, partition: 'sss-framestream' },
  });
  return { win, loaded: win.loadFile(PAGE) };
}

// A ready, hidden host window (a renderer takes about a second to start on some machines).
let spare = null;

/**
 * Live frames of a rectangle of one display (~30 fps), taken from a screen video stream in a hidden window.
 * Polling desktopCapturer thumbnails takes ~400 ms per frame, which is too slow to follow a quick scroll.
 * Frames are BGRA buffers { data, width, height, seq } like nativeImage bitmaps.
 */
class FrameStream {
  // rect: { x, y, w, h } in physical pixels of the display; size: { w, h } physical size of the display.
  constructor(display, rect, size) {
    this.display = display;
    this.rect = rect;
    this.size = size;
    this.frame = null;
    this.seq = 0;
    this.taken = 0;
    this.waiters = [];
    this.error = null;
    this.win = null;
  }

  // Creates the reserve host window (resolves once it has loaded).
  static async prewarm() {
    if (spare) return;
    const host = createHost();
    spare = host;
    try { await host.loaded; } catch { if (spare === host) spare = null; }
  }

  async start(timeoutMs = 5000) {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 }, fetchWindowIcons: false });
      const all = require('electron').screen.getAllDisplays();
      let src = sources.find((s) => String(s.display_id) === String(this.display.id));
      if (!src && all.length === 1) src = sources[0];
      if (!src) src = sources[all.findIndex((d) => d.id === this.display.id)];
      if (!src) throw new Error('no screen source');

      let host = spare;
      spare = null;
      if (host && host.win.isDestroyed()) host = null;
      host = host || createHost();
      this.win = host.win;
      const id = this.win.webContents.id;
      this.onFrame = (e, f) => {
        if (e.sender.id !== id) return;
        e.sender.send('framestream:ack');
        const data = Buffer.from(f.data.buffer || f.data, f.data.byteOffset || 0, f.data.byteLength);
        // The pointer is drawn into the video; where it was lets the stitcher paint it out again.
        this.frame = { data, width: f.width, height: f.height, seq: ++this.seq, cursor: screen.getCursorScreenPoint() };
        const ws = this.waiters.splice(0);
        for (const w of ws) w();
      };
      this.onError = (e, msg) => {
        if (e.sender.id !== id) return;
        this.error = String(msg);
        for (const w of this.waiters.splice(0)) w();
      };
      ipcMain.on('framestream:frame', this.onFrame);
      ipcMain.on('framestream:error', this.onError);
      await host.loaded;
      this.win.webContents.send('framestream:start', { sourceId: src.id, rect: this.rect, size: this.size });
      await this.next(timeoutMs);
      if (!this.frame || this.error) throw new Error(this.error || 'no frames from the screen stream');
      return true;
    } catch (err) {
      console.warn('[capture] screen stream unavailable:', err.message);
      this.stop();
      return false;
    }
  }

  // Resolves with the newest frame not handed out yet; after `waitMs` without a new one, with the current frame.
  async next(waitMs = 150) {
    if (!this.frame || this.frame.seq === this.taken) {
      await new Promise((resolve) => {
        const t = setTimeout(done, waitMs);
        const self = this;
        function done() {
          clearTimeout(t);
          const i = self.waiters.indexOf(done);
          if (i >= 0) self.waiters.splice(i, 1);
          resolve();
        }
        this.waiters.push(done);
      });
    }
    if (this.frame) this.taken = this.frame.seq;
    return this.frame;
  }

  stop() {
    if (this.onFrame) ipcMain.removeListener('framestream:frame', this.onFrame);
    if (this.onError) ipcMain.removeListener('framestream:error', this.onError);
    this.onFrame = this.onError = null;
    for (const w of this.waiters.splice(0)) w();
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}

module.exports = { FrameStream };
