'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const dir = path.join(__dirname, '..', 'src', 'renderer', 'recorder');
const GifEncoder = require(path.join(dir, 'gif-encoder.js'));
const WebmDuration = require(path.join(dir, 'webm-duration.js'));

// Standard GIF LZW decoder used to verify the encoder.
function lzwDecode(bytes, minCodeSize, expected) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let table = [];
  const reset = () => {
    table = [];
    for (let i = 0; i < clear; i++) table[i] = [i];
    table[clear] = null;
    table[eoi] = null;
    codeSize = minCodeSize + 1;
  };
  reset();
  const out = [];
  let prev = null;
  let bitBuf = 0, bitCnt = 0, pos = 0;
  for (;;) {
    while (bitCnt < codeSize && pos < bytes.length) {
      bitBuf |= bytes[pos++] << bitCnt;
      bitCnt += 8;
    }
    if (bitCnt < codeSize) break;
    const code = bitBuf & ((1 << codeSize) - 1);
    bitBuf >>>= codeSize;
    bitCnt -= codeSize;
    if (code === clear) { reset(); prev = null; continue; }
    if (code === eoi) break;
    let entry;
    if (code < table.length && table[code]) entry = table[code];
    else if (prev && code === table.length) entry = prev.concat(prev[0]);
    else throw new Error('bad LZW code ' + code);
    for (const v of entry) out.push(v);
    if (prev && table.length < 4096) {
      table.push(prev.concat(entry[0]));
      if (table.length === 1 << codeSize && codeSize < 12) codeSize++;
    }
    prev = entry;
  }
  return Uint8Array.from(out);
}

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// Minimal GIF parser/compositor returning RGB canvases per frame.
function decodeGif(buf) {
  assert.strictEqual(Buffer.from(buf.subarray(0, 6)).toString('latin1'), 'GIF89a');
  const w = buf[6] | (buf[7] << 8), h = buf[8] | (buf[9] << 8);
  const packed = buf[10];
  let pos = 13;
  let gct = null;
  if (packed & 0x80) {
    const n = 3 << ((packed & 7) + 1);
    gct = buf.subarray(pos, pos + n);
    pos += n;
  }
  const canvas = new Uint8Array(w * h * 3);
  const frames = [];
  let delay = 0;
  let loop = null;
  while (buf[pos] !== 0x3b) {
    const b = buf[pos++];
    if (b === 0x21) {
      const label = buf[pos++];
      if (label === 0xf9) { delay = buf[pos + 2] | (buf[pos + 3] << 8); }
      if (label === 0xff) loop = buf[pos + 14] | (buf[pos + 15] << 8);
      while (buf[pos] !== 0) pos += buf[pos] + 1;
      pos++;
    } else if (b === 0x2c) {
      const x = buf[pos] | (buf[pos + 1] << 8), y = buf[pos + 2] | (buf[pos + 3] << 8);
      const fw = buf[pos + 4] | (buf[pos + 5] << 8), fh = buf[pos + 6] | (buf[pos + 7] << 8);
      const fp = buf[pos + 8];
      pos += 9;
      let pal = gct;
      if (fp & 0x80) {
        const n = 3 << ((fp & 7) + 1);
        pal = buf.subarray(pos, pos + n);
        pos += n;
      }
      const minCode = buf[pos++];
      const chunks = [];
      while (buf[pos] !== 0) { chunks.push(buf.subarray(pos + 1, pos + 1 + buf[pos])); pos += buf[pos] + 1; }
      pos++;
      const data = Buffer.concat(chunks);
      const idx = lzwDecode(data, minCode);
      assert.strictEqual(idx.length, fw * fh);
      for (let i = 0; i < idx.length; i++) {
        const cx = x + (i % fw), cy = y + Math.floor(i / fw);
        const o = (cy * w + cx) * 3;
        canvas[o] = pal[idx[i] * 3]; canvas[o + 1] = pal[idx[i] * 3 + 1]; canvas[o + 2] = pal[idx[i] * 3 + 2];
      }
      frames.push({ pixels: canvas.slice(), delay, x, y, w: fw, h: fh });
    } else throw new Error('unexpected block 0x' + b.toString(16));
  }
  return { w, h, frames, loop, trailerAt: pos, length: buf.length };
}

test('LZW roundtrip for various inputs', () => {
  const r = rng(42);
  const cases = [
    { n: 1, colors: 4 },
    { n: 10, colors: 2 },
    { n: 5000, colors: 4 },
    { n: 100000, colors: 256 },   // forces table resets
    { n: 60000, colors: 16 },
    { n: 40000, colors: 2 },
  ];
  for (const c of cases) {
    const minCode = Math.max(2, Math.ceil(Math.log2(c.colors)));
    const data = new Uint8Array(c.n);
    for (let i = 0; i < c.n; i++) data[i] = Math.floor(r() * c.colors);
    const enc = GifEncoder.lzwEncode(data, minCode);
    assert.deepStrictEqual(lzwDecode(enc, minCode), data, JSON.stringify(c));
  }
  const flat = new Uint8Array(70000).fill(1);
  assert.deepStrictEqual(lzwDecode(GifEncoder.lzwEncode(flat, 2), 2), flat);
});

test('encoder output has valid header, dimensions, trailer and loop extension', () => {
  const w = 7, h = 5;
  const enc = new GifEncoder(w, h);
  const a = new Uint8Array(w * h * 4), b = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    a.set([255, 0, 0, 255], i * 4);
    b.set([0, 0, 255, 255], i * 4);
  }
  enc.addFrame(a, 10);
  enc.addFrame(b, 25);
  const bytes = enc.finish();
  assert.strictEqual(Buffer.from(bytes.subarray(0, 6)).toString('latin1'), 'GIF89a');
  assert.strictEqual(bytes[6] | (bytes[7] << 8), w);
  assert.strictEqual(bytes[8] | (bytes[9] << 8), h);
  assert.strictEqual(bytes[bytes.length - 1], 0x3b);
  const g = decodeGif(bytes);
  assert.strictEqual(g.frames.length, 2);
  assert.strictEqual(g.loop, 0);
  assert.deepStrictEqual(g.frames.map((f) => f.delay), [10, 25]);
  assert.deepStrictEqual([...g.frames[0].pixels.slice(0, 3)], [255, 0, 0]);
  assert.deepStrictEqual([...g.frames[1].pixels.slice(0, 3)], [0, 0, 255]);
});

test('exact palette is preserved for <=256 colors and frame deltas are cropped', () => {
  const w = 32, h = 24;
  const r = rng(7);
  const palette = Array.from({ length: 20 }, () => [Math.floor(r() * 256), Math.floor(r() * 256), Math.floor(r() * 256)]);
  const f1 = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) f1.set([...palette[i % 20], 255], i * 4);
  const f2 = new Uint8ClampedArray(f1);
  f2.set([1, 2, 3, 255], (10 * w + 12) * 4);
  f2.set([9, 8, 7, 255], (12 * w + 15) * 4);
  const enc = new GifEncoder(w, h);
  enc.addFrame(f1, 5);
  enc.addFrame(f2, 5);
  enc.addFrame(f2, 5); // identical: merged into previous delay
  const g = decodeGif(enc.finish());
  assert.strictEqual(g.frames.length, 2);
  assert.strictEqual(g.frames[1].delay, 10);
  assert.deepStrictEqual([g.frames[1].x, g.frames[1].y, g.frames[1].w, g.frames[1].h], [12, 10, 4, 3]);
  for (const [frame, src] of [[g.frames[0], f1], [g.frames[1], f2]]) {
    for (let i = 0; i < w * h; i++) {
      assert.deepStrictEqual([...frame.pixels.slice(i * 3, i * 3 + 3)], [src[i * 4], src[i * 4 + 1], src[i * 4 + 2]]);
    }
  }
});

test('median-cut quantizes photographic data close to the source', () => {
  const w = 64, h = 64;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      rgba.set([x * 4, y * 4, (x + y) * 2, 255], (y * w + x) * 4);
    }
  }
  const enc = new GifEncoder(w, h);
  enc.addFrame(rgba, 8);
  const g = decodeGif(enc.finish());
  let err = 0;
  for (let i = 0; i < w * h * 3; i++) err += Math.abs(g.frames[0].pixels[i] - rgba[Math.floor(i / 3) * 4 + (i % 3)]);
  assert.ok(err / (w * h * 3) < 14, 'mean error ' + err / (w * h * 3));
});

test('WebM duration patcher inserts a Duration element', () => {
  const infoContent = [0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40, 0x4d, 0x80, 0x82, 0x41, 0x42];
  const bytes = Uint8Array.from([
    0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x82, 0x81, 0x00, // EBML header w/ tiny body
    0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, // unknown-size segment
    0x15, 0x49, 0xa9, 0x66, 0x80 | infoContent.length, ...infoContent,
    0x1f, 0x43, 0xb6, 0x75, 0x80, // empty cluster
  ]);
  const out = WebmDuration.fixDuration(bytes, 2500);
  assert.ok(out.length > bytes.length);
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  let found = -1;
  for (let i = 0; i < out.length - 11; i++) if (out[i] === 0x44 && out[i + 1] === 0x89 && out[i + 2] === 0x88) { found = i; break; }
  assert.ok(found > 0);
  assert.strictEqual(dv.getFloat64(found + 3), 2500); // 1ms timecode scale
  // Cluster still follows right after the (now larger) Info element.
  assert.deepStrictEqual([...out.slice(out.length - 5)], [0x1f, 0x43, 0xb6, 0x75, 0x80]);
  // Idempotent: second run updates in place.
  const again = WebmDuration.fixDuration(out, 4000);
  assert.strictEqual(again.length, out.length);
  assert.strictEqual(new DataView(again.buffer, again.byteOffset).getFloat64(found + 3), 4000);
});
