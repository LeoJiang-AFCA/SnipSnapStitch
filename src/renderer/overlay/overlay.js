'use strict';
(function () {
  const api = window.overlayApi;
  const $ = (id) => document.getElementById(id);
  const el = {
    shot: $('shot'), dim: $('dim'), hl: $('hl'), hlLabel: $('hl-label'), vline: $('vline'), hline: $('hline'),
    sel: $('sel'), size: $('size'), toolbar: $('toolbar'), loupe: $('loupe'), loupeCanvas: $('loupe-canvas'),
    swatch: $('swatch'), loupeText: $('loupe-text'), hint: $('hint'), countdown: $('countdown'),
  };

  // Idle until main pushes the init payload (the window is pre-loaded in a pool).
  el.shot.hidden = true;
  el.dim.hidden = true;
  api.onInit(start);

  function start(init) {
    if (!init) { api.cancel(); return; }
    el.shot.hidden = false;
    el.dim.hidden = false;
    if (init.mode === 'countdown') {
      document.body.classList.add('countdown');
      el.shot.hidden = true;
      el.dim.hidden = true;
      el.countdown.hidden = false;
      el.countdown.textContent = init.value;
      api.onCountdown((n) => { el.countdown.textContent = n; });
      requestAnimationFrame(() => requestAnimationFrame(() => api.ready()));
      return;
    }
    runSelection(init);
  }

  function runSelection(init) {
  const W = init.width;
  const H = init.height;
  const kind = init.kind;
  const windows = init.windows || [];
  const MIN_DRAG = 4;

  // Bitmap arrives as BGRA; convert to RGBA (opaque) for canvas and pixel readout.
  const pixels = new Uint8ClampedArray(W * H * 4);
  pixels.set(new Uint8Array(init.bitmap.buffer || init.bitmap, init.bitmap.byteOffset || 0, W * H * 4));
  const px32 = new Uint32Array(pixels.buffer);
  for (let i = 0; i < px32.length; i++) {
    const v = px32[i];
    px32[i] = (v & 0x0000ff00) | ((v & 0xff) << 16) | ((v >>> 16) & 0xff) | 0xff000000;
  }
  el.shot.width = W;
  el.shot.height = H;
  el.shot.getContext('2d').putImageData(new ImageData(pixels, W, H), 0, 0);

  const lctx = el.loupeCanvas.getContext('2d');
  const limg = lctx.createImageData(11, 11);
  const l32 = new Uint32Array(limg.data.buffer);

  el.hint.textContent = init.hint || '';
  el.hint.hidden = !init.hint;

  const state = {
    mode: 'idle', // idle | drag | selected | move | resize
    l: 0, t: 0, r: 0, b: 0,
    handle: null, start: null, orig: null, pendingWin: null, hover: null,
    mouse: { x: -1, y: -1 }, done: false,
  };

  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const vw = () => window.innerWidth;
  const vh = () => window.innerHeight;
  const scaleX = () => W / vw();
  const scaleY = () => H / vh();
  const rect = () => ({
    x: Math.min(state.l, state.r), y: Math.min(state.t, state.b),
    w: Math.abs(state.r - state.l), h: Math.abs(state.b - state.t),
  });
  const hasSel = () => state.mode === 'selected' || state.mode === 'drag' || state.mode === 'move' || state.mode === 'resize';

  function confirm(r) {
    if (state.done) return;
    const w = r.w * scaleX();
    const h = r.h * scaleY();
    if (w < 1 || h < 1) return;
    state.done = true;
    api.confirm({ x: r.x, y: r.y, w: r.w, h: r.h });
  }

  function cancel() {
    if (state.done) return;
    state.done = true;
    api.cancel();
  }

  function render() {
    const showSel = hasSel();
    el.sel.hidden = !showSel;
    el.dim.hidden = showSel;
    if (showSel) {
      const r = rect();
      Object.assign(el.sel.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
      const pw = Math.round(r.w * scaleX());
      const ph = Math.round(r.h * scaleY());
      el.size.textContent = pw + ' \u00d7 ' + ph;
      el.size.hidden = false;
      const inside = r.y < 28;
      el.size.style.left = (inside ? r.x + 6 : r.x) + 'px';
      el.size.style.top = (inside ? r.y + 6 : r.y - 26) + 'px';
    } else {
      el.size.hidden = true;
    }
    const showTb = state.mode === 'selected';
    el.toolbar.hidden = !showTb;
    if (showTb) {
      const r = rect();
      const tw = el.toolbar.offsetWidth;
      const th = el.toolbar.offsetHeight;
      let top = r.y + r.h + 10;
      if (top + th > vh()) top = Math.max(0, r.y + r.h - th - 10);
      el.toolbar.style.left = clamp(r.x + r.w - tw, 0, Math.max(0, vw() - tw)) + 'px';
      el.toolbar.style.top = top + 'px';
    }
    el.hl.hidden = !(state.mode === 'idle' && state.hover);
    if (!el.hl.hidden) {
      const h = state.hover;
      Object.assign(el.hl.style, { left: h.x + 'px', top: h.y + 'px', width: h.w + 'px', height: h.h + 'px' });
      el.hl.classList.toggle('label-in', h.y < 26);
      el.hlLabel.textContent = (h.title || 'Window') + '  \u2014  ' + Math.round(h.w * scaleX()) + ' \u00d7 ' + Math.round(h.h * scaleY());
    }
    const guides = state.mode === 'idle' || state.mode === 'drag';
    el.vline.hidden = el.hline.hidden = !guides || state.mouse.x < 0;
    if (!el.vline.hidden) {
      el.vline.style.left = state.mouse.x + 'px';
      el.hline.style.top = state.mouse.y + 'px';
    }
  }

  function updateLoupe() {
    const m = state.mouse;
    if (m.x < 0) { el.loupe.hidden = true; return; }
    const px = clamp(Math.floor(m.x * scaleX()), 0, W - 1);
    const py = clamp(Math.floor(m.y * scaleY()), 0, H - 1);
    for (let j = 0; j < 11; j++) {
      for (let i = 0; i < 11; i++) {
        const sx = px + i - 5;
        const sy = py + j - 5;
        l32[j * 11 + i] = sx >= 0 && sy >= 0 && sx < W && sy < H ? px32[sy * W + sx] : 0xff202020;
      }
    }
    lctx.putImageData(limg, 0, 0);
    const c = px32[py * W + px];
    const hex = [c & 255, (c >>> 8) & 255, (c >>> 16) & 255].map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase();
    el.swatch.style.background = '#' + hex;
    el.loupeText.textContent = (init.originX + px) + ', ' + (init.originY + py) + '\n#' + hex;
    el.loupe.hidden = false;
    const lw = 143;
    const lh = el.loupe.offsetHeight || 180;
    let x = m.x + 24;
    let y = m.y + 24;
    if (x + lw + 8 > vw()) x = m.x - 24 - lw;
    if (y + lh + 8 > vh()) y = m.y - 24 - lh;
    el.loupe.style.left = Math.max(0, x) + 'px';
    el.loupe.style.top = Math.max(0, y) + 'px';
  }

  function windowAt(x, y) {
    for (const w of windows) {
      if (x >= w.x && y >= w.y && x < w.x + w.w && y < w.y + w.h) return w;
    }
    return null;
  }

  function onMove(e) {
    state.mouse.x = e.clientX;
    state.mouse.y = e.clientY;
    const x = clamp(e.clientX, 0, vw());
    const y = clamp(e.clientY, 0, vh());
    if (state.mode === 'drag') {
      state.r = x;
      state.b = y;
    } else if (state.mode === 'resize') {
      const h = state.handle;
      if (h.includes('w')) state.l = x;
      if (h.includes('e')) state.r = x;
      if (h.includes('n')) state.t = y;
      if (h.includes('s')) state.b = y;
    } else if (state.mode === 'move') {
      const o = state.orig;
      const w = o.w;
      const h = o.h;
      const nx = clamp(o.x + x - state.start.x, 0, vw() - w);
      const ny = clamp(o.y + y - state.start.y, 0, vh() - h);
      state.l = nx; state.t = ny; state.r = nx + w; state.b = ny + h;
    } else if (state.mode === 'idle') {
      state.hover = windows.length ? windowAt(x, y) : null;
    }
    render();
    updateLoupe();
  }

  function onDown(e) {
    if (e.button === 2) { cancel(); return; }
    if (e.button !== 0) return;
    if (e.target.closest('#toolbar')) return;
    const x = clamp(e.clientX, 0, vw());
    const y = clamp(e.clientY, 0, vh());
    el.hint.hidden = true;
    const handle = e.target.closest('.handle');
    if (state.mode === 'selected' && handle) {
      state.mode = 'resize';
      state.handle = handle.dataset.h;
    } else if (state.mode === 'selected' && e.target.closest('#sel')) {
      state.mode = 'move';
      state.start = { x, y };
      state.orig = rect();
    } else {
      state.pendingWin = state.mode === 'idle' || state.mode === 'selected' ? windowAt(x, y) : null;
      state.mode = 'drag';
      state.start = { x, y };
      state.l = state.r = x;
      state.t = state.b = y;
      state.hover = null;
    }
    render();
  }

  function onUp(e) {
    if (e.button !== 0) return;
    if (state.mode === 'drag') {
      const r = rect();
      if (r.w < MIN_DRAG && r.h < MIN_DRAG) {
        const win = state.pendingWin;
        state.mode = 'idle';
        state.pendingWin = null;
        if (win) { confirm({ x: win.x, y: win.y, w: win.w, h: win.h }); return; }
      } else {
        state.mode = 'selected';
      }
      state.pendingWin = null;
    } else if (state.mode === 'move' || state.mode === 'resize') {
      state.mode = 'selected';
      const r = rect();
      Object.assign(state, { l: r.x, t: r.y, r: r.x + r.w, b: r.y + r.h });
    }
    render();
    updateLoupe();
  }

  function confirmCurrent() {
    if (state.mode === 'selected') confirm(rect());
    else if (state.mode === 'idle' && state.hover) confirm(state.hover);
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); return; }
    if (e.key === 'Enter') { e.preventDefault(); confirmCurrent(); return; }
    if (state.mode === 'selected' && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const step = (e.shiftKey ? 10 : 1) / scaleX();
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      const r = rect();
      const nx = clamp(r.x + dx, 0, vw() - r.w);
      const ny = clamp(r.y + dy, 0, vh() - r.h);
      Object.assign(state, { l: nx, t: ny, r: nx + r.w, b: ny + r.h });
      render();
    }
  }

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mousedown', onDown);
  window.addEventListener('mouseup', onUp);
  window.addEventListener('keydown', onKey);
  window.addEventListener('contextmenu', (e) => { e.preventDefault(); });
  window.addEventListener('dblclick', (e) => {
    if (e.target.closest('#toolbar')) return;
    if (state.mode === 'selected') confirm(rect());
  });
  document.addEventListener('mouseenter', () => api.activate());
  window.addEventListener('mouseleave', () => {
    state.mouse.x = -1;
    state.hover = null;
    render();
    updateLoupe();
  });
  window.addEventListener('blur', () => {
    if (state.mode === 'drag' || state.mode === 'move' || state.mode === 'resize') {
      state.mode = state.mode === 'drag' ? 'idle' : 'selected';
      render();
    }
  });
  $('btn-ok').addEventListener('click', () => { if (state.mode === 'selected') confirm(rect()); });
  $('btn-cancel').addEventListener('click', cancel);

  render();
  requestAnimationFrame(() => requestAnimationFrame(() => api.ready()));
  }
})();
