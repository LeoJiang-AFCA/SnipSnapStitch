'use strict';
/**
 * Video capture for SnipSnapStitch.
 *
 * Flow: setup HUD -> (region overlay) -> countdown -> hidden capture worker records
 * via getDisplayMedia + MediaRecorder -> floating control bar (excluded from capture) ->
 * stop: store.addMedia(webm) + windows.openLibrary().
 *
 * IPC (public): recorder:start, recorder:stop, recorder:pause, recorder:state,
 *               recorder:export-gif {id}, recorder:convert-gif-from-file {path}
 * IPC (internal, also `recorder:`): setup-*, list-windows, region-result, bar-action,
 *               cancel, finished, ended, failed, gif-result, gif-progress.
 */
const { app, BrowserWindow, ipcMain, screen, desktopCapturer, session, powerSaveBlocker, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');

const HTML = path.join(__dirname, '..', 'renderer', 'recorder', 'index.html');
const PRELOAD = path.join(__dirname, '..', 'preload', 'recorder.js');
const PARTITION = 'recorder-capture';
const BAR_W = 300;
const BAR_H = 58;

const events = new EventEmitter();
const deps = {}; // optional overrides (tests): { store, windows }
const getStore = () => deps.store || require('./store');
const getWindows = () => deps.windows || require('./windows');

const state = {
  status: 'idle', // idle | setup | preparing | countdown | recording | paused | saving
  opts: null,
  region: null,
  display: null,
  accumulated: 0,
  resumedAt: 0,
  micActive: false,
  info: null,
};
const win = { setup: null, bar: null, worker: null, countdown: null, border: null, halo: null, regions: [] };
let workerReady = null;
let sessionToken = 0;
let captureTarget = null;
let regionResolve = null;
let haloTimer = null;
let powerBlocker = null;
let lastItem = null;
let handlersInstalled = false;
let jobSeq = 0;
const gifJobs = new Map();
let activeJobs = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (w) => w && !w.isDestroyed();

/* ---------- preferences ---------- */

const prefs = require('./recorder-prefs');
const { normalize } = prefs;

const prefsFile = () => path.join(app.getPath('userData'), 'recorder-prefs.json');
const loadPrefs = () => prefs.load(prefsFile());
const savePrefs = (o) => prefs.save(prefsFile(), o);

/* ---------- state ---------- */

function elapsedMs() {
  return state.accumulated + (state.status === 'recording' ? Date.now() - state.resumedAt : 0);
}

function getState() {
  return {
    status: state.status,
    recording: state.status === 'recording' || state.status === 'paused',
    paused: state.status === 'paused',
    mode: state.opts ? state.opts.mode : null,
    fps: state.opts ? state.opts.fps : null,
    elapsedMs: elapsedMs(),
    micRequested: !!(state.opts && state.opts.mic),
    micActive: state.micActive,
    systemAudio: !!(state.info && state.info.systemAudio),
    width: state.info ? state.info.width : null,
    height: state.info ? state.info.height : null,
  };
}

function publish() {
  const snap = getState();
  if (alive(win.bar)) win.bar.webContents.send('recorder:state', snap);
  events.emit('state', snap);
  return snap;
}

function notifyError(message) {
  console.error('[recorder]', message);
  events.emit('error', new Error(message));
  try {
    if (Notification.isSupported()) new Notification({ title: 'SnipSnapStitch recorder', body: message }).show();
  } catch (e) { /* ignore */ }
}

/* ---------- windows ---------- */

function makeWindow(view, opts, query) {
  const w = new BrowserWindow(Object.assign({
    show: false,
    frame: false,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  }, opts));
  w.setMenuBarVisibility(false);
  const loaded = w.loadFile(HTML, { query: Object.assign({ view }, query || {}) });
  return { w, loaded };
}

function overlayOpts(bounds) {
  return Object.assign({
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    hasShadow: false,
    thickFrame: false,
  }, bounds);
}

function closeWin(key) {
  const w = win[key];
  win[key] = null;
  if (alive(w)) w.destroy();
}

function closeRegions() {
  for (const w of win.regions) if (alive(w)) w.destroy();
  win.regions = [];
}

function cursorDisplay() {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

function displayLabel(d, i) {
  const primary = d.id === screen.getPrimaryDisplay().id ? ' (primary)' : '';
  return `Display ${i + 1}${primary} — ${d.size.width}×${d.size.height}`;
}

/* ---------- capture session handler (own partition, nothing global) ---------- */

function ensureSession() {
  if (handlersInstalled) return;
  handlersInstalled = true;
  const ses = session.fromPartition(PARTITION);
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(['media', 'display-capture'].includes(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => ['media', 'display-capture'].includes(permission));
  ses.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const t = captureTarget;
      if (!t) return callback({});
      const isWindow = t.type === 'window';
      const sources = await desktopCapturer.getSources({
        types: [isWindow ? 'window' : 'screen'],
        thumbnailSize: { width: 0, height: 0 },
      });
      let src;
      if (isWindow) src = sources.find((s) => s.id === t.id);
      else {
        src = sources.find((s) => s.display_id === String(t.displayId));
        if (!src) {
          const idx = screen.getAllDisplays().findIndex((d) => d.id === t.displayId);
          src = sources[idx >= 0 && idx < sources.length ? idx : 0];
        }
      }
      if (!src) return callback({});
      const grant = { video: src };
      if (t.audio) grant.audio = 'loopback';
      return callback(grant);
    } catch (e) {
      return callback({});
    }
  }, { useSystemPicker: false });
}

async function ensureWorker() {
  ensureSession();
  if (alive(win.worker) && workerReady) {
    await workerReady;
    return win.worker;
  }
  const { w, loaded } = makeWindow('worker', {
    width: 320, height: 240,
    webPreferences: {
      preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required', partition: PARTITION,
    },
  });
  win.worker = w;
  w.on('closed', () => { if (win.worker === w) { win.worker = null; workerReady = null; } });
  workerReady = loaded;
  await loaded;
  return w;
}

function maybeCloseWorker() {
  if (state.status === 'idle' && activeJobs === 0) {
    workerReady = null;
    closeWin('worker');
  }
}

/* ---------- setup HUD ---------- */

function openSetup(opts) {
  const d = cursorDisplay();
  const wa = d.workArea;
  const width = 440;
  const height = Math.min(640, wa.height - 40);
  const { w } = makeWindow('setup', {
    width, height,
    x: Math.round(wa.x + (wa.width - width) / 2),
    y: Math.round(wa.y + (wa.height - height) / 2),
    alwaysOnTop: true,
    backgroundColor: '#1b1d23',
    title: 'SnipSnapStitch — Video Capture',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.ico'),
  });
  state.opts = opts;
  state.display = d;
  state.status = 'setup';
  win.setup = w;
  w.once('ready-to-show', () => { w.show(); w.focus(); });
  w.on('closed', () => {
    if (win.setup === w) {
      win.setup = null;
      if (state.status === 'setup') resetToIdle();
    }
  });
  publish();
}

async function listWindows() {
  const own = new Set(Object.values(win).flat().filter(alive).map((w) => w.getMediaSourceId()));
  const sources = await desktopCapturer.getSources({
    types: ['window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false,
  });
  return sources
    .filter((s) => s.name && !own.has(s.id) && s.thumbnail && !s.thumbnail.isEmpty())
    .map((s) => ({ id: s.id, name: s.name, thumb: s.thumbnail.toDataURL() }));
}

/* ---------- region selection ---------- */

function selectRegion() {
  return new Promise((resolve) => {
    const displays = screen.getAllDisplays();
    regionResolve = (res) => {
      regionResolve = null;
      closeRegions();
      resolve(res);
    };
    for (const d of displays) {
      const { w } = makeWindow('region', overlayOpts({
        x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, focusable: true,
        enableLargerThanScreen: true,
      }), { did: String(d.id) });
      w.setAlwaysOnTop(true, 'screen-saver');
      // Windows can create the window at the wrong size on scaled / mixed-DPI displays; setting the bounds again fixes it.
      w.setBounds(d.bounds);
      w.setBounds(d.bounds);
      w.once('ready-to-show', () => {
        if (w.isDestroyed()) return;
        w.setBounds(d.bounds);
        w.show();
        w.setBounds(d.bounds);
        w.focus();
      });
      win.regions.push(w);
    }
  });
}

/* ---------- countdown / bar / border / halo ---------- */

async function runCountdown(display, rect, token) {
  state.status = 'countdown';
  publish();
  const size = 220;
  const cx = rect ? display.bounds.x + rect.x + rect.w / 2 : display.bounds.x + display.bounds.width / 2;
  const cy = rect ? display.bounds.y + rect.y + rect.h / 2 : display.bounds.y + display.bounds.height / 2;
  const { w, loaded } = makeWindow('countdown', overlayOpts({
    width: size, height: size, x: Math.round(cx - size / 2), y: Math.round(cy - size / 2), focusable: false,
  }));
  w.setContentProtection(true);
  w.setAlwaysOnTop(true, 'screen-saver');
  win.countdown = w;
  await loaded;
  w.showInactive();
  for (const n of [3, 2, 1]) {
    if (token !== sessionToken || !alive(w)) break;
    w.webContents.send('recorder:count', n);
    await sleep(1000);
  }
  closeWin('countdown');
}

function barBounds(display, rect) {
  const wa = display.workArea;
  const clampX = (x) => Math.round(Math.max(wa.x, Math.min(wa.x + wa.width - BAR_W, x)));
  if (rect) {
    const rx = display.bounds.x + rect.x, ry = display.bounds.y + rect.y;
    const below = ry + rect.h + 14;
    if (below + BAR_H <= wa.y + wa.height) return { x: clampX(rx + rect.w / 2 - BAR_W / 2), y: below };
    const above = ry - BAR_H - 14;
    if (above >= wa.y) return { x: clampX(rx + rect.w / 2 - BAR_W / 2), y: above };
  }
  return { x: clampX(wa.x + wa.width / 2 - BAR_W / 2), y: wa.y + 12 };
}

function showBar(display, rect) {
  const pos = barBounds(display, rect);
  const { w } = makeWindow('bar', overlayOpts({
    width: BAR_W, height: BAR_H, x: pos.x, y: pos.y, focusable: true,
  }));
  w.setContentProtection(true);
  w.setAlwaysOnTop(true, 'screen-saver');
  w.webContents.once('did-finish-load', () => publish());
  w.once('ready-to-show', () => w.showInactive());
  win.bar = w;
}

function showBorder(display, rect) {
  const pad = 3;
  const { w } = makeWindow('border', overlayOpts({
    x: display.bounds.x + rect.x - pad, y: display.bounds.y + rect.y - pad,
    width: rect.w + pad * 2, height: rect.h + pad * 2, focusable: false,
  }));
  w.setContentProtection(true);
  w.setIgnoreMouseEvents(true);
  w.setAlwaysOnTop(true, 'screen-saver');
  const bounds = {
    x: display.bounds.x + rect.x - pad, y: display.bounds.y + rect.y - pad,
    width: rect.w + pad * 2, height: rect.h + pad * 2,
  };
  w.setBounds(bounds);
  w.setBounds(bounds);
  w.once('ready-to-show', () => { if (!w.isDestroyed()) { w.setBounds(bounds); w.showInactive(); } });
  win.border = w;
}

function showHalo() {
  const size = 72;
  const { w } = makeWindow('halo', overlayOpts({ width: size, height: size, focusable: false }));
  w.setIgnoreMouseEvents(true);
  w.setAlwaysOnTop(true, 'screen-saver');
  w.once('ready-to-show', () => w.showInactive());
  win.halo = w;
  let lx = null, ly = null;
  haloTimer = setInterval(() => {
    if (!alive(w)) return;
    const p = screen.getCursorScreenPoint();
    if (p.x === lx && p.y === ly) return;
    lx = p.x; ly = p.y;
    w.setBounds({ x: p.x - size / 2, y: p.y - size / 2, width: size, height: size });
  }, 16);
}

function hideOverlays() {
  if (haloTimer) { clearInterval(haloTimer); haloTimer = null; }
  closeWin('halo');
  closeWin('border');
  closeWin('bar');
}

function resetToIdle() {
  sessionToken++;
  captureTarget = null;
  regionResolve = null;
  if (powerBlocker !== null) {
    try { powerSaveBlocker.stop(powerBlocker); } catch (e) { /* ignore */ }
    powerBlocker = null;
  }
  hideOverlays();
  closeRegions();
  closeWin('countdown');
  closeWin('setup');
  Object.assign(state, { status: 'idle', accumulated: 0, resumedAt: 0, micActive: false, region: null, info: null });
  maybeCloseWorker();
  publish();
}

/* ---------- session ---------- */

// Without GPU canvas the default 2D canvas never feeds MediaRecorder reliably at high
// resolutions in a hidden window; a CPU-backed canvas does.
function softwareRendering() {
  try {
    const s = app.getGPUFeatureStatus();
    return !/^enabled/.test(String(s['2d_canvas'])) || !/^enabled/.test(String(s.gpu_compositing));
  } catch (e) {
    return false;
  }
}

async function runSession(o) {
  const token = ++sessionToken;
  state.opts = o;
  state.status = 'preparing';
  state.accumulated = 0;
  state.micActive = false;
  state.info = null;
  lastItem = null;
  publish();
  const stale = () => token !== sessionToken;
  try {
    let display = (o.displayId != null && screen.getAllDisplays().find((d) => d.id === o.displayId)) || state.display || cursorDisplay();
    let rect = null;
    if (o.mode === 'region') {
      const sel = await selectRegion();
      if (stale()) return;
      if (!sel) { resetToIdle(); return; }
      display = sel.display;
      rect = sel.rect;
      await sleep(150); // let the overlays disappear before capturing
    } else if (o.mode === 'window') {
      display = cursorDisplay();
    }
    if (stale()) return;
    state.display = display;
    state.region = rect;
    captureTarget = o.mode === 'window'
      ? { type: 'window', id: o.windowId, audio: o.audio }
      : { type: 'screen', displayId: display.id, audio: o.audio };

    const workerP = ensureWorker();
    if (o.countdown) await runCountdown(display, rect, token);
    else await sleep(250);
    if (stale()) return;
    const worker = await workerP;
    if (stale()) return;

    const cfg = {
      mode: o.mode, fps: o.fps, audio: o.audio, mic: o.mic, region: rect,
      displayBounds: { width: display.bounds.width, height: display.bounds.height },
      cpuCanvas: softwareRendering(),
    };
    const info = await worker.webContents.executeJavaScript(`window.recorderWorker.start(${JSON.stringify(cfg)})`, true);
    if (stale()) {
      worker.webContents.executeJavaScript('window.recorderWorker.discard()').catch(() => {});
      return;
    }
    state.info = info;
    state.micActive = !!info.mic;
    state.status = 'recording';
    state.resumedAt = Date.now();
    powerBlocker = powerSaveBlocker.start('prevent-display-sleep');
    showBar(display, rect);
    if (rect) showBorder(display, rect);
    if (o.highlightCursor && o.mode !== 'window') showHalo();
    if (o.mic && !info.mic) notifyError('Microphone unavailable: ' + (info.micError || 'no input device or permission denied') + '. Recording without it.');
    publish();
  } catch (e) {
    if (!stale()) {
      resetToIdle();
      notifyError('Could not start recording: ' + ((e && e.message) || e));
    }
  }
}

async function startRecording(opts) {
  if (!registered) register(); // IPC handlers and the capture session are only set up once recording is first used
  if (state.status === 'preparing' || state.status === 'countdown') {
    resetToIdle();
    return getState();
  }
  if (state.status === 'recording' || state.status === 'paused') {
    await stopRecording();
    return getState();
  }
  if (state.status === 'saving') return getState();
  if (state.status === 'setup') {
    if (alive(win.setup)) { win.setup.show(); win.setup.focus(); }
    return getState();
  }
  ensureSession();
  const merged = normalize(Object.assign({}, loadPrefs(), opts || {}));
  if (opts && (opts.setup === false || opts.immediate)) {
    await runSession(merged);
    return getState();
  }
  openSetup(merged);
  return getState();
}

async function stopRecording() {
  if (state.status !== 'recording' && state.status !== 'paused') {
    if (state.status !== 'idle' && state.status !== 'saving') resetToIdle();
    return null;
  }
  const worker = win.worker;
  state.accumulated = elapsedMs();
  state.status = 'saving';
  lastItem = null;
  hideOverlays();
  publish();
  let item = null;
  try {
    await pauseChain;
    if (!alive(worker)) throw new Error('Recorder worker is gone');
    await worker.webContents.executeJavaScript('window.recorderWorker.stop()');
    item = lastItem;
    if (!item) notifyError('Nothing was recorded (no video frames were captured).');
  } catch (e) {
    notifyError('Saving the recording failed: ' + ((e && e.message) || e));
  }
  resetToIdle();
  if (item) {
    try { await getWindows().openLibrary(); } catch (e) { console.error('[recorder] openLibrary failed', e); }
  }
  return item;
}

async function discardRecording() {
  if (state.status !== 'recording' && state.status !== 'paused') return false;
  const worker = win.worker;
  try { await pauseChain; if (alive(worker)) await worker.webContents.executeJavaScript('window.recorderWorker.discard()'); } catch (e) { /* ignore */ }
  resetToIdle();
  return true;
}

let pauseChain = Promise.resolve();

// The state flips (and the bar updates) immediately; the recorder worker is told afterwards, in order. The worker's
// main thread can be busy drawing large frames, so waiting for it made the button feel slow.
function pauseRecording(paused) {
  if (state.status !== 'recording' && state.status !== 'paused') return getState();
  const want = paused === undefined || paused === null ? state.status === 'recording' : !!paused;
  if (want === (state.status === 'paused')) return getState();
  if (want) {
    state.accumulated = elapsedMs();
    state.status = 'paused';
  } else {
    state.resumedAt = Date.now();
    state.status = 'recording';
  }
  const snap = publish();
  pauseChain = pauseChain.then(async () => {
    const worker = win.worker;
    if (!alive(worker)) return;
    await worker.webContents.executeJavaScript(`window.recorderWorker.${want ? 'pause' : 'resume'}()`);
  }).catch((e) => console.error('[recorder] pause/resume failed', e));
  return snap;
}

/* ---------- GIF export ---------- */

async function convertBufferToGif(buf, onProgress) {
  const worker = await ensureWorker();
  const jobId = ++jobSeq;
  activeJobs++;
  try {
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { gifJobs.delete(jobId); reject(new Error('GIF conversion timed out')); }, 20 * 60 * 1000);
      gifJobs.set(jobId, { resolve, reject, timer, onProgress });
      worker.webContents.send('recorder:gif-job', { jobId, buffer: buf, maxFps: 12, maxWidth: 800 });
    });
    return await getStore().addMedia(Buffer.from(result.buffer.buffer, result.buffer.byteOffset, result.buffer.byteLength), {
      ext: 'gif', source: 'recording', width: result.width, height: result.height,
      thumbBuffer: result.thumb ? Buffer.from(result.thumb.buffer, result.thumb.byteOffset, result.thumb.byteLength) : undefined,
    });
  } finally {
    activeJobs--;
    maybeCloseWorker();
  }
}

async function exportGif(id, onProgress) {
  const store = getStore();
  const item = await store.get(id);
  if (!item) throw new Error('Item not found: ' + id);
  if (item.type !== 'video') throw new Error('Only videos can be exported as GIF');
  const buf = await fs.promises.readFile(await store.getFilePath(id));
  return convertBufferToGif(buf, onProgress);
}

async function convertGifFromFile(filePath, onProgress) {
  if (!filePath || typeof filePath !== 'string') throw new Error('path required');
  return convertBufferToGif(await fs.promises.readFile(filePath), onProgress);
}

/* ---------- IPC ---------- */

let registered = false;

function register() {
  registered = true;
  ensureSession();
  const handle = (channel, fn) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, fn);
  };

  handle('recorder:start', (_e, opts) => startRecording(opts));
  handle('recorder:stop', async () => {
    const item = await stopRecording();
    return item || null;
  });
  handle('recorder:pause', (_e, arg) => pauseRecording(arg && typeof arg === 'object' ? arg.paused : arg));
  handle('recorder:state', () => getState());
  handle('recorder:export-gif', (e, arg) => {
    const id = arg && typeof arg === 'object' ? arg.id : arg;
    return exportGif(id, (p) => { if (!e.sender.isDestroyed()) e.sender.send('recorder:gif-progress', { id, progress: p }); });
  });
  handle('recorder:convert-gif-from-file', (e, arg) => {
    const p = arg && typeof arg === 'object' ? arg.path : arg;
    return convertGifFromFile(p, (v) => { if (!e.sender.isDestroyed()) e.sender.send('recorder:gif-progress', { path: p, progress: v }); });
  });

  // internal
  handle('recorder:setup-init', () => ({
    opts: state.opts || normalize(loadPrefs()),
    displays: screen.getAllDisplays().map((d, i) => ({ id: d.id, label: displayLabel(d, i) })),
    defaultDisplayId: (state.display || cursorDisplay()).id,
  }));
  handle('recorder:list-windows', () => listWindows());
  handle('recorder:setup-submit', (_e, o) => {
    if (state.status !== 'setup') return { ok: false, error: 'Setup is no longer active.' };
    const opts = normalize(o);
    if (opts.mode === 'window' && !(o && o.windowId)) return { ok: false, error: 'Select a window to record.' };
    opts.displayId = o && o.displayId != null ? Number(o.displayId) : null;
    opts.windowId = (o && o.windowId) || null;
    savePrefs(opts);
    state.status = 'preparing';
    closeWin('setup');
    runSession(opts);
    return { ok: true };
  });
  handle('recorder:setup-cancel', () => { if (state.status === 'setup') resetToIdle(); return true; });
  handle('recorder:cancel', () => {
    if (state.status === 'preparing' || state.status === 'countdown') resetToIdle();
    return true;
  });
  handle('recorder:region-result', (_e, res) => {
    if (!regionResolve) return false;
    const rect = res && res.rect;
    const display = res && screen.getAllDisplays().find((d) => d.id === res.displayId);
    if (rect && display && rect.w > 0 && rect.h > 0) regionResolve({ display, rect });
    else regionResolve(null);
    return true;
  });
  handle('recorder:bar-action', async (_e, arg) => {
    const action = arg && arg.action;
    if (action === 'pause') return pauseRecording(typeof arg.paused === 'boolean' ? arg.paused : undefined);
    if (action === 'stop') { stopRecording(); return true; }
    if (action === 'discard') return discardRecording();
    return false;
  });
  handle('recorder:ended', () => { stopRecording(); return true; }); // captured window/screen went away
  handle('recorder:failed', (_e, arg) => {
    notifyError((arg && arg.error) || 'Recording failed');
    discardRecording();
    return true;
  });
  handle('recorder:finished', async (_e, p) => {
    const u8 = (a) => (a ? Buffer.from(a.buffer, a.byteOffset, a.byteLength) : undefined);
    lastItem = await getStore().addMedia(u8(p.buffer), {
      ext: 'webm', source: 'recording', width: p.width, height: p.height, thumbBuffer: u8(p.thumb),
    });
    if (lastItem && state.opts && state.opts.optimize) {
      try {
        require('./video-optimizer').optimize(lastItem.id, { preset: 'balanced', fps: state.opts.fps, durationMs: p.durationMs, notify: true });
      } catch (e) { console.error('[recorder] optimize failed to start', e); }
    }
    return { id: lastItem && lastItem.id, durationMs: p.durationMs };
  });
  handle('recorder:gif-result', (_e, r) => {
    const job = gifJobs.get(r && r.jobId);
    if (!job) return false;
    gifJobs.delete(r.jobId);
    clearTimeout(job.timer);
    if (r.ok) job.resolve(r);
    else job.reject(new Error(r.error || 'GIF conversion failed'));
    return true;
  });
  ipcMain.removeAllListeners('recorder:gif-progress');
  ipcMain.on('recorder:gif-progress', (_e, r) => {
    const job = r && gifJobs.get(r.jobId);
    if (job && job.onProgress) job.onProgress(r.progress);
  });
}

module.exports = {
  register,
  startRecording,
  stopRecording,
  pauseRecording,
  discardRecording,
  getState,
  exportGif,
  convertGifFromFile,
  events,
  setDeps(d) { Object.assign(deps, d); },
};
