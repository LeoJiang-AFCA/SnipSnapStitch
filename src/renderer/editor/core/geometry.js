/* Pure geometry helpers (UMD: browser <script> => window.RS.geometry, node => require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.RS = root.RS || {};
    root.RS.geometry = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function normRect(r) {
    let { x, y, w, h } = r;
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    return { x, y, w, h };
  }

  function rectFromPoints(x1, y1, x2, y2) {
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  }

  function inflate(r, d) {
    return { x: r.x - d, y: r.y - d, w: r.w + d * 2, h: r.h + d * 2 };
  }

  function pointInRect(r, x, y, pad) {
    const d = pad || 0;
    return x >= r.x - d && x <= r.x + r.w + d && y >= r.y - d && y <= r.y + r.h + d;
  }

  function rectsIntersect(a, b) {
    return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
  }

  function unionRects(list) {
    if (!list.length) return { x: 0, y: 0, w: 0, h: 0 };
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const r of list) {
      x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y);
      x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h);
    }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  function distToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    let t = l2 === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / l2;
    t = clamp(t, 0, 1);
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function distToPolyline(pts, px, py) {
    if (!pts.length) return Infinity;
    if (pts.length === 1) return Math.hypot(px - pts[0][0], py - pts[0][1]);
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      best = Math.min(best, distToSegment(px, py, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
    }
    return best;
  }

  function pointInEllipse(r, x, y) {
    const rx = r.w / 2, ry = r.h / 2;
    if (rx <= 0 || ry <= 0) return false;
    const dx = (x - (r.x + rx)) / rx, dy = (y - (r.y + ry)) / ry;
    return dx * dx + dy * dy <= 1;
  }

  // Approximate distance from a point to the ellipse outline.
  function ellipseBorderDist(r, x, y) {
    const rx = r.w / 2, ry = r.h / 2;
    if (rx <= 0 || ry <= 0) return Infinity;
    const d = Math.hypot((x - (r.x + rx)) / rx, (y - (r.y + ry)) / ry);
    return Math.abs(d - 1) * Math.min(rx, ry);
  }

  function pointInTriangle(px, py, a, b, c) {
    const sign = (x1, y1, x2, y2, x3, y3) => (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
    const d_1 = sign(px, py, a.x, a.y, b.x, b.y);
    const d_2 = sign(px, py, b.x, b.y, c.x, c.y);
    const d_3 = sign(px, py, c.x, c.y, a.x, a.y);
    const neg = d_1 < 0 || d_2 < 0 || d_3 < 0;
    const pos = d_1 > 0 || d_2 > 0 || d_3 > 0;
    return !(neg && pos);
  }

  // Snap the end point so the segment angle is a multiple of `step` radians.
  function constrainAngle(x1, y1, x2, y2, step) {
    const st = step || Math.PI / 4;
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len === 0) return [x2, y2];
    const a = Math.round(Math.atan2(dy, dx) / st) * st;
    return [x1 + Math.cos(a) * len, y1 + Math.sin(a) * len];
  }

  // Make the dragged corner form a square with the start corner.
  function constrainSquare(x1, y1, x2, y2) {
    const d = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    return [x1 + (x2 >= x1 ? d : -d), y1 + (y2 >= y1 ? d : -d)];
  }

  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  function handlePoints(r) {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, x2 = r.x + r.w, y2 = r.y + r.h;
    return {
      nw: { x: r.x, y: r.y }, n: { x: cx, y: r.y }, ne: { x: x2, y: r.y },
      e: { x: x2, y: cy }, se: { x: x2, y: y2 }, s: { x: cx, y: y2 },
      sw: { x: r.x, y: y2 }, w: { x: r.x, y: cy }
    };
  }

  function hitHandle(r, x, y, tol, allowed) {
    const pts = handlePoints(r);
    const list = allowed || HANDLES;
    let best = null, bestD = Infinity;
    for (const name of list) {
      const p = pts[name];
      const d = Math.max(Math.abs(p.x - x), Math.abs(p.y - y));
      if (d <= tol && d < bestD) { best = name; bestD = d; }
    }
    return best;
  }

  /**
   * Resize `orig` by dragging `handle` to (px,py). opts.ratio (w/h) locks the aspect.
   * Dragging across the opposite edge flips the rectangle (result is always normalized).
   */
  function resizeRect(orig, handle, px, py, opts) {
    const ratio = opts && opts.ratio;
    let l = orig.x, t = orig.y, r = orig.x + orig.w, b = orig.y + orig.h;
    const hw = handle.includes('w'), he = handle.includes('e');
    const hn = handle.includes('n'), hs = handle.includes('s');
    if (hw) l = px;
    if (he) r = px;
    if (hn) t = py;
    if (hs) b = py;
    if (ratio && ratio > 0) {
      const corner = (hw || he) && (hn || hs);
      if (corner) {
        const ax = hw ? orig.x + orig.w : orig.x;
        const ay = hn ? orig.y + orig.h : orig.y;
        const dx = Math.abs(px - ax), dy = Math.abs(py - ay);
        const w = Math.max(dx, dy * ratio), h = w / ratio;
        const sx = px >= ax ? 1 : -1, sy = py >= ay ? 1 : -1;
        l = Math.min(ax, ax + sx * w); r = Math.max(ax, ax + sx * w);
        t = Math.min(ay, ay + sy * h); b = Math.max(ay, ay + sy * h);
      } else if (hw || he) {
        const h = Math.abs(r - l) / ratio, cy = orig.y + orig.h / 2;
        t = cy - h / 2; b = cy + h / 2;
      } else {
        const w = Math.abs(b - t) * ratio, cx = orig.x + orig.w / 2;
        l = cx - w / 2; r = cx + w / 2;
      }
    }
    return { x: Math.min(l, r), y: Math.min(t, b), w: Math.abs(r - l), h: Math.abs(b - t) };
  }

  // Largest rect with the given aspect ratio that fits inside `rect`, centred, then kept inside `bounds`.
  function fitRatio(rect, ratio, bounds) {
    let w = rect.w, h = rect.h;
    if (w / h > ratio) w = h * ratio; else h = w / ratio;
    let x = rect.x + (rect.w - w) / 2, y = rect.y + (rect.h - h) / 2;
    if (bounds) {
      if (w > bounds.w) { w = bounds.w; h = w / ratio; }
      if (h > bounds.h) { h = bounds.h; w = h * ratio; }
      x = clamp(x, bounds.x, bounds.x + bounds.w - w);
      y = clamp(y, bounds.y, bounds.y + bounds.h - h);
    }
    return { x, y, w, h };
  }

  function clampRectInside(r, bounds) {
    const w = Math.min(r.w, bounds.w), h = Math.min(r.h, bounds.h);
    return {
      x: clamp(r.x, bounds.x, bounds.x + bounds.w - w),
      y: clamp(r.y, bounds.y, bounds.y + bounds.h - h), w, h
    };
  }

  /**
   * Speech-bubble tail. Returns null when the tip is inside the box, else
   * { side, p1, tip, p2 } where p1/p2 are on the box edge in clockwise walking order.
   */
  function calloutTail(rect, tx, ty, opts) {
    const { x, y, w, h } = rect;
    if (tx > x && tx < x + w && ty > y && ty < y + h) return null;
    const r = (opts && opts.radius) || 0;
    const cx = x + w / 2, cy = y + h / 2;
    const nx = (tx - cx) / (w / 2 || 1), ny = (ty - cy) / (h / 2 || 1);
    const side = Math.abs(nx) > Math.abs(ny) ? (nx > 0 ? 'right' : 'left') : (ny > 0 ? 'bottom' : 'top');
    const horiz = side === 'top' || side === 'bottom';
    const len = horiz ? w : h;
    const half = Math.max(2, Math.min((opts && opts.halfBase) || 12, len / 2 - 1));
    const lo = (horiz ? x : y) + Math.min(r, len / 2 - half) + half;
    const hi = (horiz ? x + w : y + h) - Math.min(r, len / 2 - half) - half;
    const target = horiz ? tx : ty;
    const bc = lo > hi ? (lo + hi) / 2 : clamp(target, lo, hi);
    const tip = { x: tx, y: ty };
    if (side === 'top') return { side, p1: { x: bc - half, y }, tip, p2: { x: bc + half, y } };
    if (side === 'bottom') return { side, p1: { x: bc + half, y: y + h }, tip, p2: { x: bc - half, y: y + h } };
    if (side === 'right') return { side, p1: { x: x + w, y: bc - half }, tip, p2: { x: x + w, y: bc + half } };
    return { side, p1: { x, y: bc + half }, tip, p2: { x, y: bc - half } };
  }

  // Arrow head triangle: tip, left, right.
  function arrowHead(x, y, angle, len, halfAngle) {
    const ha = halfAngle || 0.45;
    return [
      { x, y },
      { x: x - Math.cos(angle - ha) * len, y: y - Math.sin(angle - ha) * len },
      { x: x - Math.cos(angle + ha) * len, y: y - Math.sin(angle + ha) * len }
    ];
  }

  // Greedy word wrap; maxWidth<=0 disables wrapping (explicit newlines only).
  function wrapText(text, maxWidth, measure) {
    const out = [];
    for (const para of String(text == null ? '' : text).split('\n')) {
      if (!maxWidth || maxWidth <= 0) { out.push(para); continue; }
      let line = '';
      for (const word of para.split(' ')) {
        const test = line ? line + ' ' + word : word;
        if (measure(test) <= maxWidth) { line = test; continue; }
        if (line) out.push(line);
        if (measure(word) <= maxWidth) { line = word; continue; }
        let chunk = '';
        for (const ch of word) {
          if (chunk && measure(chunk + ch) > maxWidth) { out.push(chunk); chunk = ch; } else chunk += ch;
        }
        line = chunk;
      }
      out.push(line);
    }
    return out;
  }

  function toHex(r, g, b) {
    return '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  }

  return {
    clamp, normRect, rectFromPoints, inflate, pointInRect, rectsIntersect, unionRects,
    distToSegment, distToPolyline, pointInEllipse, ellipseBorderDist, pointInTriangle,
    constrainAngle, constrainSquare, HANDLES, handlePoints, hitHandle, resizeRect,
    fitRatio, clampRectInside, calloutTail, arrowHead, wrapText, toHex
  };
});
