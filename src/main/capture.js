'use strict';
const path = require('path');
const { app, BrowserWindow, desktopCapturer, screen, ipcMain, clipboard, nativeImage, globalShortcut, dialog } = require('electron');
const util = require('./capture-util');
const winbounds = require('./winbounds');

// Scroll-capture helpers are loaded on first use, so a plain region snip never pays for them.
const getScrollUI = () => require('./scroll-ui').ScrollUI;
const getFrameStream = () => require('./frame-stream').FrameStream;

// Collaborating modules are required lazily so load order in main.js does not matter.
const getStore = () => require('./store');
const getSettings = () => require('./settings');
const getWindows = () => require('./windows');

const OVERLAY_HTML = path.join(__dirname, '..', 'renderer', 'overlay', 'index.html');
const OVERLAY_PRELOAD = path.join(__dirname, '..', 'preload', 'overlay.js');

const SESSION_TIMEOUT_MS = 10 * 60 * 1000;
const READY_TIMEOUT_MS = 20000;
const SCROLL_MAX_HEIGHT = 20000; // physical px
const MIN_ZONE_ROWS = 24; // smallest scrolling part (physical px) that can be tracked

let busy = false;
let activeSelect = null; // { finish(result) } while an overlay selection is running
const overlayInfo = new Map(); // webContents.id -> { win, init, index, ready(), countdown }

function setting(key, fallback) {
  try {
    const v = getSettings().get(key);
    return v === undefined || v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

// ---- session: owns every window/shortcut/listener created for one capture so cleanup is always complete --------

class Session {
  constructor() {
    this.cancelled = false;
    this.disposed = false;
    this.handlers = new Set();
    this.overlays = [];
    this.hidden = [];
    this.escRegistered = false;
    this.timer = null;
    this.onDisplayChange = () => this.cancel();
  }

  start() {
    try { this.escRegistered = globalShortcut.register('Escape', () => this.cancel()); } catch { this.escRegistered = false; }
    screen.on('display-removed', this.onDisplayChange);
    screen.on('display-added', this.onDisplayChange);
    this.timer = setTimeout(() => this.cancel(), SESSION_TIMEOUT_MS);
  }

  cancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    for (const h of [...this.handlers]) {
      try { h(); } catch {}
    }
  }

  onCancel(fn) {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  sleep(ms) {
    return new Promise((resolve) => {
      if (this.cancelled) return resolve();
      const off = this.onCancel(done);
      const t = setTimeout(done, ms);
      function done() {
        clearTimeout(t);
        off();
        resolve();
      }
    });
  }

  hideAppWindows() {
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        if (win.isDestroyed() || overlayInfo.has(win.webContents.id)) continue;
        if (!win.isVisible() || win.isMinimized()) continue;
        win.hide();
        this.hidden.push(win);
      } catch {}
    }
  }

  restoreAppWindows() {
    const list = this.hidden;
    this.hidden = [];
    for (const win of list) {
      try { if (!win.isDestroyed()) win.showInactive(); } catch {}
    }
  }

  closeOverlays() {
    const list = this.overlays;
    this.overlays = [];
    for (const win of list) {
      try {
        const info = overlayInfo.get(win.webContents.id);
        if (info) info.closing = true;
      } catch {}
      try { if (!win.isDestroyed()) { win.hide(); win.destroy(); } } catch {}
    }
  }

  release() {
    this.closeOverlays();
    this.restoreAppWindows();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.timer);
    this.handlers.clear();
    this.release();
    screen.removeListener('display-removed', this.onDisplayChange);
    screen.removeListener('display-added', this.onDisplayChange);
    if (this.escRegistered) {
      try { globalShortcut.unregister('Escape'); } catch {}
      this.escRegistered = false;
    }
  }
}

async function withSession(fn) {
  if (busy || !app.isReady()) return null;
  busy = true;
  const session = new Session();
  try {
    session.start();
    return await fn(session);
  } catch (err) {
    console.error('[capture] failed:', err);
    return null;
  } finally {
    session.dispose();
    activeSelect = null;
    busy = false;
    refillPool(1500);
  }
}

// ---- screen grabbing --------------------------------------------------------------------------------------------

function physicalSize(display) {
  try {
    if (process.platform === 'win32') {
      const r = screen.dipToScreenRect(null, display.bounds);
      if (r && r.width > 0 && r.height > 0) return { w: r.width, h: r.height };
    }
  } catch {}
  return { w: Math.round(display.bounds.width * display.scaleFactor), h: Math.round(display.bounds.height * display.scaleFactor) };
}

function physicalOrigin(display) {
  try {
    if (process.platform === 'win32') {
      const p = screen.dipToScreenPoint({ x: display.bounds.x, y: display.bounds.y });
      return { x: Math.round(p.x), y: Math.round(p.y) };
    }
  } catch {}
  return { x: Math.round(display.bounds.x * display.scaleFactor), y: Math.round(display.bounds.y * display.scaleFactor) };
}

async function grabDisplay(display, withCursor) {
  const displays = screen.getAllDisplays();
  const size = physicalSize(display);
  let source = null;
  for (let attempt = 0; attempt < 3 && !source; attempt++) {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: size.w, height: size.h },
      fetchWindowIcons: false,
    });
    let s = sources.find((x) => String(x.display_id) === String(display.id));
    if (!s && displays.length === 1) s = sources[0];
    if (!s) s = sources[displays.findIndex((d) => d.id === display.id)];
    if (s && s.thumbnail && !s.thumbnail.isEmpty()) source = s;
    else await new Promise((r) => setTimeout(r, 150));
  }
  if (!source) throw new Error('screen capture returned no image for display ' + display.id);

  let image = source.thumbnail;
  const { width, height } = image.getSize();
  const bitmap = image.toBitmap();
  const sx = width / display.bounds.width;
  if (withCursor) {
    const c = screen.getCursorScreenPoint();
    const b = display.bounds;
    if (util.pointInRect(c, b)) {
      util.drawCursorArrow({ data: bitmap, width, height }, (c.x - b.x) * sx, (c.y - b.y) * (height / b.height), sx);
      image = nativeImage.createFromBitmap(bitmap, { width, height });
    }
  }
  return { display, image, bitmap, width, height, scale: sx };
}

async function grabAll(withCursor) {
  const displays = screen.getAllDisplays();
  const shots = [];
  for (const d of displays) shots.push(await grabDisplay(d, withCursor));
  return shots;
}

async function gatherWindows(shots) {
  if (!winbounds.available) return shots.map(() => []);
  let list = [];
  try {
    list = await Promise.race([
      winbounds.listWindows({ excludePid: process.pid }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('window enumeration timed out')), 10000).unref()),
    ]);
  } catch (err) {
    console.warn('[capture] window enumeration unavailable:', err.message);
    return shots.map(() => []);
  }
  const dipRects = [];
  for (const w of list) {
    if (w.title === 'Program Manager') continue;
    let r = { x: w.x, y: w.y, width: w.w, height: w.h };
    try { r = screen.screenToDipRect(null, r); } catch {}
    dipRects.push({ x: r.x, y: r.y, w: r.width, h: r.height, title: w.title });
  }
  return shots.map((shot) => {
    const out = [];
    for (const r of dipRects) {
      const i = util.intersectRect(r, { x: shot.display.bounds.x, y: shot.display.bounds.y, w: shot.display.bounds.width, h: shot.display.bounds.height });
      if (i.w < 4 || i.h < 4) continue;
      const l = util.toLocalRect(i, shot.display.bounds);
      out.push({ x: l.x, y: l.y, w: l.w, h: l.h, title: r.title });
    }
    return out;
  });
}

// ---- overlay windows -------------------------------------------------------------------------------------------

// Renderer start-up is slow on some machines (1-7s), so hidden, already-loaded overlay windows are kept in a pool
// and handed out on demand; each window is single-use and replaced afterwards.
const pool = [];

function spawnOverlay() {
  const b = screen.getPrimaryDisplay().bounds;
  const win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    enableLargerThanScreen: true,
    webPreferences: {
      preload: OVERLAY_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  const id = win.webContents.id;
  const info = { win, session: null, countdown: false, closing: false, loaded: null, ready: null, readyPromise: null };
  info.loadedPromise = new Promise((r) => { info.loaded = r; });
  overlayInfo.set(id, info);

  win.setMenuBarVisibility(false);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.on('closed', () => {
    overlayInfo.delete(id);
    const i = pool.indexOf(info);
    if (i >= 0) pool.splice(i, 1);
    if (!info.closing && info.session && !info.countdown && !info.session.disposed) info.session.cancel();
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' && info.session) info.session.cancel();
  });
  win.webContents.on('render-process-gone', () => {
    if (info.session) info.session.cancel();
    else if (!win.isDestroyed()) win.destroy();
  });
  win.webContents.on('did-fail-load', () => {
    if (info.session) info.session.cancel();
    else if (!win.isDestroyed()) win.destroy();
  });
  win.loadFile(OVERLAY_HTML).catch(() => {});
  return info;
}

function createOverlayWindow(session, display, init, opts = {}) {
  const info = pool.pop() || spawnOverlay();
  const win = info.win;
  info.session = session;
  info.countdown = !!opts.countdown;
  info.readyPromise = new Promise((r) => { info.ready = r; });
  session.overlays.push(win);
  const b = display.bounds;
  win.setBounds(b);
  win.setBounds(b); // second call corrects bounds on mixed-DPI setups
  info.loadedPromise.then(() => {
    if (!win.isDestroyed()) win.webContents.send('overlay:init', init);
  });
  return info;
}

let warming = false;
let warmTimer = null;

// Spawns the reserve overlay windows one at a time (each start-up is slow and they would otherwise compete with the
// window the user is waiting for). Only the region-capture overlays are kept warm; scroll-capture helpers are started on demand.
async function warmUp() {
  if (warming || busy) return;
  warming = true;
  try {
    const want = Math.min(4, screen.getAllDisplays().length);
    while (!busy && pool.length < want) {
      try {
        const info = spawnOverlay();
        pool.push(info);
        await Promise.race([info.loadedPromise, new Promise((r) => setTimeout(r, 6000).unref())]);
      } catch (err) { console.error('[capture] overlay pool:', err); break; }
    }
  } finally {
    warming = false;
  }
}

function refillPool(delay = 0) {
  clearTimeout(warmTimer);
  warmTimer = setTimeout(() => { warmUp().catch(() => {}); }, delay);
  warmTimer.unref();
}

async function waitReady(session, infos) {
  const timeout = new Promise((r) => setTimeout(() => r(false), READY_TIMEOUT_MS).unref());
  const all = Promise.all(infos.map((i) => i.readyPromise)).then(() => true);
  const ok = await Promise.race([all, timeout]);
  return ok && !session.cancelled;
}

function nearestDisplay() {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

async function showCountdown(session, seconds) {
  const display = nearestDisplay();
  const info = createOverlayWindow(session, display, { mode: 'countdown', value: seconds }, { countdown: true });
  if (!(await waitReady(session, [info]))) return;
  const win = info.win;
  win.setIgnoreMouseEvents(true);
  win.showInactive();
  for (let n = seconds; n >= 1 && !session.cancelled; n--) {
    if (n !== seconds && !win.isDestroyed()) win.webContents.send('overlay:countdown', n);
    await session.sleep(1000);
  }
  session.closeOverlays();
  await session.sleep(200);
}

// Hides the app's own windows, then waits out the configured delay (with an on-screen countdown).
async function prepare(session, useDelay = true) {
  session.hideAppWindows();
  await session.sleep(session.hidden.length ? 220 : 60);
  const secs = useDelay ? Math.max(0, Math.min(60, Math.round(Number(setting('delaySeconds', 0)) || 0))) : 0;
  if (secs > 0 && !session.cancelled) await showCountdown(session, secs);
  return !session.cancelled;
}

const HINTS = {
  region: 'Drag to select an area \u00b7 adjust with handles \u00b7 Enter / double-click to capture \u00b7 Esc to cancel',
  snip: 'Drag to select an area \u00b7 release to capture and copy it \u00b7 Esc to cancel',
  window: 'Click a window to capture it, or drag to select an area \u00b7 Esc to cancel',
  scrolling: 'Select the area to scroll-capture, then press Enter \u00b7 you then scroll yourself or use Auto-scroll \u00b7 Esc to cancel',
};

// Arms the overlay selection: resolves with what overlay:confirm / overlay:switch report, or null on cancel.
function armSelect(session) {
  if (session.cancelled) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      activeSelect = null;
      resolve(v);
    };
    activeSelect = { session, finish };
    session.onCancel(() => finish(null));
  });
}

// Shows one overlay per display and resolves { shot, rect } (rect in CSS px of that display) or null on cancel.
// opts.instant: the selection is taken as soon as the mouse is released (no adjust/confirm step).
// opts.modes: show the mode bar (Snip Area); picking another mode there resolves { shot, switchTo } instead.
async function selectArea(session, kind, shots, opts = {}) {
  const windowLists = kind === 'window' ? await gatherWindows(shots) : shots.map(() => []);
  if (session.cancelled) return null;
  const target = nearestDisplay();
  const picked = armSelect(session);
  const infos = shots.map((shot, index) => {
    const origin = physicalOrigin(shot.display);
    const init = {
      mode: 'select',
      kind,
      bitmap: shot.bitmap,
      width: shot.width,
      height: shot.height,
      originX: origin.x,
      originY: origin.y,
      windows: windowLists[index],
      instant: !!opts.instant,
      modes: !!opts.modes,
      hint: opts.instant ? HINTS.snip : HINTS[kind] || HINTS.region,
    };
    const info = createOverlayWindow(session, shot.display, init);
    info.index = index;
    info.shot = shot;
    info.modes = !!opts.modes;
    return info;
  });
  waitReady(session, infos).then((ok) => {
    if (!ok) return session.cancel();
    let focusWin = null;
    for (const info of infos) {
      if (info.shot.display.id === target.id) focusWin = info.win;
      else info.win.showInactive();
    }
    const w = focusWin || infos[0].win;
    w.show();
    w.focus();
  });
  return picked;
}

// Turns the open overlays into another kind of selection in place (same screenshot, no new windows): used when
// Scroll Capture is picked on the Snip Area mode bar.
function reselect(session, kind) {
  const picked = armSelect(session);
  for (const win of session.overlays) {
    try {
      if (win.isDestroyed()) continue;
      const info = overlayInfo.get(win.webContents.id);
      if (info) info.modes = false;
      win.webContents.send('overlay:mode', { kind, hint: HINTS[kind] || HINTS.region });
    } catch {}
  }
  return picked;
}

const SWITCH_MODES = new Set(['scrolling', 'record', 'fullscreen']);

function registerOverlayIpc() {
  for (const ch of ['overlay:loaded', 'overlay:ready', 'overlay:activate', 'overlay:confirm', 'overlay:cancel', 'overlay:switch']) ipcMain.removeAllListeners(ch);
  ipcMain.on('overlay:loaded', (e) => {
    const info = overlayInfo.get(e.sender.id);
    if (info) info.loaded();
  });
  ipcMain.on('overlay:ready', (e) => {
    const info = overlayInfo.get(e.sender.id);
    if (info && info.ready) info.ready();
  });
  ipcMain.on('overlay:activate', (e) => {
    const info = overlayInfo.get(e.sender.id);
    try {
      if (info && !info.countdown && !info.win.isDestroyed() && info.win.isVisible() && !info.win.isFocused()) info.win.focus();
    } catch {}
  });
  ipcMain.on('overlay:confirm', (e, rect) => {
    const info = overlayInfo.get(e.sender.id);
    if (!info || !activeSelect || info.countdown) return;
    if (!rect || ![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) return;
    activeSelect.finish({ shot: info.shot, rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } });
  });
  ipcMain.on('overlay:cancel', (e) => {
    if (overlayInfo.has(e.sender.id) && activeSelect) activeSelect.session.cancel();
  });
  ipcMain.on('overlay:switch', (e, mode) => {
    const info = overlayInfo.get(e.sender.id);
    if (!info || !activeSelect || info.countdown || !info.modes || !SWITCH_MODES.has(mode)) return;
    activeSelect.finish({ shot: info.shot, switchTo: mode });
  });
}

// ---- finishing ---------------------------------------------------------------------------------------------------

// opts.copy: always put the image on the clipboard (Snip Area), whatever the settings say.
async function finalize(png, source, opts = {}) {
  const item = await getStore().addCapture(png, { source });
  const after = setting('afterCapture', 'editor');
  if (opts.copy || setting('copyToClipboard', false) || after === 'clipboard') {
    try { clipboard.writeImage(nativeImage.createFromBuffer(png)); } catch (err) { console.error('[capture] clipboard failed:', err); }
  }
  try {
    if (after === 'editor') getWindows().openEditor(item.id);
    else if (after === 'library') getWindows().openLibrary();
  } catch (err) {
    console.error('[capture] opening window failed:', err);
  }
  return item;
}

function physicalRectOf(sel) {
  const b = sel.shot.display.bounds;
  return util.cssRectToPhysical(sel.rect, { w: b.width, h: b.height }, { w: sel.shot.width, h: sel.shot.height });
}

// ---- public capture functions ------------------------------------------------------------------------------------

async function captureArea(kind) {
  // Snip Area works like the Windows Snipping Tool: releasing the mouse captures and the snip goes to the clipboard.
  // Its overlay also has a mode bar to switch to Scroll Capture, Record Video or Full Screen instead.
  const snip = kind === 'region';
  let startRecording = false;
  const item = await withSession(async (session) => {
    if (!(await prepare(session))) return null;
    const shots = await grabAll(!!setting('captureCursor', false));
    const sel = await selectArea(session, kind, shots, { instant: snip, modes: snip });
    if (!sel) return null;
    if (sel.switchTo === 'scrolling') {
      return scrollCapture(session, (warm) => { warm(); return reselect(session, 'scrolling'); });
    }
    session.release();
    // Full Screen uses the screenshot already taken of that display.
    if (sel.switchTo === 'fullscreen') return finalize(sel.shot.image.toPNG(), 'fullscreen', { copy: true });
    if (sel.switchTo === 'record') { startRecording = true; return null; }
    const r = physicalRectOf(sel);
    const png = sel.shot.image.crop({ x: r.x, y: r.y, width: r.w, height: r.h }).toPNG();
    return finalize(png, kind, { copy: snip });
  });
  // The recorder runs its own capture session, so it starts once this one has ended.
  if (startRecording) {
    try { await require('./recorder').startRecording({}); } catch (err) { console.error('[capture] recorder failed:', err); }
  }
  return item;
}

const captureRegion = () => captureArea('region');
const captureWindow = () => captureArea('window');

function captureFullscreen() {
  return withSession(async (session) => {
    if (!(await prepare(session))) return null;
    const shot = await grabDisplay(nearestDisplay(), !!setting('captureCursor', false));
    if (session.cancelled) return null;
    session.release();
    return finalize(shot.image.toPNG(), 'fullscreen');
  });
}

/**
 * Scrolling capture, driven by the user like Snagit's: select an area, then a control bar appears.
 *  - Manual: scroll the content yourself; every new part that scrolls into the area is appended.
 *  - Auto-scroll (Windows): the app scrolls the content with simulated mouse-wheel input; it can be paused again.
 * Capturing only ends when the user clicks Done / presses Enter (or auto-scroll reaches the end of the content).
 * Esc or Cancel discards everything. Frames are stitched by detecting the overlap between consecutive frames.
 */
function captureScrolling() {
  return withSession(async (session) => {
    if (!(await prepare(session))) return null;
    return scrollCapture(session, async (warm) => {
      const shots = await grabAll(false);
      warm();
      return selectArea(session, 'scrolling', shots);
    });
  });
}

// The scrolling capture inside an open session. pickArea(warm) resolves the selected area like selectArea; it calls
// warm() to start the heavy helpers while the user is still choosing the area.
async function scrollCapture(session, pickArea) {
  let finishRequested = false;
  let wantAuto = false;
  const canAuto = !!winbounds.available;
  const ScrollUI = getScrollUI();
  const FrameStream = getFrameStream();
  const ui = new ScrollUI((action) => {
    if (action === 'done') finishRequested = true;
    else if (action === 'cancel') session.cancel();
    else if (action === 'auto' && canAuto) wantAuto = !wantAuto;
  });
  let enterRegistered = false;
  let savedCursor = null;
  try {
    const sel = await pickArea(() => {
      FrameStream.prewarm().catch(() => {});
      if (winbounds.available) winbounds.warmUp();
    });
    if (!sel || !sel.rect) return null;
    session.closeOverlays(); // keep the app's own windows hidden while scrolling
    session.onCancel(() => ui.close());
    const display = sel.shot.display;
    const rect = physicalRectOf(sel);
    const b = display.bounds;
    await ui.present({ x: b.x + sel.rect.x, y: b.y + sel.rect.y, w: sel.rect.w, h: sel.rect.h }, b);
    if (session.cancelled) return null;
    try { enterRegistered = globalShortcut.register('Enter', () => { finishRequested = true; }); } catch {}

    // Live frames from a screen stream when possible (far quicker than polling thumbnails, so fast scrolling is
    // followed too); otherwise poll desktopCapturer.
    const stream = new FrameStream(display, rect, physicalSize(display));
    const streaming = await stream.start();
    if (session.cancelled) { stream.stop(); return null; }
    // The screen stream draws the mouse pointer into every frame. `box` is where it sits (frame pixels), so the
    // stitcher can replace those rows with clean copies from a neighbouring frame.
    const pxPerDip = physicalSize(display).w / b.width;
    const tagCursor = (f) => {
      if (f && f.box === undefined) {
        f.box = null;
        if (f.cursor) {
          const k = f.width / rect.w;
          const ps = pxPerDip * k;
          const px = ((f.cursor.x - b.x) * pxPerDip - rect.x) * k;
          const py = ((f.cursor.y - b.y) * pxPerDip - rect.y) * k;
          const box = {
            x0: Math.max(0, Math.floor(px - 20 * ps)), x1: Math.min(f.width, Math.ceil(px + 36 * ps)),
            y0: Math.max(0, Math.floor(py - 20 * ps)), y1: Math.min(f.height, Math.ceil(py + 36 * ps)),
          };
          if (box.x1 > box.x0 && box.y1 > box.y0) f.box = box;
        }
      }
      return f;
    };
    const grabFrame = streaming
      ? async () => tagCursor(await stream.next(150))
      : async () => {
        const s = await grabDisplay(display, false);
        const img = s.image.crop({ x: rect.x, y: rect.y, width: rect.w, height: rect.h });
        const size = img.getSize();
        return { data: img.toBitmap(), width: size.width, height: size.height };
      };
    const pollMs = streaming ? 20 : 120;
    const stable = async (frame) => {
      let f = frame || (await grabFrame());
      for (let i = 0; i < 4 && !session.cancelled; i++) {
        await session.sleep(streaming ? 80 : 130);
        const g = await grabFrame();
        if (g === f || g.data.equals(f.data)) return g;
        f = g;
      }
      return f;
    };

    await session.sleep(300);
    let first = await grabFrame();
    if (streaming) first = tagCursor(await stream.next(100)) || first; // skip any frame drawn before the helper windows settled
    const stitcher = new util.ScrollStitcher(first);
    let count = 1;
    let prev = first;
    let total = first.height;
    let zoneH = first.height;
    let hint = Math.round(first.height * 0.3);
    const origin = physicalOrigin(display);
    const cx = origin.x + rect.x + Math.floor(rect.w / 2);
    let cy = origin.y + rect.y + Math.floor(rect.h / 2);
    const status = (msg, level) => ui.setStatus({ mode: wantAuto ? 'auto' : 'manual', frames: count, height: total, canAuto, msg, level });
    const MANUAL_MSG = 'Scroll the content yourself' + (canAuto ? ', or press Auto-scroll' : '') + '. Click Done when finished.';
    const stop = () => session.cancelled || finishRequested;
    status(MANUAL_MSG);

    // Compares `frame` with the last kept frame and, if the content scrolled, keeps it. Rows that did not move
    // (fixed header, status bar, sticky rows) are detected first and left out of the comparison, so only the part
    // that really scrolls is used to measure the offset. Returns the detection result. `lost` stays set while the
    // newest frame could not be joined to the picture, i.e. the content moved on without being captured.
    let lost = false;
    const overlays = []; // measured heights of a scroll bar drawn over the bottom of the content
    let overlay = 0;
    const append = (frame, force) => {
      const r = appendFrame(frame, force);
      if (r.ok || r.identical) lost = false;
      else if (!r.noZone) lost = true;
      return r;
    };
    const appendFrame = (frame, force) => {
      if (util.sameIgnoringBoxes(prev, frame)) return { ok: true, identical: true, dy: 0 };
      const st = util.staticRows(prev, frame);
      if (st.top >= frame.height) return { ok: true, identical: true, dy: 0 };
      let bottom = st.bottom + overlay;
      zoneH = frame.height - st.top - bottom;
      if (zoneH < MIN_ZONE_ROWS) return { ok: false, identical: false, dy: 0, noZone: true };
      const a = util.zoneView(prev, st.top, bottom);
      const b = util.zoneView(frame, st.top, bottom);
      const h0 = Math.min(hint, zoneH - 1);
      // Small steps are by far the most common (and quick to check); only search the whole range if they fail.
      let r = util.detectScrollOffset(a, b, { hint: h0, maxDy: Math.max(48, Math.round(zoneH * 0.3)) });
      if (!r.ok && !r.identical) r = util.detectScrollOffset(a, b, { hint: h0 });
      if (r.ok && !r.identical && r.dy > 0) {
        // Wait until the content has moved a worthwhile distance (the final pass keeps whatever is left). With the
        // pointer in the picture the step must also be taller than the pointer, so it can be painted out.
        const boxH = frame.box ? frame.box.y1 - frame.box.y0 : 0;
        const minStep = Math.min(Math.max(6, zoneH * 0.08, boxH * 1.1), zoneH * 0.4);
        if (!force && r.dy < minStep) return { ...r, deferred: true };
        // A scroll bar floating over the bottom of the text must not be stitched in again and again: treat the rows
        // under it like a footer (it is then shown once, at the end).
        const ov = util.overlayRows(a, b, r.dy);
        if (ov || overlays.length) {
          overlays.push(overlay + (ov ? ov + 2 : 0));
          const m = Math.round(util.median(overlays.slice(-9)));
          overlay = Math.min(m, Math.floor(zoneH * 0.15));
          bottom = st.bottom + overlay;
        }
        stitcher.add(frame, r.dy, bottom, st.top);
        count++;
        total = stitcher.height;
        prev = frame;
        hint = r.dy;
        cy = origin.y + rect.y + st.top + Math.floor(zoneH / 2);
      }
      return r;
    };

    let notches = 2;
    let endStuck = 0;
    let autoFails = 0;
    let autoActive = false;
    const probes = [0.5, 0.8, 0.25];
    let probe = 0;
    let tried = null;
    try {
      while (!stop() && total < SCROLL_MAX_HEIGHT) {
        let frame;
        if (wantAuto) {
          if (!autoActive) {
            savedCursor = await winbounds.getCursor().catch(() => null);
            autoActive = true;
            status('Auto-scrolling\u2026 click Pause or Done to stop.');
          }
          await winbounds.wheel(cx, cy, -120 * notches);
          // Take the pointer out of the picture again; the page keeps scrolling by itself.
          if (savedCursor) await winbounds.moveCursor(savedCursor.x, savedCursor.y).catch(() => {});
          await session.sleep(350);
          if (stop()) break;
          frame = await stable();
        } else {
          if (autoActive) {
            autoActive = false;
            if (savedCursor) await winbounds.moveCursor(savedCursor.x, savedCursor.y).catch(() => {});
            status(MANUAL_MSG);
          }
          await session.sleep(pollMs);
          if (stop()) break;
          frame = await grabFrame();
          if (frame === prev || frame.data.equals(prev.data) || util.sameIgnoringBoxes(prev, frame)) {
            // Back at the last captured position (e.g. after "scroll back up"): nothing is missing any more.
            lost = false;
            continue;
          }
          if (frame === tried) continue;
          tried = frame;
        }
        if (stop()) break;
        const r = append(frame);
        if (r.identical) {
          if (wantAuto) {
            if (++endStuck >= 2) {
              if (count === 1 && ++probe < probes.length) {
                // Nothing moved yet: the pointer may be over a fixed part of the area, so try another spot.
                cy = origin.y + rect.y + Math.floor(rect.h * probes[probe]);
                endStuck = 0;
                continue;
              }
              status('Reached the end of the content.');
              finishRequested = true;
              break;
            }
            await session.sleep(500);
          }
          continue;
        }
        endStuck = 0;
        if (r.noZone) {
          status('Could not find a scrolling part in the selected area.', 'warn');
          if (wantAuto) wantAuto = false;
        } else if (r.ok) {
          autoFails = 0;
          if (wantAuto) notches = util.nextNotches(notches, r.dy, zoneH);
          status(wantAuto ? 'Auto-scrolling\u2026 click Pause or Done to stop.' : MANUAL_MSG);
        } else if (wantAuto) {
          if (++autoFails <= 3) {
            // Scrolled further than the area is tall: go back and take smaller steps.
            await winbounds.wheel(cx, cy, 120 * notches);
            if (savedCursor) await winbounds.moveCursor(savedCursor.x, savedCursor.y).catch(() => {});
            await session.sleep(450);
            notches = Math.max(1, Math.floor(notches / 2));
          } else {
            wantAuto = false;
            status('Auto-scroll lost track of the content \u2014 scroll manually, or click Done.', 'warn');
          }
        } else {
          status('Scrolled too fast, or the content changed. Scroll back up to where the last line captured is visible.', 'warn');
        }
      }
      if (total >= SCROLL_MAX_HEIGHT) status('Maximum capture height reached.', 'warn');
      if (finishRequested && !session.cancelled) {
        // Pick up whatever finished scrolling just before Done was clicked.
        await session.sleep(250);
        // A frame caught mid-animation can fail to join; give the settled picture a couple more tries.
        for (let i = 0; i < 3 && !session.cancelled; i++) {
          const r = append(await stable(), true);
          if (r.ok || r.identical) break;
          await session.sleep(200);
        }
      }
    } catch (err) {
      console.warn('[capture] scrolling stopped:', err.message);
    } finally {
      stream.stop();
      if (savedCursor && autoActive) await winbounds.moveCursor(savedCursor.x, savedCursor.y).catch(() => {});
    }

    if (session.cancelled) return null;
    ui.close();
    session.release();
    // The fixed footer (status bar, panel header...) is kept once, at the end; fixed side columns once, at the top.
    const out = stitcher.finish();
    const png = nativeImage.createFromBitmap(out.data, { width: out.width, height: out.height }).toPNG();
    const item = await finalize(png, 'scrolling');
    const problems = [];
    if (lost) problems.push('The content scrolled past the last captured part before you clicked Done, so the end of the page is missing.');
    if (stitcher.gapRows > 0) problems.push('Some content was scrolled past too quickly and is missing from the image.');
    if (total >= SCROLL_MAX_HEIGHT) problems.push('The maximum capture height was reached, so the rest of the page is not included.');
    if (problems.length) {
      await dialog.showMessageBox({
        type: 'warning',
        title: 'Scrolling capture incomplete',
        message: 'The stitched image is not fully complete because the scrolling jumped over part of the screen.',
        detail: problems.join('\n\n') + '\n\nScroll more slowly and capture again.',
        buttons: ['OK'],
      }).catch(() => {});
    }
    return item;
  } finally {
    if (enterRegistered) { try { globalShortcut.unregister('Enter'); } catch {} }
    ui.close();
    FrameStream.discardSpare(); // an unused pre-warmed host (e.g. cancelled selection) must not linger
  }
}

/**
 * Lets the user pick an area without capturing anything (e.g. for region recording).
 * Resolves { displayId, x, y, width, height } in global DIP coordinates, or null if cancelled.
 * opts.kind: 'region' (default) | 'window'
 */
function pickRegion(opts = {}) {
  return withSession(async (session) => {
    if (!(await prepare(session, !!opts.delay))) return null;
    const shots = await grabAll(false);
    const sel = await selectArea(session, opts.kind === 'window' ? 'window' : 'region', shots);
    if (!sel) return null;
    session.release();
    const b = sel.shot.display.bounds;
    const x = Math.max(0, Math.min(sel.rect.x, b.width));
    const y = Math.max(0, Math.min(sel.rect.y, b.height));
    return {
      displayId: sel.shot.display.id,
      x: Math.round(b.x + x),
      y: Math.round(b.y + y),
      width: Math.max(1, Math.round(Math.min(sel.rect.w, b.width - x))),
      height: Math.max(1, Math.round(Math.min(sel.rect.h, b.height - y))),
    };
  });
}

function register() {
  registerOverlayIpc();
  const channels = {
    'capture:region': captureRegion,
    'capture:fullscreen': captureFullscreen,
    'capture:window': captureWindow,
    'capture:scrolling': captureScrolling,
  };
  for (const [ch, fn] of Object.entries(channels)) {
    ipcMain.removeHandler(ch);
    ipcMain.handle(ch, async () => {
      try { return await fn(); } catch (err) { console.error('[capture]', ch, err); return null; }
    });
  }
  app.once('will-quit', () => {
    winbounds.dispose();
    for (const info of pool.splice(0)) { try { info.win.destroy(); } catch {} }
  });
  refillPool(5000);
}

module.exports = { register, captureRegion, captureFullscreen, captureWindow, captureScrolling, pickRegion };
