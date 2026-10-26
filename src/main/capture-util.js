'use strict';
// Pure helpers for capture.js (no electron imports so they can be unit tested with node:test).
// Bitmaps are { data: Buffer|Uint8Array, width, height } with 4 bytes per pixel (channel order irrelevant).

function normalizeRect(r) {
  let { x, y, w, h } = r;
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  return { x, y, w, h };
}

function rectFromPoints(p1, p2) {
  return {
    x: Math.min(p1.x, p2.x),
    y: Math.min(p1.y, p2.y),
    w: Math.abs(p2.x - p1.x),
    h: Math.abs(p2.y - p1.y),
  };
}

// Intersection of two rects; returns a zero-sized rect when they do not overlap.
function intersectRect(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return { x: x1, y: y1, w: 0, h: 0 };
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function pointInRect(p, r) {
  return p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h;
}

function dipToPhysical(value, scaleFactor) {
  return Math.round(value * scaleFactor);
}

// Converts a selection in CSS/DIP px (relative to its display) to an integer rect in image (physical) pixels,
// clamped to the image. Each edge is rounded so adjacent selections tile without gaps.
function cssRectToPhysical(rect, cssSize, imgSize) {
  const r = normalizeRect(rect);
  const sx = imgSize.w / cssSize.w;
  const sy = imgSize.h / cssSize.h;
  let x1 = Math.round(r.x * sx);
  let y1 = Math.round(r.y * sy);
  let x2 = Math.round((r.x + r.w) * sx);
  let y2 = Math.round((r.y + r.h) * sy);
  x1 = Math.min(Math.max(x1, 0), imgSize.w);
  y1 = Math.min(Math.max(y1, 0), imgSize.h);
  x2 = Math.min(Math.max(x2, 0), imgSize.w);
  y2 = Math.min(Math.max(y2, 0), imgSize.h);
  if (x2 <= x1) x2 = Math.min(imgSize.w, x1 + 1);
  if (y2 <= y1) y2 = Math.min(imgSize.h, y1 + 1);
  if (x2 <= x1) x1 = Math.max(0, x2 - 1);
  if (y2 <= y1) y1 = Math.max(0, y2 - 1);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

// Rect in global DIP coordinates -> rect relative to a display's bounds (DIP).
function toLocalRect(rect, bounds) {
  return { x: rect.x - bounds.x, y: rect.y - bounds.y, w: rect.w, h: rect.h };
}

// ---- cursor drawing -------------------------------------------------------------------------------------------

const CURSOR_POLY = [[0, 0], [0, 16], [4, 12.5], [7, 19], [9.5, 18], [6.5, 11.5], [11, 11.5]];

function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Swaps R and B of 4-byte pixels in place (RGBA <-> BGRA), e.g. node-screenshots' RGBA into Windows' native BGRA.
function swapRedBlue(buf) {
  if (buf.byteOffset % 4 === 0) {
    const px = new Uint32Array(buf.buffer, buf.byteOffset, buf.length >> 2);
    for (let i = 0; i < px.length; i++) {
      const v = px[i];
      px[i] = (v & 0xff00ff00) | ((v & 0xff) << 16) | ((v >>> 16) & 0xff);
    }
  } else {
    for (let i = 0; i + 3 < buf.length; i += 4) { const r = buf[i]; buf[i] = buf[i + 2]; buf[i + 2] = r; }
  }
  return buf;
}

// Draws a simple arrow cursor (white fill, black outline) with its tip at (cx, cy) into the bitmap, in place.
function drawCursorArrow(bmp, cx, cy, scale = 1) {
  const { data, width, height } = bmp;
  const poly = CURSOR_POLY.map(([x, y]) => [cx + x * scale, cy + y * scale]);
  const outline = Math.max(1, scale);
  const x0 = Math.max(0, Math.floor(cx - outline - 1));
  const y0 = Math.max(0, Math.floor(cy - outline - 1));
  const x1 = Math.min(width - 1, Math.ceil(cx + 12 * scale + outline));
  const y1 = Math.min(height - 1, Math.ceil(cy + 20 * scale + outline));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let v = -1;
      if (pointInPoly(px, py, poly)) {
        let d = Infinity;
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i];
          const b = poly[(i + 1) % poly.length];
          d = Math.min(d, distToSegment(px, py, a[0], a[1], b[0], b[1]));
        }
        v = d < outline * 0.8 ? 0 : 255;
      } else {
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i];
          const b = poly[(i + 1) % poly.length];
          if (distToSegment(px, py, a[0], a[1], b[0], b[1]) < outline * 0.8) { v = 0; break; }
        }
      }
      if (v >= 0) {
        const o = (y * width + x) * 4;
        data[o] = v; data[o + 1] = v; data[o + 2] = v; data[o + 3] = 255;
      }
    }
  }
  return bmp;
}

// ---- scrolling capture: overlap detection and stitching ---------------------------------------------------------

// `colStep` is either a sampling stride or an explicit array of column indices to compare.
function rowDiff(a, b, ya, yb, w, colStep) {
  const A = a.data;
  const B = b.data;
  const ia = ya * w * 4;
  const ib = yb * w * 4;
  let sum = 0;
  let n = 0;
  if (Array.isArray(colStep)) {
    for (let k = 0; k < colStep.length; k++) {
      const o = colStep[k] * 4;
      sum += Math.abs(A[ia + o] - B[ib + o]) + Math.abs(A[ia + o + 1] - B[ib + o + 1]) + Math.abs(A[ia + o + 2] - B[ib + o + 2]);
      n += 3;
    }
    return n ? sum / n : 0;
  }
  for (let x = 0; x < w; x += colStep) {
    const o = x * 4;
    sum += Math.abs(A[ia + o] - B[ib + o]) + Math.abs(A[ia + o + 1] - B[ib + o + 1]) + Math.abs(A[ia + o + 2] - B[ib + o + 2]);
    n += 3;
  }
  return n ? sum / n : 0;
}

// Sampled columns where the two frames differ somewhere (rows compared at the same position). Columns that never change
// (a fixed sidebar, blank margins, vertical grid lines) carry no scroll information and only disturb matching.
function changingColumns(prev, next, colStep) {
  const { width: w, height: h } = prev;
  const A = prev.data;
  const B = next.data;
  const rowStep = Math.max(1, Math.floor(h / 120));
  const cols = [];
  for (let x = 0; x < w; x += colStep) {
    const o = x * 4;
    let changed = false;
    for (let y = 0; y < h && !changed; y += rowStep) {
      const i = y * w * 4 + o;
      if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 24) changed = true;
    }
    if (changed) cols.push(x);
  }
  return cols;
}

/**
 * Rows that are identical at the top (fixed header / sticky rows) and at the bottom (footer, status bar) of two frames.
 * Returns { top, bottom }; top === h means the frames are identical.
 */
function staticRows(prev, next, rowTol = 6) {
  const { width: w, height: h } = prev;
  if (next.width !== w || next.height !== h) return { top: 0, bottom: 0 };
  const colStep = Math.max(1, Math.floor(w / 80));
  let top = 0;
  while (top < h && rowDiff(prev, next, top, top, w, colStep) <= rowTol) top++;
  if (top === h) return { top, bottom: 0 };
  let bottom = 0;
  while (bottom < h - top && rowDiff(prev, next, h - 1 - bottom, h - 1 - bottom, w, colStep) <= rowTol) bottom++;
  return { top, bottom };
}

// A frame restricted to rows [top, height - bottom); rows are contiguous so this is a zero-copy view.
function zoneView(frame, top, bottom) {
  const w = frame.width;
  const rows = frame.height - top - bottom;
  const data = asBuffer(frame.data).subarray(top * w * 4, (top + rows) * w * 4);
  return { data, width: w, height: rows };
}

/**
 * Rows at the bottom of `prev` that were covered by something that does not scroll with the content (a horizontal
 * scroll bar drawn over the text): once `next` is shifted by `dy`, the same rows of the page look different there while
 * everything above matches. Returns the height of that band (0 if there is none or it cannot be told).
 */
function overlayRows(prev, next, dy) {
  const { width: w, height: h } = prev;
  const maxOv = Math.min(80, Math.floor(h * 0.1));
  const rows = h - dy;
  if (dy <= 0 || rows < maxOv + 40) return 0;
  // Columns that follow the scroll in the rows above the band.
  const cols = [];
  const colStep = Math.max(1, Math.floor(w / 300));
  for (let x = 0; x < w; x += colStep) {
    let n = 0;
    let bad = 0;
    for (let y = 0; y < rows - maxOv; y += 4) {
      n++;
      if (rowDiff(prev, next, y + dy, y, w, [x]) > 16) bad++;
    }
    if (bad <= n * 0.05) cols.push(x);
  }
  if (cols.length < 20) return 0;
  let ov = 0;
  let gap = 0;
  for (let y = rows - 1; y >= rows - maxOv; y--) {
    if (rowDiff(prev, next, y + dy, y, w, cols) > 8) { ov = rows - y; gap = 0; } else if (++gap > 3) break;
  }
  return ov >= 3 ? ov : 0;
}

// Fraction of overlapping rows that match when `next` is shifted `dy` rows up relative to `prev`
// (prev row y+dy == next row y).
function matchFraction(prev, next, dy, colStep, rowTol) {
  const { width: w, height: h } = prev;
  const rows = h - dy;
  if (rows <= 0) return 0;
  let ok = 0;
  for (let y = 0; y < rows; y++) if (rowDiff(prev, next, y + dy, y, w, colStep) <= rowTol) ok++;
  return ok / rows;
}

/**
 * Finds how many rows the content moved up between two consecutive frames of a downward scroll.
 * Returns { ok, dy, identical, score, match }. dy===0 && identical means nothing moved (end of scroll).
 * opts: { hint, minOverlap (rows), samples, rowTol, minMatch }
 */
function detectScrollOffset(prev, next, opts = {}) {
  const w = prev.width;
  const h = prev.height;
  if (!w || !h || next.width !== w || next.height !== h) return { ok: false, dy: 0, identical: false, score: Infinity, match: 0 };
  const colStep = Math.max(1, Math.floor(w / 80));
  const rowTol = opts.rowTol != null ? opts.rowTol : 6;
  const minMatch = opts.minMatch != null ? opts.minMatch : 0.8;
  const samples = opts.samples || 48;
  const minOverlap = Math.max(4, opts.minOverlap != null ? opts.minOverlap : Math.floor(h * 0.1));
  const hint = opts.hint != null ? opts.hint : Math.round(h * 0.5);

  const same = matchFraction(prev, next, 0, colStep, rowTol);
  if (same >= 0.995) return { ok: true, dy: 0, identical: true, score: 0, match: same };

  let cols = colStep;
  if (opts.skipStaticColumns !== false) {
    const dynamic = changingColumns(prev, next, colStep);
    if (dynamic.length >= 6) cols = dynamic;
  }

  const maxDy = Math.min(h - minOverlap, opts.maxDy != null ? Math.max(1, opts.maxDy) : Infinity);
  const cap = 32;
  const scores = new Float32Array(maxDy + 1).fill(Infinity);
  for (let dy = 1; dy <= maxDy; dy++) {
    const rows = h - dy;
    const step = Math.max(1, Math.floor(rows / samples));
    let sum = 0;
    let n = 0;
    for (let y = 0; y < rows; y += step) {
      sum += Math.min(cap, rowDiff(prev, next, y + dy, y, w, cols));
      n++;
    }
    scores[dy] = sum / n;
  }

  // The coarse pass samples few rows and columns, so near-identical candidates (repeated lines, tables) can tie.
  // Re-score the best few with many more columns and every other row before choosing.
  const order = [];
  for (let dy = 1; dy <= maxDy; dy++) if (scores[dy] < Infinity) order.push(dy);
  order.sort((p, q) => scores[p] - scores[q]);
  const cand = [];
  for (const dy of order) {
    if (cand.length >= 12) break;
    if (cand.every((c) => Math.abs(c - dy) > 2)) cand.push(dy);
  }
  if (!cand.length) return { ok: false, dy: 0, identical: false, score: Infinity, match: 0 };
  const fineStep = Math.max(1, Math.floor(w / 480));
  let fineCols = changingColumns(prev, next, fineStep);
  if (fineCols.length < 6) fineCols = fineStep;
  const fine = new Map();
  for (const dy of cand) {
    const rows = h - dy;
    let sum = 0;
    let n = 0;
    for (let y = 0; y < rows; y += 2) {
      sum += Math.min(cap, rowDiff(prev, next, y + dy, y, w, fineCols));
      n++;
    }
    fine.set(dy, sum / n);
  }
  let bestScore = Infinity;
  for (const s of fine.values()) if (s < bestScore) bestScore = s;
  // Among candidates that are practically as good as the best, the one closest to the last known step wins.
  let bestDy = -1;
  for (const [dy, s] of fine) {
    if (s > bestScore * 1.03 + 0.02) continue;
    if (bestDy < 0 || Math.abs(dy - hint) < Math.abs(bestDy - hint)) bestDy = dy;
  }
  const match = matchFraction(prev, next, bestDy, fineCols, rowTol);
  return { ok: match >= minMatch, dy: bestDy, identical: false, score: bestScore, match };
}

// True when two frames show the same picture apart from the mouse pointer (their `box` areas) and a stray pixel or two.
function sameIgnoringBoxes(a, b) {
  if (!a || !b || a.width !== b.width || a.height !== b.height) return false;
  const { width: w, height: h } = a;
  const A = asBuffer(a.data);
  const B = asBuffer(b.data);
  const inBox = (bx, x, y) => bx && x >= bx.x0 && x < bx.x1 && y >= bx.y0 && y < bx.y1;
  const colStep = Math.max(1, Math.floor(w / 160));
  let n = 0;
  let bad = 0;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += colStep) {
      if (inBox(a.box, x, y) || inBox(b.box, x, y)) continue;
      const i = (y * w + x) * 4;
      n++;
      if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 18) bad++;
    }
  }
  return n > 0 && bad <= n * 0.002;
}

function asBuffer(d) {
  return Buffer.isBuffer(d) ? d : Buffer.from(d.buffer, d.byteOffset, d.byteLength);
}

// Builds one tall bitmap: the first frame in full plus the bottom `dy` rows of every subsequent frame.
function stitchFrames(frames, offsets) {
  if (!frames.length) throw new Error('no frames');
  const { width: w, height: h } = frames[0];
  let total = h;
  for (const dy of offsets) total += dy;
  const out = Buffer.alloc(w * total * 4);
  asBuffer(frames[0].data).copy(out, 0, 0, w * h * 4);
  let row = h;
  for (let i = 1; i < frames.length; i++) {
    const dy = offsets[i - 1];
    if (dy <= 0) continue;
    const src = asBuffer(frames[i].data);
    src.copy(out, row * w * 4, (h - dy) * w * 4, h * w * 4);
    row += dy;
  }
  return { data: out, width: w, height: row };
}

function median(list) {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// Rows left out above the detected footer: its boundary row blends with the content next to it (video chroma
// subsampling, anti-aliasing), so that row can differ between frames. The next frame supplies these rows again.
const SEAM_MARGIN = 3;

/**
 * Builds the tall image while scrolling, without keeping every frame in memory. The first frame is kept down to its
 * footer, each added frame contributes only the rows it newly reveals (just above the fixed footer, whose height is the
 * running median of the per-frame estimates), and finish() appends the last frame's footer once.
 */
class ScrollStitcher {
  constructor(first) {
    this.w = first.width;
    this.h = first.height;
    this.first = first;
    this.last = first;
    this.parts = [];
    this.rows = 0;
    this.covered = null; // row (in the last frame) up to which the output already holds content
    this.footers = [];
    this.moved = new Uint8Array(this.w); // columns that changed between frames (i.e. are part of the scrolling content)
    this.alignPairs = new Uint16Array(this.w); // frame pairs in which a column could be checked against the scroll
    this.alignBad = new Uint16Array(this.w); // ...and in which it did not follow it
    this.firstRows = 0; // rows contributed by the first frame
    this.firstFrame = first;
    this.gapRows = 0; // rows that scrolled past between two frames without ever being seen
    this.patches = []; // clean copies for the rows under the mouse cursor, applied in finish()
  }

  get height() {
    return this.covered === null ? this.h : this.rows + (this.h - this.covered);
  }

  _push(frame, from, to) {
    if (to <= from) return null;
    const w4 = this.w * 4;
    const part = Buffer.from(asBuffer(frame.data).subarray(from * w4, to * w4));
    this.parts.push(part);
    this.rows += to - from;
    return { part, from, to, frame, done: new Set() };
  }

  // Rows of a pushed strip that lie under the mouse cursor (frame.box) get a clean copy of the same content from `alt`,
  // a neighbouring frame (row y of the strip's frame is row y + shift there), where the cursor is not in the way.
  _patch(rec, alt, shift, lo, hi) {
    const box = rec && rec.frame.box;
    if (!box) return;
    const w4 = this.w * 4;
    const A = asBuffer(alt.data);
    const ab = alt.box;
    for (let y = Math.max(rec.from, box.y0); y < Math.min(rec.to, box.y1); y++) {
      const ya = y + shift;
      if (rec.done.has(y) || ya < lo || ya >= hi) continue;
      if (ab && ya >= ab.y0 && ya < ab.y1 && ab.x0 < box.x1 && ab.x1 > box.x0) continue;
      rec.done.add(y);
      this.patches.push({
        part: rec.part,
        off: (y - rec.from) * w4 + box.x0 * 4,
        x0: box.x0,
        data: Buffer.from(A.subarray(ya * w4 + box.x0 * 4, ya * w4 + box.x1 * 4)),
      });
    }
  }

  // Marks the columns that differ between two frames inside the scrolling rows [top, h - bottom).
  _trackColumns(a, b, top, bottom) {
    const { w, h } = this;
    const y0 = Math.max(0, top);
    const y1 = Math.min(h, h - bottom);
    const A = asBuffer(a.data);
    const B = asBuffer(b.data);
    const inBox = (bx, x, y) => bx && x >= bx.x0 && x < bx.x1 && y >= bx.y0 && y < bx.y1;
    for (let x = 0; x < w; x++) {
      if (this.moved[x]) continue;
      let n = 0;
      for (let y = y0; y < y1; y += 2) {
        const i = (y * w + x) * 4;
        if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 24 &&
          !inBox(a.box, x, y) && !inBox(b.box, x, y) && ++n >= 3) {
          this.moved[x] = 1;
          break;
        }
      }
    }
  }

  // Columns whose pixels do not follow the scroll even though they change (a minimap, an overview ruler): compares
  // `frame` row y with `last` row y + dy and counts, per column, the pairs of frames where many rows disagree.
  _trackAligned(a, b, dy, top, bottom) {
    const { w, h } = this;
    const y1 = h - bottom - dy;
    if ((y1 - top) / 3 < 20) return;
    const A = asBuffer(a.data);
    const B = asBuffer(b.data);
    const inBox = (bx, x, y) => bx && x >= bx.x0 && x < bx.x1 && y >= bx.y0 && y < bx.y1;
    for (let x = 0; x < w; x++) {
      let n = 0;
      let bad = 0;
      for (let y = top; y < y1; y += 3) {
        if (inBox(b.box, x, y) || inBox(a.box, x, y + dy)) continue;
        const i = (y * w + x) * 4;
        const j = ((y + dy) * w + x) * 4;
        n++;
        if (Math.abs(B[i] - A[j]) + Math.abs(B[i + 1] - A[j + 1]) + Math.abs(B[i + 2] - A[j + 2]) > 48) bad++;
      }
      if (n >= 20) {
        this.alignPairs[x]++;
        if (bad > n * 0.15) this.alignBad[x]++;
      }
    }
  }

  // `frame` is `dy` rows further down than the previously added frame; `bottom` / `top` = fixed rows seen at its
  // bottom / top.
  add(frame, dy, bottom, top = 0) {
    const { h } = this;
    this._trackColumns(this.last, frame, top, bottom);
    this._trackAligned(this.last, frame, dy, top, bottom);
    this.footers.push(Math.max(0, Math.min(bottom, h - 1)));
    const end = h - Math.round(median(this.footers)) - SEAM_MARGIN;
    const lo = top, hi = h - bottom;
    if (this.covered === null) {
      this.lastRec = this._push(this.first, 0, end);
      this.covered = end;
      this.firstRows = end;
    }
    if (dy > this.covered) this.gapRows += dy - this.covered;
    const start = Math.max(0, this.covered - dy);
    const rec = this._push(frame, start, end);
    this._patch(rec, this.last, dy, lo, hi);
    this._patch(this.lastRec, frame, -dy, lo, hi);
    this.lastRec = rec;
    this.covered = Math.max(end, start);
    this.last = frame;
    this.first = null;
  }

  /**
   * Columns at the left / right edge that never changed while scrolling (a fixed sidebar, a side panel...).
   * Returns { left, right } widths in pixels (0 when there is none).
   */
  fixedColumns() {
    const { w, moved, alignPairs, alignBad } = this;
    // Besides never-changing columns, a minimap or ruler changes but does not scroll with the content.
    const still = (x) => !moved[x] || (alignPairs[x] >= 2 && alignBad[x] * 2 > alignPairs[x]);
    let left = 0;
    while (left < w && still(left)) left++;
    if (left === w) return { left: 0, right: 0 }; // nothing moved sideways-wise: no way to tell
    let right = 0;
    while (right < w - left && still(w - 1 - right)) right++;
    const minBand = 12;
    if (left < minBand) left = 0;
    if (right < minBand) right = 0;
    if (w - left - right < w * 0.15) return { left: 0, right: 0 };
    return { left, right };
  }

  // Dominant colour of each column in [x0, x1) over the first `rows` rows of the first frame: what a fixed band is filled
  // with below its content (so dividers and margins of the band continue as they were).
  _columnColors(x0, x1, rows) {
    const F = asBuffer(this.firstFrame.data);
    const out = new Uint8Array((x1 - x0) * 4);
    for (let x = x0; x < x1; x++) {
      const counts = new Map();
      let best = null;
      for (let y = 0; y < rows; y += 3) {
        const i = (y * this.w + x) * 4;
        const key = ((F[i] >> 3) << 10) | ((F[i + 1] >> 3) << 5) | (F[i + 2] >> 3);
        const e = counts.get(key) || { n: 0, i };
        e.n++;
        counts.set(key, e);
        if (!best || e.n > best.n) best = e;
      }
      const o = (x - x0) * 4;
      if (best) { out[o] = F[best.i]; out[o + 1] = F[best.i + 1]; out[o + 2] = F[best.i + 2]; } else out.fill(255, o, o + 3);
      out[o + 3] = 255;
    }
    return out;
  }

  finish() {
    const from = this.covered === null ? 0 : this.covered;
    this._push(this.last, from, this.h);
    this.fixed = this.covered === null ? { left: 0, right: 0 } : this.fixedColumns();
    const { left, right } = this.fixed;
    // Rows under the mouse cursor are replaced by clean copies, except in fixed side columns (there the other frames
    // show the cursor at the same place too).
    for (const p of this.patches) {
      const n = p.data.length / 4;
      for (let k = 0; k < n; k++) {
        const x = p.x0 + k;
        if (x < left || x >= this.w - right) continue;
        p.data.copy(p.part, p.off + k * 4, k * 4, k * 4 + 4);
      }
    }
    this.patches = [];
    const out = Buffer.concat(this.parts, this.rows * this.w * 4);
    if (this.covered !== null) {
      // A fixed band is shown once, as in the first frame; the rest of it is filled with its background colour.
      const tail = this.h - this.covered;
      const y0 = this.firstRows;
      const y1 = this.rows - tail;
      for (const [x0, x1] of [[0, left], [this.w - right, this.w]]) {
        if (x1 <= x0 || y1 <= y0) continue;
        const row = Buffer.from(this._columnColors(x0, x1, y0));
        for (let y = y0; y < y1; y++) row.copy(out, (y * this.w + x0) * 4);
      }
    }
    return { data: out, width: this.w, height: this.rows };
  }
}

// Chooses how many wheel notches to send next so the expected scroll is ~targetRatio of the frame height.
function nextNotches(current, measuredDy, frameHeight, targetRatio = 0.6, max = 40) {
  if (!measuredDy || measuredDy <= 0) return current;
  const perNotch = measuredDy / current;
  return Math.max(1, Math.min(max, Math.floor((frameHeight * targetRatio) / perNotch)));
}

module.exports = {
  normalizeRect,
  rectFromPoints,
  intersectRect,
  pointInRect,
  dipToPhysical,
  cssRectToPhysical,
  toLocalRect,
  drawCursorArrow,
  swapRedBlue,
  detectScrollOffset,
  staticRows,
  sameIgnoringBoxes,
  overlayRows,
  zoneView,
  stitchFrames,
  ScrollStitcher,
  median,
  nextNotches,
};
