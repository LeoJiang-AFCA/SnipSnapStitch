/* Annotation object model: defaults, normalization, hit-testing, transforms, serialization (UMD). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./geometry'));
  } else {
    root.RS = root.RS || {};
    root.RS.model = factory(root.RS.geometry);
  }
})(typeof self !== 'undefined' ? self : this, function (G) {
  'use strict';

  const VERSION = 1;
  const BOX_TYPES = ['rect', 'ellipse', 'text', 'callout', 'step', 'highlight', 'blur', 'spotlight', 'magnify', 'stamp', 'image'];
  const TYPES = ['arrow', 'line', 'pen'].concat(BOX_TYPES);
  const LOCK_ASPECT = { step: true, stamp: true, image: true };
  const RED = '#ff3b30';
  const ACCENT = '#4f8cff';

  const BOX = { x: 0, y: 0, w: 0, h: 0 };
  const COMMON = { opacity: 1, shadow: false };
  const DEFAULTS = {
    arrow: Object.assign({ x1: 0, y1: 0, x2: 0, y2: 0, stroke: RED, width: 5, arrowStyle: 'classic' }, COMMON),
    line: Object.assign({ x1: 0, y1: 0, x2: 0, y2: 0, stroke: RED, width: 4, dash: 'solid' }, COMMON),
    pen: Object.assign({ points: [], stroke: RED, width: 4, blend: '', cap: 'round' }, COMMON),
    rect: Object.assign({}, BOX, { stroke: RED, fill: 'transparent', width: 4, radius: 0, dash: 'solid' }, COMMON),
    ellipse: Object.assign({}, BOX, { stroke: RED, fill: 'transparent', width: 4, dash: 'solid' }, COMMON),
    text: Object.assign({}, BOX, {
      text: '', autoW: true, color: RED, fill: 'transparent', font: 'Segoe UI', size: 32,
      bold: false, italic: false, align: 'left'
    }, COMMON),
    callout: Object.assign({}, BOX, {
      text: '', tx: 0, ty: 0, color: '#222222', fill: '#fffbe6', stroke: '#e0a800', width: 3, radius: 14,
      font: 'Segoe UI', size: 26, bold: false, italic: false, align: 'center'
    }, COMMON),
    step: Object.assign({}, BOX, {
      number: 1, fill: ACCENT, color: '#ffffff', stroke: '#ffffff', width: 3, font: 'Segoe UI', shape: 'circle'
    }, COMMON),
    highlight: Object.assign({}, BOX, { fill: '#ffe600', opacity: 0.55, shadow: false }),
    blur: Object.assign({}, BOX, { mode: 'blur', amount: 10 }, { opacity: 1, shadow: false }),
    spotlight: Object.assign({}, BOX, { shape: 'rect', opacity: 0.6, shadow: false }),
    magnify: Object.assign({}, BOX, { zoom: 2, shape: 'circle', stroke: '#ffffff', width: 4 }, { opacity: 1, shadow: true }),
    stamp: Object.assign({}, BOX, { glyph: '\u2705' }, COMMON),
    image: Object.assign({}, BOX, { src: '' }, COMMON)
  };

  // Properties shown in the panel (and settable) per style key.
  const PANEL = {
    arrow: ['stroke', 'width', 'arrowStyle', 'opacity', 'shadow'],
    line: ['stroke', 'width', 'dash', 'opacity', 'shadow'],
    rect: ['stroke', 'fill', 'width', 'radius', 'dash', 'opacity', 'shadow'],
    ellipse: ['stroke', 'fill', 'width', 'dash', 'opacity', 'shadow'],
    text: ['color', 'fill', 'font', 'size', 'bold', 'italic', 'align', 'opacity', 'shadow'],
    callout: ['color', 'fill', 'stroke', 'width', 'radius', 'font', 'size', 'bold', 'italic', 'align', 'opacity', 'shadow'],
    step: ['fill', 'color', 'stroke', 'size', 'number', 'shape', 'opacity', 'shadow'],
    highlight: ['hlColor', 'opacity'],
    hlpen: ['hlColor', 'width', 'opacity'],
    pen: ['stroke', 'width', 'opacity', 'shadow'],
    blur: ['mode', 'amount'],
    spotlight: ['shape', 'opacity'],
    magnify: ['zoom', 'shape', 'stroke', 'width', 'shadow'],
    stamp: ['glyph', 'size', 'opacity', 'shadow'],
    image: ['opacity', 'shadow']
  };

  let counter = 0;
  function uid() {
    counter += 1;
    return 'o' + Date.now().toString(36) + counter.toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function clone(v) {
    return JSON.parse(JSON.stringify(v, (k, val) => (k.charAt(0) === '_' ? undefined : val)));
  }

  function defaultsFor(type) {
    return clone(DEFAULTS[type]);
  }

  function createObject(type, props) {
    if (!DEFAULTS[type]) throw new Error('Unknown object type: ' + type);
    const o = Object.assign({ id: uid(), type }, defaultsFor(type), clone(props || {}));
    o.id = (props && props.id) || o.id;
    o.type = type;
    return o;
  }

  function isFilled(fill) {
    return !!fill && fill !== 'transparent' && fill !== 'none';
  }

  function isBox(o) { return BOX_TYPES.includes(o.type); }

  function styleKeyOf(o) {
    return o.type === 'pen' && o.blend ? 'hlpen' : o.type;
  }

  function finite(v, d) {
    return typeof v === 'number' && isFinite(v) ? v : d;
  }

  // Returns a sanitized object or null when `raw` isn't a usable annotation.
  function normalizeObject(raw) {
    if (!raw || typeof raw !== 'object' || !DEFAULTS[raw.type]) return null;
    const def = DEFAULTS[raw.type];
    const o = { id: typeof raw.id === 'string' && raw.id ? raw.id : uid(), type: raw.type };
    for (const key of Object.keys(def)) {
      const d = def[key], v = raw[key];
      if (key === 'points') {
        o.points = Array.isArray(v)
          ? v.filter(p => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1])).map(p => [+p[0], +p[1]])
          : [];
      } else if (typeof d === 'number') o[key] = finite(v, d);
      else if (typeof d === 'boolean') o[key] = typeof v === 'boolean' ? v : d;
      else o[key] = typeof v === 'string' ? v : d;
    }
    o.opacity = G.clamp(o.opacity, 0, 1);
    if ('width' in o) o.width = Math.max(0, o.width);
    if (o.type === 'image' && !/^data:image\//.test(o.src)) return null;
    if (o.type === 'callout' && raw.tx === undefined) { o.tx = o.x + o.w * 0.3; o.ty = o.y + o.h + 40; }
    return o;
  }

  function cloneObjects(list) {
    return list.map(clone);
  }

  const OP_KINDS = ['crop', 'extend', 'scale'];
  function validOp(op) {
    if (!op || !OP_KINDS.includes(op.op)) return false;
    const pos = v => typeof v === 'number' && isFinite(v) && v >= 1;
    const num = v => typeof v === 'number' && isFinite(v);
    if (op.op === 'crop') return num(op.x) && num(op.y) && pos(op.w) && pos(op.h);
    if (op.op === 'extend') return pos(op.w) && pos(op.h) && num(op.ox) && num(op.oy);
    return pos(op.w) && pos(op.h);
  }

  function serialize(doc) {
    return {
      version: VERSION,
      app: 'SnipSnapStitch',
      width: doc.width,
      height: doc.height,
      baseOps: clone(doc.baseOps || []),
      objects: cloneObjects(doc.objects || [])
    };
  }

  // Returns {width,height,baseOps,objects} or null for unusable input.
  function deserialize(json) {
    if (!json || typeof json !== 'object' || json.version !== VERSION) return null;
    const ops = Array.isArray(json.baseOps) ? json.baseOps : [];
    if (!ops.every(validOp)) return null;
    const objects = (Array.isArray(json.objects) ? json.objects : []).map(normalizeObject).filter(Boolean);
    return {
      width: finite(json.width, 0), height: finite(json.height, 0),
      baseOps: clone(ops), objects
    };
  }

  function getBounds(o) {
    if (o.type === 'arrow' || o.type === 'line') return G.rectFromPoints(o.x1, o.y1, o.x2, o.y2);
    if (o.type === 'pen') {
      if (!o.points.length) return { x: 0, y: 0, w: 0, h: 0 };
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (const p of o.points) {
        if (p[0] < x1) x1 = p[0]; if (p[0] > x2) x2 = p[0];
        if (p[1] < y1) y1 = p[1]; if (p[1] > y2) y2 = p[1];
      }
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
    return G.normRect(o);
  }

  function moveObject(o, dx, dy) {
    if (o.type === 'arrow' || o.type === 'line') { o.x1 += dx; o.y1 += dy; o.x2 += dx; o.y2 += dy; }
    else if (o.type === 'pen') o.points = o.points.map(p => [p[0] + dx, p[1] + dy]);
    else {
      o.x += dx; o.y += dy;
      if (o.type === 'callout') { o.tx += dx; o.ty += dy; }
    }
    return o;
  }

  function mapPoint(px, py, from, to) {
    const sx = from.w ? to.w / from.w : 1, sy = from.h ? to.h / from.h : 1;
    return [to.x + (px - from.x) * sx, to.y + (py - from.y) * sy];
  }

  // Fit the object to a new bounding rect.
  function resizeObject(o, rect) {
    const from = getBounds(o);
    if (o.type === 'arrow' || o.type === 'line') {
      [o.x1, o.y1] = mapPoint(o.x1, o.y1, from, rect);
      [o.x2, o.y2] = mapPoint(o.x2, o.y2, from, rect);
    } else if (o.type === 'pen') {
      o.points = o.points.map(p => mapPoint(p[0], p[1], from, rect));
    } else if (o.type === 'text') {
      o.x = rect.x; o.y = rect.y; o.w = rect.w; o.autoW = false;
    } else {
      o.x = rect.x; o.y = rect.y; o.w = rect.w; o.h = rect.h;
    }
    return o;
  }

  // Scale all coordinates and size-like properties (used by canvas "scale image").
  function scaleObject(o, sx, sy) {
    const k = (Math.abs(sx) + Math.abs(sy)) / 2;
    if (o.type === 'arrow' || o.type === 'line') {
      o.x1 *= sx; o.y1 *= sy; o.x2 *= sx; o.y2 *= sy;
    } else if (o.type === 'pen') {
      o.points = o.points.map(p => [p[0] * sx, p[1] * sy]);
    } else {
      o.x *= sx; o.y *= sy; o.w *= sx; o.h *= sy;
      if (o.type === 'callout') { o.tx *= sx; o.ty *= sy; }
    }
    if ('width' in o) o.width *= k;
    if ('radius' in o) o.radius *= k;
    if ('amount' in o && o.type === 'blur') o.amount = Math.max(1, o.amount * k);
    if (o.type === 'text' || o.type === 'callout') o.size = Math.max(1, o.size * k);
    return o;
  }

  function translateAll(objects, dx, dy) {
    objects.forEach(o => moveObject(o, dx, dy));
    return objects;
  }

  function scaleAll(objects, sx, sy) {
    objects.forEach(o => scaleObject(o, sx, sy));
    return objects;
  }

  function calloutTailOf(o) {
    return G.calloutTail(G.normRect(o), o.tx, o.ty, { radius: o.radius, halfBase: Math.max(8, Math.min(o.w, o.h) * 0.16) });
  }

  function hitTest(o, x, y, tol) {
    const t = tol || 0;
    switch (o.type) {
      case 'arrow':
      case 'line': {
        const extra = o.type === 'arrow' ? o.width * 1.5 : 0;
        return G.distToSegment(x, y, o.x1, o.y1, o.x2, o.y2) <= t + Math.max(o.width / 2, 2) + extra;
      }
      case 'pen':
        return G.distToPolyline(o.points, x, y) <= t + Math.max(o.width / 2, 2);
      case 'rect': {
        const r = G.normRect(o), reach = t + o.width / 2;
        if (isFilled(o.fill)) return G.pointInRect(r, x, y, reach);
        return G.pointInRect(r, x, y, reach) && !G.pointInRect(G.inflate(r, -reach), x, y, 0);
      }
      case 'ellipse': {
        const r = G.normRect(o), reach = t + o.width / 2;
        if (isFilled(o.fill)) return G.pointInEllipse(G.inflate(r, reach), x, y);
        return G.ellipseBorderDist(r, x, y) <= reach;
      }
      case 'callout': {
        if (G.pointInRect(G.normRect(o), x, y, t)) return true;
        const tail = calloutTailOf(o);
        return !!tail && G.pointInTriangle(x, y, tail.p1, tail.tip, tail.p2);
      }
      case 'spotlight':
        return o.shape === 'ellipse' ? G.pointInEllipse(G.inflate(G.normRect(o), t), x, y) : G.pointInRect(G.normRect(o), x, y, t);
      default:
        return G.pointInRect(G.normRect(o), x, y, t);
    }
  }

  // Index of the topmost hit object, or -1.
  function hitTestAll(objects, x, y, tol) {
    for (let i = objects.length - 1; i >= 0; i--) {
      if (hitTest(objects[i], x, y, tol)) return i;
    }
    return -1;
  }

  function objectsInRect(objects, rect) {
    return objects.filter(o => G.rectsIntersect(getBounds(o), rect));
  }

  function duplicate(o, dx, dy) {
    const c = clone(o);
    c.id = uid();
    return moveObject(c, dx || 0, dy || 0);
  }

  // mode: front | back | forward | backward. Returns a new array.
  function reorder(objects, ids, mode) {
    const sel = new Set(ids);
    const a = objects.slice();
    if (mode === 'front') return a.filter(o => !sel.has(o.id)).concat(a.filter(o => sel.has(o.id)));
    if (mode === 'back') return a.filter(o => sel.has(o.id)).concat(a.filter(o => !sel.has(o.id)));
    if (mode === 'forward') {
      for (let i = a.length - 2; i >= 0; i--) {
        if (sel.has(a[i].id) && !sel.has(a[i + 1].id)) { const t = a[i]; a[i] = a[i + 1]; a[i + 1] = t; }
      }
    } else if (mode === 'backward') {
      for (let i = 1; i < a.length; i++) {
        if (sel.has(a[i].id) && !sel.has(a[i - 1].id)) { const t = a[i]; a[i] = a[i - 1]; a[i - 1] = t; }
      }
    }
    return a;
  }

  function nextStepNumber(objects) {
    let max = 0;
    for (const o of objects) if (o.type === 'step' && o.number > max) max = o.number;
    return max + 1;
  }

  function supportsProp(o, key) {
    return (PANEL[styleKeyOf(o)] || []).includes(key);
  }

  function getProp(o, key) {
    if (key === 'hlColor') return o.type === 'highlight' ? o.fill : o.stroke;
    if (key === 'size' && (o.type === 'step' || o.type === 'stamp')) return o.w;
    return o[key];
  }

  function setProp(o, key, value) {
    if (key === 'hlColor') {
      if (o.type === 'highlight') o.fill = value; else o.stroke = value;
    } else if (key === 'size' && (o.type === 'step' || o.type === 'stamp')) {
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
      o.w = o.h = value; o.x = cx - value / 2; o.y = cy - value / 2;
    } else {
      o[key] = value;
    }
    return o;
  }

  return {
    VERSION, TYPES, BOX_TYPES, LOCK_ASPECT, DEFAULTS, PANEL, RED, ACCENT,
    uid, clone, cloneObjects, defaultsFor, createObject, isFilled, isBox, styleKeyOf,
    normalizeObject, validOp, serialize, deserialize, getBounds, moveObject, resizeObject,
    scaleObject, translateAll, scaleAll, calloutTailOf, hitTest, hitTestAll, objectsInRect,
    duplicate, reorder, nextStepNumber, supportsProp, getProp, setProp
  };
});
