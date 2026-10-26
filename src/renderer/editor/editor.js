/* SnipSnapStitch image editor: state, tools, interaction, panel, I/O. */
(function () {
  'use strict';
  const RS = window.RS;
  const G = RS.geometry, M = RS.model, R = RS.render, ICONS = RS.icons, P = RS.props;
  const api = window.editorApi;
  const $ = id => document.getElementById(id);
  const dpr = () => window.devicePixelRatio || 1;

  const view = $('view');
  const vctx = view.getContext('2d');
  const stage = $('stage');
  const ta = $('textEditor');
  const panelEl = $('panel');

  const TOOLS = [
    { id: 'pan', label: 'Pan / move (hand)', key: 'G' },
    { sep: true },
    { id: 'arrow', label: 'Arrow', key: 'A' },
    { id: 'line', label: 'Line', key: 'L' },
    { id: 'rect', label: 'Rectangle', key: 'R' },
    { id: 'ellipse', label: 'Ellipse', key: 'O' },
    { sep: true },
    { id: 'text', label: 'Text', key: 'T' },
    { id: 'callout', label: 'Callout', key: 'C' },
    { id: 'step', label: 'Step number', key: 'N' },
    { id: 'stamp', label: 'Stamp / emoji', key: 'E' },
    { sep: true },
    { id: 'highlight', label: 'Highlighter', key: 'H' },
    { id: 'pen', label: 'Pen', key: 'P' },
    { id: 'blur', label: 'Blur / Pixelate', key: 'B' },
    { id: 'spotlight', label: 'Spotlight', key: 'S' },
    { id: 'magnify', label: 'Magnify', key: 'M' },
    { sep: true },
    { id: 'eyedropper', label: 'Eyedropper', key: 'I' },
    { id: 'crop', label: 'Crop', key: 'X' },
    { id: 'canvas', label: 'Canvas size', key: 'Z' }
  ];
  const TOOL_LABEL = {};
  TOOLS.forEach(t => { if (t.id) TOOL_LABEL[t.id] = t.label; });
  const KEY_TO_TOOL = {};
  TOOLS.forEach(t => { if (t.id) KEY_TO_TOOL[t.key.toLowerCase()] = t.id; });
  const CREATE_TOOLS = ['arrow', 'line', 'rect', 'ellipse', 'text', 'callout', 'step', 'stamp', 'highlight', 'pen', 'blur', 'spotlight', 'magnify'];
  const TOOL_HINTS = {
    arrow: 'Drag to draw an arrow. Hold <kbd>Shift</kbd> to snap the angle.',
    line: 'Drag to draw a line. Hold <kbd>Shift</kbd> to snap the angle.',
    rect: 'Drag to draw. Hold <kbd>Shift</kbd> for a square.',
    ellipse: 'Drag to draw. Hold <kbd>Shift</kbd> for a circle.',
    text: 'Click to type, or drag to set a text box width. <kbd>Esc</kbd> finishes.',
    callout: 'Drag to draw a speech bubble, then type. Drag the round handle to move the tail.',
    step: 'Click to place numbered badges; numbers increase automatically.',
    stamp: 'Pick a stamp, then click on the image to place it.',
    highlight: 'Drag over content to highlight it.',
    pen: 'Draw freehand.',
    blur: 'Drag over sensitive content to blur or pixelate it.',
    spotlight: 'Drag to light an area and dim everything else.',
    magnify: 'Click or drag to place a zoom lens.'
  };

  const FONTS = ['Segoe UI', 'Arial', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Courier New', 'Consolas', 'Comic Sans MS', 'Impact'];
  const ASPECTS = [['free', 'Free'], ['orig', 'Original'], ['1:1', '1:1 Square'], ['4:3', '4:3'], ['3:2', '3:2'], ['16:9', '16:9'], ['9:16', '9:16 Portrait']];

  const S = {
    id: null, item: null, name: '',
    base: null, baseOps: [], docW: 0, docH: 0, objects: [],
    doc: document.createElement('canvas'),
    tool: 'pan', prevTool: 'pan', styles: {}, hlMode: 'rect', pickProp: 'stroke',
    sel: [], view: { z: 1, x: 0, y: 0 }, fitMode: true,
    drag: null, spaceDown: false, hover: null, hoverColor: null,
    editing: null, crop: null, cv: null,
    history: null, docDirty: true, uiScale: 1, ready: false, saving: false, deleting: false
  };
  const V = S.view;

  // ---------- helpers ----------
  const selObjs = () => S.objects.filter(o => S.sel.includes(o.id));
  const objById = id => S.objects.find(o => o.id === id);
  const isTextual = o => o && (o.type === 'text' || o.type === 'callout');

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function loadImg(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image failed to load'));
      img.src = src;
    });
  }

  function imgToCanvas(img) {
    const c = makeCanvas(img.naturalWidth, img.naturalHeight);
    c.getContext('2d').drawImage(img, 0, 0);
    return c;
  }

  function applyOp(src, op) {
    const c = makeCanvas(op.w, op.h);
    const ctx = c.getContext('2d');
    if (op.op === 'crop') ctx.drawImage(src, -op.x, -op.y);
    else if (op.op === 'extend') {
      if (op.bg) { ctx.fillStyle = op.bg; ctx.fillRect(0, 0, op.w, op.h); }
      ctx.drawImage(src, op.ox, op.oy);
    } else {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, op.w, op.h);
    }
    return c;
  }

  function toast(msg, isError) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'show' + (isError ? ' error' : '');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.className = ''; }, isError ? 4000 : 1800);
  }

  // ---------- styles ----------
  function initStyles() {
    const k = S.uiScale;
    S.styles = {};
    Object.keys(M.PANEL).forEach(key => {
      const type = key === 'hlpen' ? 'pen' : key;
      const st = Object.assign({ type }, M.defaultsFor(type));
      if (key === 'hlpen') Object.assign(st, { stroke: '#ffe600', width: 18, opacity: 0.5, blend: 'multiply', cap: 'square' });
      if ('width' in st && key !== 'hlpen') st.width = Math.round(st.width * k);
      if (key === 'hlpen') st.width = Math.round(st.width * k);
      if ('size' in st) st.size = Math.round(st.size * k);
      if (key === 'step') { st.w = st.h = Math.round(44 * k); }
      if (key === 'stamp') { st.w = st.h = Math.round(56 * k); }
      if (key === 'blur') { st.mode = 'pixelate'; st.amount = Math.round(12 * k); }
      S.styles[key] = st;
    });
  }

  function toolStyleKey(tool) {
    if (tool === 'highlight') return S.hlMode === 'brush' ? 'hlpen' : 'highlight';
    return CREATE_TOOLS.includes(tool) ? tool : null;
  }

  // ---------- history ----------
  function snapshot() {
    return {
      w: S.docW, h: S.docH, base: S.base, baseOps: S.baseOps.slice(),
      objects: JSON.stringify(S.objects, (k, v) => (k.charAt(0) === '_' ? undefined : v))
    };
  }

  function restore(st) {
    const sizeChanged = st.w !== S.docW || st.h !== S.docH;
    S.base = st.base; S.docW = st.w; S.docH = st.h; S.baseOps = st.baseOps.slice();
    S.objects = JSON.parse(st.objects).map(M.normalizeObject).filter(Boolean);
    S.sel = S.sel.filter(id => objById(id));
    if (sizeChanged) { S.fitMode = true; fit(); }
    invalidate(true);
    refreshPanel();
    updateChrome();
  }

  function commit() {
    clearTimeout(commit.nudge);
    S.history.push(snapshot());
    refreshPanel();
    updateChrome();
  }

  function undo() {
    if (S.editing) endEdit();
    const st = S.history.undo();
    if (st) restore(st);
  }

  function redo() {
    if (S.editing) endEdit();
    const st = S.history.redo();
    if (st) restore(st);
  }

  // ---------- rendering ----------
  let rafId = 0;
  function invalidate(docToo) {
    if (docToo) S.docDirty = true;
    if (!rafId) rafId = requestAnimationFrame(frame);
  }
  R.setAssetLoadedCallback(() => invalidate(true));

  function frame() {
    rafId = 0;
    if (!S.ready) return;
    if (S.docDirty) {
      R.renderDocument(S.doc, S.base, S.objects);
      S.docDirty = false;
    }
    drawView();
    if (S.editing) positionEditor();
    $('zoomLabel').textContent = Math.round(V.z * dpr() * 100) + '%';
  }

  let checker = null;
  function checkerPattern() {
    if (!checker) {
      const c = makeCanvas(16, 16), x = c.getContext('2d');
      x.fillStyle = '#2b2f38'; x.fillRect(0, 0, 16, 16);
      x.fillStyle = '#353a45'; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8);
      checker = vctx.createPattern(c, 'repeat');
    }
    return checker;
  }

  const toScreen = (x, y) => ({ x: V.x + x * V.z, y: V.y + y * V.z });

  function resizeView() {
    const d = dpr(), w = view.clientWidth, h = view.clientHeight;
    if (view.width !== Math.round(w * d) || view.height !== Math.round(h * d)) {
      view.width = Math.round(w * d);
      view.height = Math.round(h * d);
    }
  }

  function drawView() {
    resizeView();
    const d = dpr(), w = view.clientWidth, h = view.clientHeight;
    vctx.setTransform(d, 0, 0, d, 0, 0);
    vctx.clearRect(0, 0, w, h);
    const z = V.z, x0 = Math.round(V.x * d) / d, y0 = Math.round(V.y * d) / d;
    const dw = S.docW * z, dh = S.docH * z;
    vctx.save();
    vctx.shadowColor = 'rgba(0,0,0,.6)';
    vctx.shadowBlur = 26;
    vctx.fillStyle = '#000';
    vctx.fillRect(x0, y0, dw, dh);
    vctx.restore();
    vctx.save();
    vctx.beginPath(); vctx.rect(x0, y0, dw, dh); vctx.clip();
    vctx.fillStyle = checkerPattern();
    vctx.fillRect(x0, y0, dw, dh);
    vctx.imageSmoothingEnabled = z * d < 1;
    vctx.imageSmoothingQuality = 'high';
    vctx.drawImage(S.doc, x0, y0, dw, dh);
    vctx.restore();

    if (S.tool === 'crop' && S.crop) drawCropOverlay(w, h);
    else if (S.tool === 'canvas' && S.cv) drawCanvasPreview();
    else drawSelectionOverlay();
    if (S.drag && S.drag.mode === 'marquee') {
      const r = S.drag.rect, a = toScreen(r.x, r.y);
      vctx.fillStyle = 'rgba(79,140,255,.14)';
      vctx.strokeStyle = '#4f8cff';
      vctx.lineWidth = 1;
      vctx.fillRect(a.x, a.y, r.w * z, r.h * z);
      vctx.strokeRect(a.x + .5, a.y + .5, r.w * z, r.h * z);
    }
    if (S.tool === 'eyedropper') drawLoupe(w, h);
  }

  function handleSpecs(o) {
    if (o.type === 'arrow' || o.type === 'line') {
      return [{ kind: 'end', i: 1, x: o.x1, y: o.y1 }, { kind: 'end', i: 2, x: o.x2, y: o.y2 }];
    }
    const b = M.getBounds(o), pts = G.handlePoints(b);
    const names = o.type === 'text' ? ['w', 'e'] : G.HANDLES;
    const list = names.map(n => ({ kind: 'box', name: n, x: pts[n].x, y: pts[n].y }));
    if (o.type === 'callout') list.unshift({ kind: 'tail', x: o.tx, y: o.ty });
    return list;
  }

  function drawSelectionOverlay() {
    const sel = selObjs();
    if (!sel.length) return;
    const z = V.z;
    vctx.save();
    vctx.lineWidth = 1;
    vctx.strokeStyle = '#4f8cff';
    for (const o of sel) {
      if (o.type === 'arrow' || o.type === 'line') continue;
      const b = M.getBounds(o), a = toScreen(b.x, b.y);
      vctx.setLineDash(sel.length > 1 ? [4, 3] : []);
      vctx.strokeRect(a.x - .5, a.y - .5, b.w * z + 1, b.h * z + 1);
      if (o.type === 'callout') {
        const t = M.calloutTailOf(o);
        if (t) { const s = toScreen(o.tx, o.ty); vctx.setLineDash([3, 3]); vctx.beginPath(); vctx.moveTo(s.x, s.y); const m = toScreen((t.p1.x + t.p2.x) / 2, (t.p1.y + t.p2.y) / 2); vctx.lineTo(m.x, m.y); vctx.stroke(); }
      }
    }
    vctx.setLineDash([]);
    if (sel.length === 1 && !S.editing) {
      for (const hnd of handleSpecs(sel[0])) {
        const s = toScreen(hnd.x, hnd.y);
        vctx.fillStyle = hnd.kind === 'tail' ? '#4f8cff' : '#ffffff';
        vctx.strokeStyle = '#4f8cff';
        vctx.lineWidth = 1.5;
        vctx.beginPath();
        if (hnd.kind === 'box') vctx.rect(s.x - 4.5, s.y - 4.5, 9, 9);
        else vctx.arc(s.x, s.y, 5.5, 0, Math.PI * 2);
        vctx.fill(); vctx.stroke();
      }
    }
    vctx.restore();
  }

  function drawCropOverlay(w, h) {
    const c = S.crop.rect, z = V.z, a = toScreen(c.x, c.y), cw = c.w * z, ch = c.h * z;
    vctx.save();
    vctx.fillStyle = 'rgba(8,10,14,.62)';
    vctx.beginPath();
    vctx.rect(0, 0, w, h);
    vctx.rect(a.x, a.y, cw, ch);
    vctx.fill('evenodd');
    vctx.strokeStyle = 'rgba(255,255,255,.45)';
    vctx.lineWidth = 1;
    vctx.beginPath();
    for (let i = 1; i < 3; i++) {
      vctx.moveTo(a.x + cw * i / 3, a.y); vctx.lineTo(a.x + cw * i / 3, a.y + ch);
      vctx.moveTo(a.x, a.y + ch * i / 3); vctx.lineTo(a.x + cw, a.y + ch * i / 3);
    }
    vctx.stroke();
    vctx.strokeStyle = '#4f8cff';
    vctx.lineWidth = 1.5;
    vctx.strokeRect(a.x, a.y, cw, ch);
    const pts = G.handlePoints({ x: a.x, y: a.y, w: cw, h: ch });
    vctx.fillStyle = '#fff';
    for (const n of G.HANDLES) { vctx.fillRect(pts[n].x - 4.5, pts[n].y - 4.5, 9, 9); vctx.strokeRect(pts[n].x - 4.5, pts[n].y - 4.5, 9, 9); }
    const label = Math.round(c.w) + ' \u00d7 ' + Math.round(c.h);
    vctx.font = '12px "Segoe UI", sans-serif';
    const tw = vctx.measureText(label).width + 14;
    const ly = a.y + ch + 8 + 20 > h ? a.y + ch - 28 : a.y + ch + 8;
    vctx.fillStyle = 'rgba(20,22,28,.92)';
    vctx.fillRect(a.x, ly, tw, 20);
    vctx.fillStyle = '#fff';
    vctx.textBaseline = 'middle';
    vctx.fillText(label, a.x + 7, ly + 10.5);
    vctx.restore();
  }

  function cvGeometry() {
    const cv = S.cv;
    return { ox: Math.round((cv.w - S.docW) * cv.ax), oy: Math.round((cv.h - S.docH) * cv.ay) };
  }

  function drawCanvasPreview() {
    if (S.cv.mode !== 'extend') return;
    const g = cvGeometry(), a = toScreen(g.ox, g.oy);
    vctx.save();
    vctx.strokeStyle = '#ffb020';
    vctx.setLineDash([6, 4]);
    vctx.lineWidth = 1.5;
    vctx.strokeRect(a.x, a.y, S.cv.w * V.z, S.cv.h * V.z);
    vctx.restore();
  }

  function drawLoupe(w, h) {
    const p = S.hover;
    if (!p || p.x < 0 || p.y < 0 || p.x >= S.docW || p.y >= S.docH) return;
    const px = Math.floor(p.x), py = Math.floor(p.y), n = 11, cell = 10, size = n * cell;
    const s = toScreen(p.x, p.y);
    let lx = s.x + 22, ly = s.y + 22;
    if (lx + size > w) lx = s.x - 22 - size;
    if (ly + size + 24 > h) ly = s.y - 22 - size - 24;
    vctx.save();
    vctx.beginPath();
    vctx.arc(lx + size / 2, ly + size / 2, size / 2, 0, Math.PI * 2);
    vctx.clip();
    vctx.imageSmoothingEnabled = false;
    vctx.fillStyle = '#111';
    vctx.fillRect(lx, ly, size, size);
    vctx.drawImage(S.doc, px - 5, py - 5, n, n, lx, ly, size, size);
    vctx.restore();
    vctx.save();
    vctx.strokeStyle = '#fff'; vctx.lineWidth = 3;
    vctx.beginPath(); vctx.arc(lx + size / 2, ly + size / 2, size / 2, 0, Math.PI * 2); vctx.stroke();
    vctx.strokeStyle = '#000'; vctx.lineWidth = 1;
    vctx.strokeRect(lx + 5 * cell + .5, ly + 5 * cell + .5, cell, cell);
    if (S.hoverColor) {
      vctx.font = '12px Consolas, monospace';
      const label = S.hoverColor.toUpperCase();
      vctx.fillStyle = 'rgba(20,22,28,.92)';
      vctx.fillRect(lx + size / 2 - 40, ly + size + 4, 80, 20);
      vctx.fillStyle = S.hoverColor;
      vctx.fillRect(lx + size / 2 - 36, ly + size + 8, 12, 12);
      vctx.fillStyle = '#fff';
      vctx.textBaseline = 'middle';
      vctx.fillText(label, lx + size / 2 - 20, ly + size + 14.5);
    }
    vctx.restore();
  }

  // ---------- view (zoom / pan) ----------
  function clampPan() {
    const w = view.clientWidth, h = view.clientHeight, dw = S.docW * V.z, dh = S.docH * V.z, m = 80;
    V.x = dw + m * 2 <= w ? (w - dw) / 2 : G.clamp(V.x, w - dw - m, m);
    V.y = dh + m * 2 <= h ? (h - dh) / 2 : G.clamp(V.y, h - dh - m, m);
  }

  function fit() {
    const w = view.clientWidth, h = view.clientHeight;
    if (!w || !h || !S.docW) return;
    V.z = Math.max(0.02, Math.min((w - 48) / S.docW, (h - 48) / S.docH, 1 / dpr()));
    V.x = (w - S.docW * V.z) / 2;
    V.y = (h - S.docH * V.z) / 2;
    S.fitMode = true;
    invalidate();
  }

  function setZoom(z, cx, cy) {
    const nz = G.clamp(z, 0.02, 32);
    const w = view.clientWidth, h = view.clientHeight;
    const ax = cx === undefined ? w / 2 : cx, ay = cy === undefined ? h / 2 : cy;
    V.x = ax - (ax - V.x) * (nz / V.z);
    V.y = ay - (ay - V.y) * (nz / V.z);
    V.z = nz;
    S.fitMode = false;
    clampPan();
    invalidate();
  }

  const zoomBy = f => setZoom(V.z * f);
  const actualSize = () => setZoom(1 / dpr());

  // ---------- panel ----------
  const PCT = v => Math.round(v * 100) + '%';
  const FIELD_META = {
    stroke: { type: 'color', label: 'Stroke' },
    fill: { type: 'color', label: 'Fill', none: true },
    color: { type: 'color', label: 'Text colour' },
    hlColor: { type: 'color', label: 'Colour' },
    width: { type: 'range', label: 'Width', min: 0, max: 60, step: 1 },
    opacity: { type: 'range', label: 'Opacity', min: 0.05, max: 1, step: 0.05, scale: 100, fmt: PCT },
    radius: { type: 'range', label: 'Corner radius', min: 0, max: 80, step: 1 },
    arrowStyle: {
      type: 'select', label: 'Arrow style',
      options: [{ v: 'classic', l: 'Classic' }, { v: 'open', l: 'Open' }, { v: 'tapered', l: 'Tapered' }, { v: 'double', l: 'Double-ended' }, { v: 'dot', l: 'Dot start' }]
    },
    dash: { type: 'select', label: 'Line style', options: [{ v: 'solid', l: 'Solid' }, { v: 'dashed', l: 'Dashed' }, { v: 'dotted', l: 'Dotted' }] },
    font: { type: 'select', label: 'Font', options: FONTS.map(f => ({ v: f, l: f })) },
    size: { type: 'range', label: 'Font size', min: 8, max: 240, step: 1 },
    align: {
      type: 'seg', label: 'Align',
      options: [{ v: 'left', l: 'Left' }, { v: 'center', l: 'Center' }, { v: 'right', l: 'Right' }]
    },
    mode: { type: 'seg', label: 'Effect', options: [{ v: 'pixelate', l: 'Pixelate' }, { v: 'blur', l: 'Blur' }] },
    amount: { type: 'range', label: 'Strength', min: 2, max: 60, step: 1 },
    shape: { type: 'seg', label: 'Shape', options: [{ v: 'rect', l: 'Rectangle' }, { v: 'ellipse', l: 'Ellipse' }] },
    zoom: { type: 'range', label: 'Magnification', min: 1.5, max: 6, step: 0.25, fmt: v => v + '\u00d7' },
    glyph: { type: 'glyphs', label: 'Stamp' },
    number: { type: 'number', label: 'Number', min: 1, max: 999, step: 1 }
  };
  const FIELD_OVERRIDES = {
    callout: { stroke: { label: 'Border' }, width: { label: 'Border width', min: 0, max: 20 }, fill: { label: 'Fill', none: false } },
    text: { fill: { label: 'Background' } },
    step: {
      fill: { label: 'Badge colour', none: false }, color: { label: 'Number colour' }, stroke: { label: 'Outline' },
      width: { label: 'Outline width', max: 12 }, size: { label: 'Size', min: 16, max: 200 },
      shape: { options: [{ v: 'circle', l: 'Circle' }, { v: 'square', l: 'Square' }] }
    },
    stamp: { size: { label: 'Size', min: 16, max: 400 } },
    spotlight: { opacity: { label: 'Dim outside', min: 0.1, max: 0.95 } },
    magnify: {
      width: { label: 'Border width', max: 24 }, stroke: { label: 'Border' },
      shape: { options: [{ v: 'circle', l: 'Circle' }, { v: 'rect', l: 'Rectangle' }] }
    },
    hlpen: { width: { label: 'Brush size', min: 4, max: 100 } },
    pen: { width: { min: 1, max: 40 } },
    line: { width: { min: 1, max: 40 } },
    arrow: { width: { min: 1, max: 40 } },
    highlight: { opacity: { min: 0.1 } }
  };
  const TOGGLES = {
    bold: { label: 'B', html: '<b>B</b>', title: 'Bold' },
    italic: { label: 'I', html: '<i>I</i>', title: 'Italic' },
    shadow: { label: 'Shadow', title: 'Drop shadow' }
  };

  function fieldFor(key, src, styleKey) {
    const meta = TOGGLES[key] ? { type: 'toggle' } : FIELD_META[key];
    const over = (FIELD_OVERRIDES[styleKey] || {})[key] || {};
    const f = Object.assign({ key, value: M.getProp(src, key) }, meta, TOGGLES[key] || {}, over);
    if (key === 'amount') f.label = src.mode === 'blur' ? 'Blur radius' : 'Block size';
    if (f.type === 'color') {
      f.pick = () => startPick(key);
      f.memory = f.value && f.value !== 'transparent' ? f.value : undefined;
    }
    f.refresh = refreshPanel;
    f.onChange = (v, c) => applyProp(key, v, c);
    return f;
  }

  function startPick(prop) {
    S.pickProp = prop;
    setTool('eyedropper');
  }

  function buildToolPanelBlocks(styleKey, src) {
    const blocks = [];
    let toggles = [];
    const flush = () => { if (toggles.length) { blocks.push({ kind: 'inline', fields: toggles }); toggles = []; } };
    for (const key of M.PANEL[styleKey]) {
      const f = fieldFor(key, src, styleKey);
      if (f.type === 'toggle') toggles.push(f);
      else if (f.type === 'number') { flush(); blocks.push({ kind: 'inline', fields: [f] }); } else { flush(); blocks.push({ kind: 'field', field: f }); }
    }
    flush();
    return blocks;
  }

  function actionButtons() {
    return {
      kind: 'actions',
      buttons: [
        { icon: ICONS.duplicate, title: 'Duplicate (Ctrl+D)', onClick: duplicateSelection },
        { icon: ICONS.trash, title: 'Delete (Del)', onClick: deleteSelection },
        { icon: ICONS.front, title: 'Bring to front (Ctrl+Shift+])', onClick: () => arrange('front') },
        { icon: ICONS.forward, title: 'Bring forward (Ctrl+])', onClick: () => arrange('forward') },
        { icon: ICONS.backward, title: 'Send backward (Ctrl+[)', onClick: () => arrange('backward') },
        { icon: ICONS.back, title: 'Send to back (Ctrl+Shift+[)', onClick: () => arrange('back') }
      ]
    };
  }

  const KEYS_HELP = '<div class="hint-keys"><b>A L R O</b><span>arrow, line, rect, ellipse</span><b>T C N E</b><span>text, callout, step, stamp</span>' +
    '<b>H P B S M</b><span>highlight, pen, blur, spotlight, magnify</span><b>I X Z</b><span>eyedropper, crop, canvas size</span>' +
    '<b>G</b><span>pan / move (hand tool)</span><b>Space+drag</b><span>pan</span><b>Wheel</b><span>zoom</span><b>Ctrl+0 / 1</b><span>fit / 100%</span><b>Ctrl+D</b><span>duplicate</span></div>';

  function panelSpec() {
    const sel = selObjs();
    if (S.tool === 'crop' && S.crop) return cropPanel();
    if (S.tool === 'canvas' && S.cv) return canvasPanel();
    if (S.tool === 'eyedropper') {
      return {
        title: 'Eyedropper', subtitle: 'Pick a colour from the image',
        blocks: [
          { kind: 'field', field: { type: 'seg', label: 'Apply to', value: S.pickProp, options: [{ v: 'stroke', l: 'Stroke' }, { v: 'fill', l: 'Fill' }, { v: 'color', l: 'Text' }, { v: 'hlColor', l: 'Marker' }], onChange: v => { S.pickProp = v; }, refresh: refreshPanel } },
          { kind: 'note', html: 'Click on the image to pick a colour. <kbd>Esc</kbd> cancels. With nothing to apply to, the hex value is copied.' }
        ]
      };
    }
    if (sel.length) {
      const key = M.styleKeyOf(sel[0]);
      const title = (key === 'hlpen' ? 'Highlighter' : TOOL_LABEL[sel[0].type] || sel[0].type) + (sel.length > 1 ? ' (+' + (sel.length - 1) + ' more)' : '');
      const blocks = [actionButtons()];
      if (sel.length === 1 && M.PANEL[key]) blocks.push(...buildToolPanelBlocks(key, sel[0]));
      else if (sel.length > 1) blocks.push({ kind: 'note', html: sel.length + ' objects selected. Move them together, or edit shared properties by selecting one type.' });
      return { title, subtitle: 'Selected', blocks };
    }
    const key = toolStyleKey(S.tool);
    if (key) {
      const blocks = [];
      if (S.tool === 'highlight') {
        blocks.push({
          kind: 'field',
          field: {
            type: 'seg', label: 'Style', value: S.hlMode, options: [{ v: 'rect', l: 'Rectangle' }, { v: 'brush', l: 'Brush' }],
            onChange: v => { S.hlMode = v; }, refresh: refreshPanel
          }
        });
      }
      blocks.push(...buildToolPanelBlocks(key, S.styles[key]));
      blocks.push({ kind: 'note', html: TOOL_HINTS[S.tool] || '' });
      return { title: TOOL_LABEL[S.tool], subtitle: 'Tool properties', blocks };
    }
    return {
      title: 'Pan', subtitle: S.docW + ' \u00d7 ' + S.docH + ' px',
      blocks: [
        { kind: 'note', html: 'Drag the image up, down, left or right. <kbd>Wheel</kbd> zooms, <kbd>Shift</kbd>+wheel pans sideways. Click an annotation to select and move it; use handles to resize.' },
        { kind: 'section', text: 'Shortcuts' },
        { kind: 'note', html: KEYS_HELP }
      ]
    };
  }

  function refreshPanel() {
    P.render(panelEl, panelSpec());
  }

  // ---- crop panel ----
  const ratioOf = a => {
    if (a === 'free') return null;
    if (a === 'orig') return S.docW / S.docH;
    const [w, h] = a.split(':').map(Number);
    return w / h;
  };

  function cropPanel() {
    const c = S.crop;
    const num = (k, label, max) => ({
      type: 'number', key: 'crop-' + k, label, value: c.rect[k], min: 0, max, step: 1,
      onChange: v => cropSet(k, v)
    });
    return {
      title: 'Crop', subtitle: 'Drag the handles or draw a new area',
      blocks: [
        {
          kind: 'field',
          field: {
            type: 'select', label: 'Aspect', value: c.aspect, options: ASPECTS.map(a => ({ v: a[0], l: a[1] })),
            onChange: v => {
              c.aspect = v; c.ratio = ratioOf(v);
              if (c.ratio) c.rect = G.fitRatio(c.rect, c.ratio, { x: 0, y: 0, w: S.docW, h: S.docH });
              refreshPanel(); invalidate();
            }
          }
        },
        { kind: 'inline', fields: [num('x', 'X', S.docW), num('y', 'Y', S.docH)] },
        { kind: 'inline', fields: [num('w', 'Width', S.docW), num('h', 'Height', S.docH)] },
        {
          kind: 'buttons',
          buttons: [
            { label: 'Apply', primary: true, title: 'Apply crop (Enter)', onClick: applyCrop },
            { label: 'Reset', onClick: () => { S.crop.rect = { x: 0, y: 0, w: S.docW, h: S.docH }; refreshPanel(); invalidate(); } },
            { label: 'Cancel', title: 'Cancel (Esc)', onClick: () => setTool('pan') }
          ]
        },
        { kind: 'note', html: 'Rule-of-thirds guides help composition. <kbd>Enter</kbd> applies, <kbd>Esc</kbd> cancels.' }
      ]
    };
  }

  function cropSet(k, v) {
    const c = S.crop, r = Object.assign({}, c.rect);
    if (!isFinite(v)) return;
    r[k] = Math.round(v);
    if (c.ratio && k === 'w') r.h = r.w / c.ratio;
    if (c.ratio && k === 'h') r.w = r.h * c.ratio;
    r.w = Math.max(1, r.w); r.h = Math.max(1, r.h);
    c.rect = G.clampRectInside(r, { x: 0, y: 0, w: S.docW, h: S.docH });
    refreshPanel(); invalidate();
  }

  function updateCropInputs() {
    if (!S.crop) return;
    for (const k of ['x', 'y', 'w', 'h']) {
      const inp = panelEl.querySelector('input[data-key="crop-' + k + '"]');
      if (inp) inp.value = Math.round(S.crop.rect[k]);
    }
  }

  function applyCrop() {
    const c = S.crop.rect;
    const r = { x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.w), h: Math.round(c.h) };
    if (r.w < 1 || r.h < 1) return;
    if (r.x === 0 && r.y === 0 && r.w === S.docW && r.h === S.docH) { setTool('pan'); return; }
    doBaseOp({ op: 'crop', x: r.x, y: r.y, w: r.w, h: r.h });
    setTool('pan');
    toast('Cropped to ' + r.w + ' \u00d7 ' + r.h);
  }

  // ---- canvas size panel ----
  function canvasPanel() {
    const cv = S.cv;
    const setDim = (k, v) => {
      v = Math.max(1, Math.min(16000, Math.round(v) || 1));
      const ratio = S.docW / S.docH;
      cv[k] = v;
      if (cv.lock) { if (k === 'w') cv.h = Math.max(1, Math.round(v / ratio)); else cv.w = Math.max(1, Math.round(v * ratio)); }
      refreshPanel(); invalidate();
    };
    const blocks = [
      { kind: 'field', field: { type: 'seg', label: 'Mode', value: cv.mode, options: [{ v: 'extend', l: 'Extend canvas' }, { v: 'scale', l: 'Scale image' }], onChange: v => { cv.mode = v; }, refresh: () => { refreshPanel(); invalidate(); } } },
      { kind: 'inline', fields: [{ type: 'number', key: 'cv-w', label: 'Width', value: cv.w, min: 1, max: 16000, onChange: v => setDim('w', v) }, { type: 'number', key: 'cv-h', label: 'Height', value: cv.h, min: 1, max: 16000, onChange: v => setDim('h', v) }] },
      { kind: 'inline', fields: [{ type: 'toggle', key: 'lock', label: 'Lock aspect', title: 'Keep aspect ratio', html: ICONS.link + ' Lock aspect', value: cv.lock, onChange: v => { cv.lock = v; }, refresh: refreshPanel }] }
    ];
    if (cv.mode === 'extend') {
      const grid = document.createElement('div');
      const wrap = document.createElement('div');
      wrap.className = 'field';
      wrap.innerHTML = '<label style="color:var(--muted);font-size:12px;display:block;margin-bottom:4px">Anchor</label>';
      grid.className = 'anchor-grid';
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          const b = document.createElement('button');
          if (cv.ax === c / 2 && cv.ay === r / 2) b.className = 'active';
          b.title = 'Anchor image here';
          b.addEventListener('click', () => { cv.ax = c / 2; cv.ay = r / 2; refreshPanel(); invalidate(); });
          grid.appendChild(b);
        }
      }
      wrap.appendChild(grid);
      blocks.push({ kind: 'custom', node: wrap });
      blocks.push({
        kind: 'field',
        field: {
          type: 'color', label: 'Background', value: cv.transparent ? 'transparent' : cv.bg, none: true,
          onChange: (v) => { if (v === 'transparent') cv.transparent = true; else { cv.transparent = false; cv.bg = v; } }, refresh: refreshPanel
        }
      });
    }
    blocks.push({
      kind: 'buttons',
      buttons: [
        { label: 'Apply', primary: true, onClick: applyCanvas },
        { label: 'Reset', onClick: () => { S.cv = newCv(); refreshPanel(); invalidate(); } },
        { label: 'Cancel', onClick: () => setTool('pan') }
      ]
    });
    blocks.push({ kind: 'note', html: 'Extend adds (or trims) canvas around the image and keeps annotations aligned. Scale resizes the image and annotations.' });
    return { title: 'Canvas size', subtitle: 'Current: ' + S.docW + ' \u00d7 ' + S.docH + ' px', blocks };
  }

  const newCv = () => ({ mode: 'extend', w: S.docW, h: S.docH, lock: false, ax: 0.5, ay: 0.5, bg: '#ffffff', transparent: false });

  function applyCanvas() {
    const cv = S.cv;
    if (cv.w === S.docW && cv.h === S.docH) { setTool('pan'); return; }
    if (cv.mode === 'scale') doBaseOp({ op: 'scale', w: cv.w, h: cv.h });
    else { const g = cvGeometry(); doBaseOp({ op: 'extend', w: cv.w, h: cv.h, ox: g.ox, oy: g.oy, bg: cv.transparent ? null : cv.bg }); }
    setTool('pan');
    toast('Canvas is now ' + S.docW + ' \u00d7 ' + S.docH);
  }

  function doBaseOp(op) {
    const oldW = S.docW, oldH = S.docH;
    S.base = applyOp(S.base, op);
    S.baseOps.push(op);
    S.docW = S.base.width; S.docH = S.base.height;
    if (op.op === 'crop') M.translateAll(S.objects, -op.x, -op.y);
    else if (op.op === 'extend') M.translateAll(S.objects, op.ox, op.oy);
    else M.scaleAll(S.objects, op.w / oldW, op.h / oldH);
    S.sel = [];
    invalidate(true);
    commit();
    S.fitMode = true;
    fit();
  }

  // ---------- property application ----------
  // Applies a panel property to the selection (or the active tool style when nothing is selected).
  function applyProp(key, val, doCommit, toolOverride) {
    const sel = selObjs().filter(o => M.supportsProp(o, key));
    let applied = false;
    if (sel.length) {
      sel.forEach(o => {
        M.setProp(o, key, val);
        const st = S.styles[M.styleKeyOf(o)];
        if (st) M.setProp(st, key, val);
        if (key === 'size' && !(o.type === 'step' || o.type === 'stamp')) R.layoutText(o, true);
      });
      applied = true;
    } else {
      const sk = toolStyleKey(toolOverride || S.tool);
      if (sk && M.PANEL[sk].includes(key)) { M.setProp(S.styles[sk], key, val); applied = true; }
    }
    if (applied) {
      sel.forEach(o => { if (isTextual(o)) { R.layoutText(o, true); } });
      invalidate(true);
      if (S.editing) positionEditor();
      if (doCommit && sel.length) commit();
      else if (doCommit) refreshPanel();
    }
    return applied;
  }

  // ---------- text editing ----------
  function beginEdit(o, isNew) {
    if (S.editing) endEdit();
    S.sel = [o.id];
    S.editing = { obj: o, isNew: !!isNew, before: o.text };
    o._editing = true;
    ta.hidden = false;
    ta.value = o.text;
    R.layoutText(o, true);
    positionEditor();
    invalidate(true);
    refreshPanel();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  function positionEditor() {
    if (!S.editing) return;
    const o = S.editing.obj, z = V.z;
    R.layoutText(o);
    const pad = o._pad;
    ta.style.left = (V.x + o.x * z) + 'px';
    ta.style.top = (V.y + o.y * z) + 'px';
    ta.style.width = (o.w * z) + 'px';
    ta.style.height = (o.h * z) + 'px';
    ta.style.font = R.fontString(o, o.size * z);
    ta.style.lineHeight = (o._lineH * z) + 'px';
    ta.style.color = o.color;
    ta.style.caretColor = o.color;
    ta.style.textAlign = o.align;
    ta.style.background = o.type === 'text' && M.isFilled(o.fill) ? o.fill : 'transparent';
    ta.style.borderRadius = (pad * 0.6 * z) + 'px';
    const vert = o.type === 'callout' ? Math.max(0, (o.h - o._th) / 2) : pad;
    ta.style.padding = (vert * z) + 'px ' + (pad * z) + 'px';
    const fixed = !(o.type === 'text' && o.autoW);
    ta.style.whiteSpace = fixed ? 'pre-wrap' : 'pre';
    ta.setAttribute('wrap', fixed ? 'soft' : 'off');
  }

  function endEdit() {
    if (!S.editing) return;
    const { obj, isNew, before } = S.editing;
    S.editing = null;
    obj._editing = false;
    ta.hidden = true;
    ta.blur();
    const empty = !obj.text.trim();
    if (obj.type === 'text' && empty) {
      S.objects = S.objects.filter(o => o !== obj);
      S.sel = [];
      invalidate(true);
      if (!isNew) commit(); else refreshPanel();
      return;
    }
    invalidate(true);
    if (isNew || obj.text !== before) commit(); else refreshPanel();
  }

  ta.addEventListener('input', () => {
    if (!S.editing) return;
    S.editing.obj.text = ta.value;
    R.layoutText(S.editing.obj);
    positionEditor();
    invalidate(true);
  });
  ta.addEventListener('blur', () => { if (S.editing) endEdit(); });

  // ---------- object operations ----------
  function removeObjects(list) {
    const set = new Set(list);
    S.objects = S.objects.filter(o => !set.has(o));
    S.sel = S.sel.filter(id => objById(id));
    invalidate(true);
  }

  function deleteSelection() {
    const sel = selObjs();
    if (!sel.length) return;
    removeObjects(sel);
    commit();
  }

  function duplicateSelection() {
    const sel = selObjs();
    if (!sel.length) return;
    const off = Math.round(14 * S.uiScale);
    const copies = sel.map(o => M.duplicate(o, off, off));
    S.objects.push(...copies);
    S.sel = copies.map(c => c.id);
    invalidate(true);
    commit();
  }

  function arrange(mode) {
    if (!S.sel.length) return;
    S.objects = M.reorder(S.objects, S.sel, mode);
    invalidate(true);
    commit();
  }

  function selectAll() {
    S.sel = S.objects.map(o => o.id);
    invalidate();
    refreshPanel();
  }

  function nudge(dx, dy) {
    const sel = selObjs();
    if (!sel.length) return;
    sel.forEach(o => M.moveObject(o, dx, dy));
    invalidate(true);
    clearTimeout(commit.nudge);
    commit.nudge = setTimeout(commit, 450);
  }

  async function addImageObject(dataURL, at) {
    let img;
    try { img = await loadImg(dataURL); } catch (e) { toast('Could not read that image', true); return; }
    const scale = Math.min(1, (S.docW * 0.6) / img.naturalWidth, (S.docH * 0.6) / img.naturalHeight);
    const w = Math.max(8, Math.round(img.naturalWidth * scale)), h = Math.max(8, Math.round(img.naturalHeight * scale));
    const c = at || { x: S.docW / 2, y: S.docH / 2 };
    const o = M.createObject('image', { src: dataURL, x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2), w, h });
    S.objects.push(o);
    S.sel = [o.id];
    setToolQuiet('pan');
    invalidate(true);
    commit();
  }

  // ---------- tools ----------
  function updateToolbar() {
    document.querySelectorAll('#toolbar .tool').forEach(b => b.classList.toggle('active', b.dataset.tool === S.tool));
  }

  function setToolQuiet(t) {
    S.tool = t;
    updateToolbar();
  }

  function setTool(t) {
    if (S.tool === t) { refreshPanel(); return; }
    endEdit();
    if (t === 'eyedropper') S.prevTool = S.tool;
    S.tool = t;
    S.crop = null; S.cv = null; S.drag = null;
    if (t === 'crop') S.crop = { rect: { x: 0, y: 0, w: S.docW, h: S.docH }, aspect: 'free', ratio: null };
    if (t === 'canvas') S.cv = newCv();
    if (CREATE_TOOLS.includes(t)) {
      const key = toolStyleKey(t);
      if (selObjs().some(o => M.styleKeyOf(o) !== key)) S.sel = [];
    }
    if (t === 'crop' || t === 'canvas') S.sel = [];
    updateToolbar();
    updateCursor();
    refreshPanel();
    invalidate();
  }

  function buildToolbar() {
    const bar = $('toolbar');
    TOOLS.forEach(t => {
      if (t.sep) { const s = document.createElement('div'); s.className = 'tool-sep'; bar.appendChild(s); return; }
      const b = document.createElement('button');
      b.className = 'tool';
      b.dataset.tool = t.id;
      b.title = t.label + ' (' + t.key + ')';
      b.innerHTML = ICONS[t.id];
      b.addEventListener('click', () => setTool(t.id));
      bar.appendChild(b);
    });
  }

  function updateCursor(e) {
    let c = 'default';
    if (S.drag && S.drag.mode === 'pan') c = 'grabbing';
    else if (S.spaceDown || S.tool === 'pan') c = 'grab';
    else if (S.tool === 'text') c = 'text';
    else if (CREATE_TOOLS.includes(S.tool) || S.tool === 'eyedropper') c = 'crosshair';
    else if (S.tool === 'crop' && S.crop && e) c = cropCursor(toDoc(e));
    if ((S.tool === 'pan' || CREATE_TOOLS.includes(S.tool)) && e && !S.drag && !S.spaceDown) {
      const p = toDoc(e), tol = 7 / V.z;
      const h = hitHandleOfSelection(p, tol);
      if (h) c = h.kind === 'box' ? handleCursor(h.name) : (h.kind === 'tail' ? 'move' : 'crosshair');
      else if (S.tool === 'pan' && M.hitTestAll(S.objects, p.x, p.y, 6 / V.z) >= 0) c = 'move';
    }
    view.style.cursor = c;
  }

  const handleCursor = n => ({ nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' }[n]);

  function cropCursor(p) {
    const h = G.hitHandle(S.crop.rect, p.x, p.y, 8 / V.z);
    if (h) return handleCursor(h);
    return G.pointInRect(S.crop.rect, p.x, p.y) ? 'move' : 'crosshair';
  }

  // ---------- pointer interaction ----------
  function cssPoint(e) {
    const r = view.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function toDoc(e) {
    const c = cssPoint(e);
    return { x: (c.x - V.x) / V.z, y: (c.y - V.y) / V.z };
  }

  function hitHandleOfSelection(p, tol) {
    const sel = selObjs();
    if (sel.length !== 1 || S.editing) return null;
    const specs = handleSpecs(sel[0]);
    let best = null, bd = Infinity;
    for (const h of specs) {
      const d = Math.max(Math.abs(h.x - p.x), Math.abs(h.y - p.y));
      if (d <= tol && d < bd) { best = h; bd = d; }
    }
    return best;
  }

  function startMove(p) {
    const orig = new Map();
    selObjs().forEach(o => orig.set(o.id, M.clone(o)));
    S.drag = { mode: 'move', start: p, orig, changed: false };
  }

  function restoreFrom(o, orig) {
    Object.assign(o, M.clone(orig));
    if (isTextual(o)) o._sig = null;
  }

  function startHandleDrag(o, h) {
    const orig = M.clone(o);
    if (h.kind === 'end') S.drag = { mode: 'end', id: o.id, i: h.i, orig };
    else if (h.kind === 'tail') S.drag = { mode: 'tail', id: o.id, orig };
    else S.drag = { mode: 'resize', id: o.id, handle: h.name, orig, bounds: M.getBounds(orig) };
  }

  function newObjectStyle(key, type, extra) {
    return M.createObject(type, Object.assign({}, S.styles[key], extra));
  }

  function startCreate(p, e) {
    const t = S.tool, key = toolStyleKey(t), st = S.styles[key];
    if (t === 'text' || t === 'callout') {
      const i = M.hitTestAll(S.objects, p.x, p.y, 6 / V.z);
      if (i >= 0 && isTextual(S.objects[i])) { beginEdit(S.objects[i], false); return; }
    }
    let o;
    const box = { x: p.x, y: p.y, w: 0, h: 0 };
    switch (t) {
      case 'arrow': case 'line': o = newObjectStyle(key, t, { x1: p.x, y1: p.y, x2: p.x, y2: p.y }); break;
      case 'pen': o = newObjectStyle(key, 'pen', { points: [[p.x, p.y]] }); break;
      case 'highlight':
        o = S.hlMode === 'brush' ? newObjectStyle(key, 'pen', { points: [[p.x, p.y]] }) : newObjectStyle(key, 'highlight', box);
        break;
      case 'step': case 'stamp': {
        const sz = st.w;
        o = newObjectStyle(key, t, { x: p.x - sz / 2, y: p.y - sz / 2, w: sz, h: sz, number: M.nextStepNumber(S.objects) });
        S.objects.push(o); S.sel = [o.id];
        S.drag = { mode: 'place', obj: o, tool: t };
        invalidate(true); refreshPanel();
        return;
      }
      default: o = newObjectStyle(key, t, box);
    }
    S.objects.push(o);
    S.sel = [o.id];
    S.drag = { mode: 'create', obj: o, start: p, tool: t };
    invalidate(true);
    refreshPanel();
  }

  function updateCreate(p, e) {
    const d = S.drag, o = d.obj;
    if (o.type === 'arrow' || o.type === 'line') {
      [o.x2, o.y2] = e.shiftKey ? G.constrainAngle(o.x1, o.y1, p.x, p.y) : [p.x, p.y];
    } else if (o.type === 'pen') {
      const last = o.points[o.points.length - 1];
      if (Math.hypot(p.x - last[0], p.y - last[1]) >= 1.5 / V.z) o.points.push([p.x, p.y]);
    } else {
      let ex = p.x, ey = p.y;
      if (e.shiftKey && o.type !== 'text') [ex, ey] = G.constrainSquare(d.start.x, d.start.y, ex, ey);
      const r = G.rectFromPoints(d.start.x, d.start.y, ex, ey);
      Object.assign(o, r);
      if (o.type === 'callout') { o.tx = r.x + r.w * 0.3; o.ty = r.y + r.h + Math.max(30, r.h * 0.5); }
      if (o.type === 'text') o.autoW = false;
    }
    invalidate(true);
  }

  function finishCreate() {
    const d = S.drag, o = d.obj, k = S.uiScale;
    S.drag = null;
    const tiny = o.w < 4 && o.h < 4;
    switch (o.type) {
      case 'rect': case 'ellipse': case 'highlight': case 'blur': case 'spotlight':
        if (tiny) { removeObjects([o]); refreshPanel(); return; }
        break;
      case 'arrow': case 'line':
        if (Math.hypot(o.x2 - o.x1, o.y2 - o.y1) < 4) { removeObjects([o]); refreshPanel(); return; }
        break;
      case 'magnify':
        if (tiny) { const s = Math.round(180 * k); o.x = d.start.x - s / 2; o.y = d.start.y - s / 2; o.w = o.h = s; }
        break;
      case 'callout':
        if (tiny) { o.x = d.start.x; o.y = d.start.y; o.w = Math.round(200 * k); o.h = Math.round(90 * k); }
        o.tx = o.x + o.w * 0.3; o.ty = o.y + o.h + Math.max(30, o.h * 0.5);
        invalidate(true);
        beginEdit(o, true);
        return;
      case 'text':
        if (o.w < 8) { o.autoW = true; o.x = d.start.x; o.y = d.start.y; }
        beginEdit(o, true);
        return;
      default: break;
    }
    commit();
  }

  function onPointerDown(e) {
    if (!S.ready) return;
    if (S.editing) endEdit();
    const ae = document.activeElement;
    if (ae && ae !== document.body && ae !== ta && ae.blur) ae.blur();
    try { view.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
    let overObject = false;
    if (e.button === 0 && !S.spaceDown && S.tool === 'pan') {
      const q = toDoc(e);
      overObject = !!hitHandleOfSelection(q, 7 / V.z) || M.hitTestAll(S.objects, q.x, q.y, 6 / V.z) >= 0;
    }
    if (e.button === 1 || (e.button === 0 && (S.spaceDown || (S.tool === 'pan' && !overObject)))) {
      S.drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, vx: V.x, vy: V.y };
      updateCursor();
      return;
    }
    if (e.button !== 0) return;
    const p = toDoc(e), tol = 7 / V.z;

    if (S.tool === 'eyedropper') { pickColor(p, e.shiftKey); return; }
    if (S.tool === 'crop' && S.crop) { startCropDrag(p); return; }
    if (S.tool === 'canvas') return;

    const h = hitHandleOfSelection(p, tol);
    if (h) { startHandleDrag(selObjs()[0], h); return; }

    if (S.tool !== 'select' && S.tool !== 'pan') {
      if (e.detail === 2) {
        const i = M.hitTestAll(S.objects, p.x, p.y, 6 / V.z);
        if (i >= 0 && isTextual(S.objects[i])) { beginEdit(S.objects[i], false); return; }
      }
      startCreate(p, e);
      return;
    }

    const idx = M.hitTestAll(S.objects, p.x, p.y, 6 / V.z);
    if (idx >= 0) {
      const o = S.objects[idx];
      if (e.detail === 2 && isTextual(o)) { beginEdit(o, false); return; }
      if (e.shiftKey) {
        S.sel = S.sel.includes(o.id) ? S.sel.filter(id => id !== o.id) : S.sel.concat(o.id);
      } else if (!S.sel.includes(o.id)) S.sel = [o.id];
      startMove(p);
      refreshPanel();
    } else {
      const base = e.shiftKey ? S.sel.slice() : [];
      S.sel = base.slice();
      S.drag = { mode: 'marquee', start: p, rect: { x: p.x, y: p.y, w: 0, h: 0 }, base };
      refreshPanel();
    }
    invalidate();
  }

  function onPointerMove(e) {
    if (!S.ready) return;
    const p = toDoc(e);
    $('stCursor').textContent = Math.round(p.x) + ', ' + Math.round(p.y) + ' px';
    const d = S.drag;
    if (!d) {
      if (S.tool === 'eyedropper') hoverPick(p);
      updateCursor(e);
      return;
    }
    switch (d.mode) {
      case 'pan':
        V.x = d.vx + (e.clientX - d.sx);
        V.y = d.vy + (e.clientY - d.sy);
        S.fitMode = false;
        clampPan();
        invalidate();
        break;
      case 'move': {
        let dx = p.x - d.start.x, dy = p.y - d.start.y;
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        if (!d.changed && Math.hypot(dx, dy) * V.z < 2) break;
        d.changed = true;
        for (const o of selObjs()) { restoreFrom(o, d.orig.get(o.id)); M.moveObject(o, dx, dy); }
        invalidate(true);
        break;
      }
      case 'resize': {
        const o = objById(d.id), b = d.bounds;
        const lock = M.LOCK_ASPECT[o.type] || e.shiftKey;
        const ratio = lock && b.h > 0 && b.w > 0 ? b.w / b.h : null;
        const r = G.resizeRect(b, d.handle, p.x, p.y, { ratio });
        r.w = Math.max(2, r.w); r.h = Math.max(2, r.h);
        restoreFrom(o, d.orig);
        M.resizeObject(o, r);
        d.changed = true;
        invalidate(true);
        break;
      }
      case 'end': {
        const o = objById(d.id);
        const ax = d.i === 1 ? d.orig.x2 : d.orig.x1, ay = d.i === 1 ? d.orig.y2 : d.orig.y1;
        const [nx, ny] = e.shiftKey ? G.constrainAngle(ax, ay, p.x, p.y) : [p.x, p.y];
        if (d.i === 1) { o.x1 = nx; o.y1 = ny; } else { o.x2 = nx; o.y2 = ny; }
        d.changed = true;
        invalidate(true);
        break;
      }
      case 'tail': {
        const o = objById(d.id);
        o.tx = p.x; o.ty = p.y;
        d.changed = true;
        invalidate(true);
        break;
      }
      case 'create': updateCreate(p, e); break;
      case 'place': {
        const o = d.obj;
        o.x = p.x - o.w / 2; o.y = p.y - o.h / 2;
        invalidate(true);
        break;
      }
      case 'marquee': {
        d.rect = G.rectFromPoints(d.start.x, d.start.y, p.x, p.y);
        const hit = M.objectsInRect(S.objects, d.rect).map(o => o.id);
        S.sel = Array.from(new Set(d.base.concat(hit)));
        invalidate();
        break;
      }
      case 'crop-move': case 'crop-resize': case 'crop-new': updateCropDrag(p); break;
      default: break;
    }
  }

  function onPointerUp(e) {
    const d = S.drag;
    if (!d) return;
    try { view.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    S.drag = null;
    switch (d.mode) {
      case 'move': case 'resize': case 'end': case 'tail':
        if (d.changed) commit();
        break;
      case 'create': S.drag = d; finishCreate(); break;
      case 'place': commit(); break;
      case 'marquee': refreshPanel(); invalidate(); break;
      case 'crop-move': case 'crop-resize': case 'crop-new': updateCropInputs(); break;
      default: break;
    }
    updateCursor(e);
    invalidate();
  }

  // ---- crop drag ----
  function startCropDrag(p) {
    const c = S.crop.rect, h = G.hitHandle(c, p.x, p.y, 8 / V.z);
    const docR = { x: 0, y: 0, w: S.docW, h: S.docH };
    if (h) S.drag = { mode: 'crop-resize', handle: h, orig: Object.assign({}, c) };
    else if (G.pointInRect(c, p.x, p.y)) S.drag = { mode: 'crop-move', start: p, orig: Object.assign({}, c) };
    else {
      const sx = G.clamp(p.x, 0, docR.w), sy = G.clamp(p.y, 0, docR.h);
      S.drag = { mode: 'crop-new', start: { x: sx, y: sy } };
    }
  }

  function updateCropDrag(p) {
    const d = S.drag, c = S.crop, docR = { x: 0, y: 0, w: S.docW, h: S.docH };
    const cx = G.clamp(p.x, 0, docR.w), cy = G.clamp(p.y, 0, docR.h);
    let r;
    if (d.mode === 'crop-move') {
      r = G.clampRectInside({ x: d.orig.x + (p.x - d.start.x), y: d.orig.y + (p.y - d.start.y), w: d.orig.w, h: d.orig.h }, docR);
    } else if (d.mode === 'crop-resize') {
      r = G.resizeRect(d.orig, d.handle, cx, cy, { ratio: c.ratio });
    } else {
      r = G.resizeRect({ x: d.start.x, y: d.start.y, w: 0, h: 0 }, 'se', cx, cy, { ratio: c.ratio });
    }
    const inside = r.x >= -0.5 && r.y >= -0.5 && r.x + r.w <= docR.w + 0.5 && r.y + r.h <= docR.h + 0.5;
    if (inside && r.w >= 1 && r.h >= 1) { c.rect = r; updateCropInputs(); invalidate(); }
  }

  // ---- eyedropper ----
  function sampleAt(p) {
    const x = Math.floor(p.x), y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= S.docW || y >= S.docH) return null;
    const d = S.doc.getContext('2d').getImageData(x, y, 1, 1).data;
    return G.toHex(d[0], d[1], d[2]);
  }

  function hoverPick(p) {
    S.hover = p;
    S.hoverColor = sampleAt(p);
    invalidate();
  }

  function pickColor(p, shift) {
    const hex = sampleAt(p);
    if (!hex) return;
    const prop = shift && S.pickProp === 'stroke' ? 'fill' : S.pickProp;
    const back = S.prevTool || 'pan';
    S.tool = back;
    updateToolbar();
    const applied = applyProp(prop, hex, true, back);
    if (!applied) {
      try { navigator.clipboard.writeText(hex); } catch (e) { /* clipboard unavailable */ }
      toast('Picked ' + hex + ' (copied)');
    } else toast('Picked ' + hex);
    S.hover = null;
    refreshPanel();
    updateCursor();
    invalidate();
  }

  // ---------- keyboard ----------
  function isTyping(t) {
    const tag = t && t.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return tag === 'INPUT' && !['range', 'color', 'checkbox', 'button'].includes(t.type);
  }

  document.addEventListener('keydown', e => {
    const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (ctrl && k === 's') { e.preventDefault(); if (e.shiftKey) saveAs(); else save(); return; }
    if (isTyping(e.target)) {
      if (e.key === 'Escape') { if (e.target === ta) endEdit(); else e.target.blur(); }
      else if (e.target === ta && ctrl && e.key === 'Enter') endEdit();
      else if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.target.blur();
      return;
    }
    if (!S.ready) return;
    if (ctrl) {
      switch (k) {
        case 'z': e.preventDefault(); if (e.shiftKey) redo(); else undo(); break;
        case 'y': e.preventDefault(); redo(); break;
        case 'd': e.preventDefault(); duplicateSelection(); break;
        case 'a': e.preventDefault(); selectAll(); break;
        case 'c': if (!window.getSelection().toString()) { e.preventDefault(); copyImage(); } break;
        case '0': e.preventDefault(); fit(); break;
        case '1': e.preventDefault(); actualSize(); break;
        case '=': case '+': e.preventDefault(); zoomBy(1.25); break;
        case '-': e.preventDefault(); zoomBy(0.8); break;
        case ']': e.preventDefault(); arrange(e.shiftKey ? 'front' : 'forward'); break;
        case '[': e.preventDefault(); arrange(e.shiftKey ? 'back' : 'backward'); break;
        default: break;
      }
      return;
    }
    if (e.altKey) return;
    if (e.key === ' ') {
      e.preventDefault();
      if (!S.spaceDown) { S.spaceDown = true; updateCursor(); }
      return;
    }
    switch (e.key) {
      case 'Escape':
        if (S.drag && S.drag.mode === 'crop-new') { S.drag = null; }
        if (S.tool === 'eyedropper') { S.tool = S.prevTool; updateToolbar(); refreshPanel(); updateCursor(); invalidate(); }
        else if (S.tool === 'crop' || S.tool === 'canvas') setTool('pan');
        else if (S.sel.length) { S.sel = []; refreshPanel(); invalidate(); } else setTool('pan');
        return;
      case 'Enter':
        if (S.tool === 'crop') applyCrop();
        else if (S.tool === 'canvas') applyCanvas();
        else if (selObjs().length === 1 && isTextual(selObjs()[0])) { e.preventDefault(); beginEdit(selObjs()[0], false); }
        return;
      case 'Delete': case 'Backspace': e.preventDefault(); deleteSelection(); return;
      case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
        if (!S.sel.length) return;
        e.preventDefault();
        const st = e.shiftKey ? 10 : 1;
        nudge(e.key === 'ArrowLeft' ? -st : e.key === 'ArrowRight' ? st : 0, e.key === 'ArrowUp' ? -st : e.key === 'ArrowDown' ? st : 0);
        return;
      }
      default: break;
    }
    const tool = KEY_TO_TOOL[k];
    if (tool && !e.ctrlKey) { setTool(tool); }
  });

  document.addEventListener('keyup', e => {
    if (e.key === ' ' && S.spaceDown) { S.spaceDown = false; updateCursor(); }
  });

  view.addEventListener('pointerdown', onPointerDown);
  view.addEventListener('mousedown', e => e.preventDefault());
  view.addEventListener('pointermove', onPointerMove);
  view.addEventListener('pointerup', onPointerUp);
  view.addEventListener('pointercancel', onPointerUp);
  view.addEventListener('contextmenu', e => e.preventDefault());
  view.addEventListener('wheel', e => {
    e.preventDefault();
    const c = cssPoint(e);
    const dy = e.deltaY || e.deltaX;
    if (e.shiftKey && !e.ctrlKey) { V.x -= dy; S.fitMode = false; clampPan(); invalidate(); return; }
    setZoom(V.z * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), c.x, c.y);
  }, { passive: false });
  view.addEventListener('pointerleave', () => { if (S.tool === 'eyedropper') { S.hover = null; invalidate(); } });

  // drag & drop / paste of images
  document.addEventListener('dragover', e => { e.preventDefault(); });
  document.addEventListener('drop', e => {
    e.preventDefault();
    const f = Array.from(e.dataTransfer.files || []).find(x => x.type.startsWith('image/'));
    if (!f) return;
    const at = view.getBoundingClientRect();
    const p = { x: (e.clientX - at.left - V.x) / V.z, y: (e.clientY - at.top - V.y) / V.z };
    const fr = new FileReader();
    fr.onload = () => addImageObject(fr.result, p);
    fr.readAsDataURL(f);
  });
  document.addEventListener('paste', e => {
    if (isTyping(e.target)) return;
    const item = Array.from((e.clipboardData && e.clipboardData.items) || []).find(i => i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    const fr = new FileReader();
    fr.onload = () => addImageObject(fr.result, null);
    fr.readAsDataURL(item.getAsFile());
  });

  // ---------- save / export ----------
  // PNG bytes of the flattened document. Encoding happens off the UI thread, and bytes go over IPC without base64.
  async function flattenPng() {
    if (S.docDirty) { R.renderDocument(S.doc, S.base, S.objects); S.docDirty = false; }
    const blob = await new Promise((resolve, reject) => S.doc.toBlob(b => (b ? resolve(b) : reject(new Error('Could not encode the image'))), 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  }

  const annotations = () => M.serialize({ width: S.docW, height: S.docH, baseOps: S.baseOps, objects: S.objects });

  async function save(silent) {
    if (!S.ready || S.saving || S.deleting) return;
    endEdit();
    S.saving = true;
    try {
      const at = S.history.index;
      const notes = annotations();
      await api.saveImage(S.id, await flattenPng());
      await api.saveAnnotations(S.id, notes);
      if (S.history.index === at) S.history.markSaved(); // edits made while saving stay unsaved
      updateChrome();
      if (!silent) toast('Saved');
    } catch (err) {
      toast('Save failed: ' + (err && err.message ? err.message : err), true);
    } finally {
      S.saving = false;
    }
  }

  async function saveAs() {
    if (!S.ready) return;
    endEdit();
    try {
      const r = await api.saveAs(await flattenPng(), (S.name || 'image') + '.png');
      if (r && r.filePath) toast('Saved to ' + r.filePath);
    } catch (err) {
      toast('Save As failed: ' + (err && err.message ? err.message : err), true);
    }
  }

  async function copyImage() {
    if (!S.ready) return false;
    endEdit();
    try {
      if (!S.history.isDirty()) {
        await api.copySaved(S.id); // nothing changed since the last save: copy the saved file directly
      } else {
        if (S.docDirty) { R.renderDocument(S.doc, S.base, S.objects); S.docDirty = false; }
        const px = S.doc.getContext('2d').getImageData(0, 0, S.doc.width, S.doc.height);
        await api.copyPixels(px.width, px.height, new Uint8Array(px.data.buffer));
      }
      toast('Copied to clipboard');
      return true;
    } catch (err) {
      toast('Copy failed', true);
      return false;
    }
  }

  // Deletes the capture and closes the editor. With copyFirst the image (annotations included) goes to the clipboard
  // first and nothing is asked; a plain delete asks for confirmation (in main). Main closes the window.
  async function deleteCapture(copyFirst) {
    if (!S.ready || S.deleting) return;
    endEdit();
    if (copyFirst && !(await copyImage())) return;
    S.deleting = true; // no saving / autosave for a capture that is going away
    try {
      if (!(await api.deleteItem(S.id, { confirm: !copyFirst }))) S.deleting = false;
    } catch (err) {
      S.deleting = false;
      toast('Delete failed', true);
    }
  }

  function flatten() {
    if (S.docDirty) { R.renderDocument(S.doc, S.base, S.objects); S.docDirty = false; }
    return S.doc.toDataURL('image/png');
  }

  function autosaveBeforeUnload() {
    if (!S.ready || S.deleting || !S.history.isDirty()) return;
    try {
      endEdit();
      api.autosave(S.id, annotations(), flatten());
      S.history.markSaved();
    } catch (err) { /* window is closing */ }
  }

  window.addEventListener('beforeunload', autosaveBeforeUnload);
  window.addEventListener('blur', () => {
    if (S.ready && !S.deleting && S.history.isDirty()) save(true);
  });

  // ---------- chrome ----------
  function updateChrome() {
    $('btnUndo').disabled = !S.history || !S.history.canUndo;
    $('btnRedo').disabled = !S.history || !S.history.canRedo;
    const dirty = S.history && S.history.isDirty();
    $('stDirty').textContent = dirty ? 'Unsaved changes' : 'Saved';
    $('stSize').textContent = S.docW + ' \u00d7 ' + S.docH + ' px';
    document.title = (S.name || 'Editor') + (dirty ? ' \u2022' : '') + ' - SnipSnapStitch Editor';
  }

  function buildTopbar() {
    $('btnLibrary').innerHTML = ICONS.library + '<span>Library</span>';
    $('btnUndo').innerHTML = ICONS.undo;
    $('btnRedo').innerHTML = ICONS.redo;
    $('btnCopy').innerHTML = ICONS.copy + '<span>Copy</span>';
    $('btnSaveAs').innerHTML = ICONS.saveas + '<span>Save As</span>';
    $('btnSave').innerHTML = ICONS.save + '<span>Save</span>';
    $('btnDelete').innerHTML = ICONS.trash;
    $('btnCopyDelete').innerHTML = ICONS.copy + '<span>Copy &amp; Delete</span>';
    $('btnLibrary').addEventListener('click', () => api.openLibrary());
    $('btnUndo').addEventListener('click', undo);
    $('btnRedo').addEventListener('click', redo);
    $('btnCopy').addEventListener('click', copyImage);
    $('btnSave').addEventListener('click', () => save());
    $('btnSaveAs').addEventListener('click', saveAs);
    $('btnDelete').addEventListener('click', () => deleteCapture(false));
    $('btnCopyDelete').addEventListener('click', () => deleteCapture(true));
    $('btnZoomIn').addEventListener('click', () => zoomBy(1.25));
    $('btnZoomOut').addEventListener('click', () => zoomBy(0.8));
    $('btnFit').addEventListener('click', fit);
    $('btnActual').addEventListener('click', actualSize);
    // keep keyboard focus (and text editing) when clicking buttons
    document.addEventListener('mousedown', e => { if (e.target.closest && e.target.closest('button')) e.preventDefault(); });
  }

  // ---------- init ----------
  async function init() {
    buildTopbar();
    buildToolbar();
    const id = new URLSearchParams(location.search).get('id');
    S.id = id;
    try {
      S.item = await api.getItem(id);
      S.name = (S.item && S.item.name) || 'Untitled';
      $('itemName').textContent = S.name;
      $('itemName').title = S.name;

      let objects = [], ops = [], base = null;
      const saved = M.deserialize(await api.loadAnnotations(id).catch(() => null));
      if (saved) {
        try {
          base = imgToCanvas(await loadImg(await api.loadOriginal(id)));
          for (const op of saved.baseOps) base = applyOp(base, op);
          if (base.width === saved.width && base.height === saved.height) { objects = saved.objects; ops = saved.baseOps; } else base = null;
        } catch (err) { base = null; }
      }
      if (!base) base = imgToCanvas(await loadImg(await api.loadImage(id)));

      S.base = base; S.baseOps = ops; S.objects = objects;
      S.docW = base.width; S.docH = base.height;
      S.uiScale = G.clamp(Math.max(S.docW, S.docH) / 1600, 1, 2.5);
      initStyles();
      S.history = new RS.History(snapshot(), {
        limit: 100,
        equals: (a, b) => a.base === b.base && a.w === b.w && a.h === b.h && a.objects === b.objects
      });
      S.ready = true;
      $('loading').classList.add('hidden');
      fit();
      refreshPanel();
      updateChrome();
      updateToolbar();
      invalidate(true);
    } catch (err) {
      $('loading').textContent = 'Could not open this item: ' + (err && err.message ? err.message : err);
    }
  }

  new ResizeObserver(() => {
    if (!S.ready) return;
    if (S.fitMode) fit(); else { clampPan(); invalidate(); }
  }).observe(stage);

  init();
})();
