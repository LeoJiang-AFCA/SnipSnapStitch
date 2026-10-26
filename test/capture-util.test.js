'use strict';
const test = require('node:test');
const assert = require('node:assert');
const u = require('../src/main/capture-util');

function makePage(w, h, seed = 1) {
  const data = Buffer.alloc(w * h * 4);
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) >>> 24);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = rnd(); data[i * 4 + 1] = rnd(); data[i * 4 + 2] = rnd(); data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h };
}

function slice(page, y, h) {
  return { data: page.data.subarray(y * page.width * 4, (y + h) * page.width * 4), width: page.width, height: h };
}

test('rect normalization', () => {
  assert.deepStrictEqual(u.normalizeRect({ x: 10, y: 10, w: -4, h: -6 }), { x: 6, y: 4, w: 4, h: 6 });
  assert.deepStrictEqual(u.rectFromPoints({ x: 5, y: 9 }, { x: 1, y: 2 }), { x: 1, y: 2, w: 4, h: 7 });
});

test('intersection and point tests', () => {
  assert.deepStrictEqual(u.intersectRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }), { x: 5, y: 5, w: 5, h: 5 });
  assert.strictEqual(u.intersectRect({ x: 0, y: 0, w: 4, h: 4 }, { x: 10, y: 10, w: 4, h: 4 }).w, 0);
  assert.ok(u.pointInRect({ x: 0, y: 0 }, { x: 0, y: 0, w: 2, h: 2 }));
  assert.ok(!u.pointInRect({ x: 2, y: 1 }, { x: 0, y: 0, w: 2, h: 2 }));
});

test('DPI scaling to physical pixels and clamping', () => {
  assert.strictEqual(u.dipToPhysical(100, 1.25), 125);
  const r = u.cssRectToPhysical({ x: 10, y: 20, w: 100, h: 50 }, { w: 1536, h: 864 }, { w: 1920, h: 1080 });
  assert.deepStrictEqual(r, { x: 13, y: 25, w: 125, h: 63 });
  const clamped = u.cssRectToPhysical({ x: 1500, y: 800, w: 500, h: 500 }, { w: 1536, h: 864 }, { w: 1920, h: 1080 });
  assert.strictEqual(clamped.x + clamped.w, 1920);
  assert.strictEqual(clamped.y + clamped.h, 1080);
  const tiny = u.cssRectToPhysical({ x: 5, y: 5, w: 0, h: 0 }, { w: 100, h: 100 }, { w: 200, h: 200 });
  assert.ok(tiny.w >= 1 && tiny.h >= 1);
});

test('detectScrollOffset finds the shift between frames', () => {
  const page = makePage(160, 900);
  const a = slice(page, 0, 300);
  const b = slice(page, 120, 300);
  const r = u.detectScrollOffset(a, b, { hint: 150 });
  assert.ok(r.ok);
  assert.strictEqual(r.dy, 120);
});

test('detectScrollOffset reports identical frames and unrelated frames', () => {
  const page = makePage(160, 600);
  const a = slice(page, 0, 300);
  assert.ok(u.detectScrollOffset(a, slice(page, 0, 300)).identical);
  const other = makePage(160, 300, 99);
  assert.ok(!u.detectScrollOffset(a, other).ok);
});

test('detectScrollOffset tolerates a sticky header', () => {
  const page = makePage(160, 900);
  const a = slice(page, 0, 300);
  const b = { data: Buffer.from(slice(page, 100, 300).data), width: 160, height: 300 };
  a.data.copy(b.data, 0, 0, 160 * 20 * 4);
  const r = u.detectScrollOffset(a, b, { hint: 100 });
  assert.ok(r.ok);
  assert.strictEqual(r.dy, 100);
});

test('stitchFrames reproduces the original tall page', () => {
  const page = makePage(100, 700);
  const frames = [slice(page, 0, 300), slice(page, 150, 300), slice(page, 400, 300)];
  const offsets = [];
  for (let i = 1; i < frames.length; i++) offsets.push(u.detectScrollOffset(frames[i - 1], frames[i]).dy);
  assert.deepStrictEqual(offsets, [150, 250]);
  const out = u.stitchFrames(frames, offsets);
  assert.strictEqual(out.height, 700);
  assert.ok(out.data.equals(page.data));
});

test('scroll area with fixed header and footer is stitched without repeating them', () => {
  const w = 100;
  const page = makePage(w, 900, 7);
  const header = makePage(w, 40, 11);
  const footer = makePage(w, 30, 13);
  const frameAt = (off) => ({ data: Buffer.concat([header.data, slice(page, off, 230).data, footer.data]), width: w, height: 300 });
  const frames = [frameAt(0), frameAt(100), frameAt(220)];
  const offsets = [];
  const bottoms = [];
  for (let i = 1; i < frames.length; i++) {
    const st = u.staticRows(frames[i - 1], frames[i]);
    assert.deepStrictEqual([st.top, st.bottom], [40, 30]);
    const r = u.detectScrollOffset(u.zoneView(frames[i - 1], st.top, st.bottom), u.zoneView(frames[i], st.top, st.bottom));
    assert.ok(r.ok);
    offsets.push(r.dy);
    bottoms.push(st.bottom);
  }
  assert.deepStrictEqual(offsets, [100, 120]);
  const stitcher = new u.ScrollStitcher(frames[0]);
  offsets.forEach((dy, i) => stitcher.add(frames[i + 1], dy, bottoms[i]));
  const out = stitcher.finish();
  const expected = Buffer.concat([header.data, slice(page, 0, 450).data, footer.data]);
  assert.strictEqual(out.height, 40 + 450 + 30);
  assert.ok(out.data.equals(expected));
});

test('ScrollStitcher stays seamless when one frame under-reports the footer', () => {
  const w = 60;
  const page = makePage(w, 700, 3);
  const footer = makePage(w, 20, 9);
  const frameAt = (off) => ({ data: Buffer.concat([slice(page, off, 180).data, footer.data]), width: w, height: 200 });
  const s = new u.ScrollStitcher(frameAt(0));
  [[60, 20], [60, 20], [60, 5], [60, 20], [30, 20]].forEach(([dy, bottom], i, a) => {
    s.add(frameAt(a.slice(0, i + 1).reduce((t, [d]) => t + d, 0)), dy, bottom);
  });
  const out = s.finish();
  assert.strictEqual(out.height, 180 + 270 + 20);
  assert.ok(out.data.equals(Buffer.concat([slice(page, 0, 450).data, footer.data])));
});

test('a fixed sidebar does not stop the scrolling part from matching', () => {
  const content = makePage(80, 600, 21);
  const sidebar = makePage(40, 200, 5); // does not scroll
  const frameAt = (off) => {
    const rows = [];
    for (let y = 0; y < 200; y++) {
      rows.push(sidebar.data.subarray(y * 40 * 4, (y + 1) * 40 * 4), content.data.subarray((off + y) * 80 * 4, (off + y + 1) * 80 * 4));
    }
    return { data: Buffer.concat(rows), width: 120, height: 200 };
  };
  const r = u.detectScrollOffset(frameAt(0), frameAt(60));
  assert.ok(r.ok);
  assert.strictEqual(r.dy, 60);
});

test('fixed side columns appear once, and a skipped stretch is reported', () => {
  const lw = 40, cw = 80, rw = 30, w = lw + cw + rw;
  const content = makePage(cw, 800, 21);
  const left = makePage(lw, 200, 5);
  const right = makePage(rw, 200, 8);
  const frameAt = (off) => {
    const rows = [];
    for (let y = 0; y < 200; y++) {
      rows.push(left.data.subarray(y * lw * 4, (y + 1) * lw * 4), content.data.subarray((off + y) * cw * 4, (off + y + 1) * cw * 4), right.data.subarray(y * rw * 4, (y + 1) * rw * 4));
    }
    return { data: Buffer.concat(rows), width: w, height: 200 };
  };
  const s = new u.ScrollStitcher(frameAt(0));
  [60, 120, 180, 240].forEach((off) => s.add(frameAt(off), 60, 0));
  const out = s.finish();
  assert.deepStrictEqual(s.fixed, { left: lw, right: rw });
  assert.strictEqual(s.gapRows, 0);
  const px = (x, y) => out.data.readUInt32LE((y * out.width + x) * 4);
  const mid = (y) => out.data.subarray((y * w + lw) * 4, (y * w + lw + cw) * 4);
  for (let y = 0; y < out.height; y++) assert.ok(mid(y).equals(content.data.subarray(y * cw * 4, (y + 1) * cw * 4)), 'row ' + y);
  assert.strictEqual(px(0, 10), frameAt(0).data.readUInt32LE((10 * w) * 4)); // sidebar kept at the top
  assert.strictEqual(px(0, 300), px(0, 400)); // below it: one flat colour per column
  assert.strictEqual(px(w - 1, 300), px(w - 1, 420));

  const g = new u.ScrollStitcher(frameAt(0));
  g.add(frameAt(500), 500, 0); // more than a screenful in one step
  assert.ok(g.gapRows > 0);
});

test('a minimap that changes but does not scroll with the content counts as a fixed column band', () => {
  const cw = 80, mw = 30, w = cw + mw, h = 200;
  const content = makePage(cw, 800, 41);
  const frameAt = (off) => {
    const map = makePage(mw, h, 100 + off);
    const rows = [];
    for (let y = 0; y < h; y++) rows.push(content.data.subarray((off + y) * cw * 4, (off + y + 1) * cw * 4), map.data.subarray(y * mw * 4, (y + 1) * mw * 4));
    return { data: Buffer.concat(rows), width: w, height: h };
  };
  const s = new u.ScrollStitcher(frameAt(0));
  [60, 120, 180, 240].forEach((off) => s.add(frameAt(off), 60, 0));
  s.finish();
  assert.deepStrictEqual(s.fixed, { left: 0, right: mw });
});

test('overlayRows finds a bar floating over the bottom of the content', () => {
  const w = 100, h = 300;
  const content = makePage(w, 1200, 51);
  const frameAt = (off) => {
    const f = { data: Buffer.from(slice(content, off, h).data), width: w, height: h };
    for (let y = h - 10; y < h; y++) for (let x = 0; x < w; x++) f.data.writeUInt32LE(0xff808080, (y * w + x) * 4);
    return f;
  };
  const n = u.overlayRows(frameAt(0), frameAt(100), 100);
  assert.ok(n >= 9 && n <= 11, 'got ' + n);
  assert.strictEqual(u.overlayRows(slice(content, 0, h), slice(content, 100, h), 100), 0);
});

test('the mouse pointer drawn into the frames is painted out of the stitched image', () => {
  const w = 60, h = 200;
  const content = makePage(w, 900, 31);
  const box = { x0: 20, x1: 40, y0: 90, y1: 120 };
  const frameAt = (off) => {
    const data = Buffer.from(slice(content, off, h).data);
    for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) data.writeUInt32LE(0xff0000ff, (y * w + x) * 4);
    return { data, width: w, height: h, box };
  };
  const s = new u.ScrollStitcher(frameAt(0));
  [60, 120, 180, 240, 300].forEach((off) => s.add(frameAt(off), 60, 0));
  const out = s.finish();
  assert.ok(out.data.equals(slice(content, 0, out.height).data));
});

test('frames that differ only under the mouse pointer count as the same picture', () => {
  const w = 80, h = 200;
  const page = makePage(w, h, 7);
  const moved = Buffer.from(page.data);
  const box = { x0: 30, x1: 50, y0: 60, y1: 90 };
  for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) moved.writeUInt32LE(0xff00ff00, (y * w + x) * 4);
  const a = { ...page, box: null };
  const b = { data: moved, width: w, height: h, box };
  assert.ok(u.sameIgnoringBoxes(a, b));
  assert.ok(!u.sameIgnoringBoxes(a, { ...b, box: null }));
  assert.ok(!u.sameIgnoringBoxes(a, { ...makePage(w, h, 8), box }));
});

test('nextNotches adapts toward the target scroll distance', () => {
  assert.strictEqual(u.nextNotches(2, 200, 600), 3);
  assert.strictEqual(u.nextNotches(5, 0, 600), 5);
  assert.strictEqual(u.nextNotches(10, 900, 600), 4);
});

test('drawCursorArrow paints pixels near the tip only', () => {
  const bmp = { data: Buffer.alloc(40 * 40 * 4), width: 40, height: 40 };
  u.drawCursorArrow(bmp, 10, 10, 1);
  const px = (x, y) => bmp.data[(y * 40 + x) * 4 + 3];
  assert.strictEqual(px(11, 14), 255);
  assert.strictEqual(px(35, 35), 0);
});

test('swapRedBlue turns RGBA into BGRA in place, aligned or not', () => {
  const rgba = [10, 20, 30, 255, 200, 100, 0, 128, 1, 2, 3, 4];
  const bgra = [30, 20, 10, 255, 0, 100, 200, 128, 3, 2, 1, 4];
  const aligned = Buffer.alloc(rgba.length); // not pooled: byteOffset 0
  Buffer.from(rgba).copy(aligned);
  assert.strictEqual(u.swapRedBlue(aligned), aligned);
  assert.deepStrictEqual([...aligned], bgra);
  const backing = Buffer.alloc(rgba.length + 1);
  const odd = backing.subarray(1); // byteOffset 1: cannot be viewed as 32-bit pixels
  Buffer.from(rgba).copy(odd);
  u.swapRedBlue(odd);
  assert.deepStrictEqual([...odd], bgra);
});
