/* Pure-JS animated GIF encoder (median-cut quantizer + variable-width LZW).
 * UMD: window.GifEncoder in browsers, module.exports in Node.
 *
 *   const enc = new GifEncoder(width, height, { loop: 0, optimize: true });
 *   enc.addFrame(rgbaUint8Array, delayCentiseconds);
 *   const bytes = enc.finish();            // Uint8Array
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GifEncoder = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  class ByteSink {
    constructor(cap) {
      this.buf = new Uint8Array(cap || 1024);
      this.len = 0;
    }
    ensure(n) {
      if (this.len + n <= this.buf.length) return;
      let cap = this.buf.length * 2;
      while (cap < this.len + n) cap *= 2;
      const nb = new Uint8Array(cap);
      nb.set(this.buf.subarray(0, this.len));
      this.buf = nb;
    }
    push(b) {
      if (this.len >= this.buf.length) this.ensure(1);
      this.buf[this.len++] = b;
    }
    u16(v) {
      this.push(v & 255);
      this.push((v >> 8) & 255);
    }
    bytes(arr) {
      this.ensure(arr.length);
      this.buf.set(arr, this.len);
      this.len += arr.length;
    }
    str(s) {
      for (let i = 0; i < s.length; i++) this.push(s.charCodeAt(i));
    }
    result() {
      return this.buf.slice(0, this.len);
    }
  }

  /* ---------- LZW ---------- */

  // Returns the raw LZW byte stream (not split into sub-blocks).
  function lzwEncode(indices, minCodeSize) {
    const clear = 1 << minCodeSize;
    const eoi = clear + 1;
    const out = new ByteSink(Math.max(1024, indices.length >> 1));
    let codeSize = minCodeSize + 1;
    let next = eoi + 1;
    let cur = 0;
    let bits = 0;
    let dict = new Map();

    function emit(code) {
      cur |= code << bits;
      bits += codeSize;
      while (bits >= 8) {
        out.push(cur & 255);
        cur >>>= 8;
        bits -= 8;
      }
    }

    emit(clear);
    if (indices.length) {
      let prefix = indices[0];
      for (let i = 1; i < indices.length; i++) {
        const k = indices[i];
        const key = (prefix << 8) | k;
        const found = dict.get(key);
        if (found !== undefined) {
          prefix = found;
          continue;
        }
        emit(prefix);
        if (next === 4096) {
          emit(clear);
          dict = new Map();
          next = eoi + 1;
          codeSize = minCodeSize + 1;
        } else {
          if (next >= 1 << codeSize) codeSize++;
          dict.set(key, next++);
        }
        prefix = k;
      }
      emit(prefix);
    }
    emit(eoi);
    if (bits > 0) out.push(cur & 255);
    return out.result();
  }

  /* ---------- Quantization ---------- */

  function bitsFor(n) {
    let b = 1;
    while (1 << b < n) b++;
    return b;
  }

  // rgba: Uint8Array/Uint8ClampedArray, width*height*4. Returns
  // { palette: Uint8Array (rgb triples, length 3*2^bits), bits, indices: Uint8Array }
  function quantize(rgba, count, maxColors) {
    maxColors = maxColors || 256;
    const indices = new Uint8Array(count);

    // Exact pass: if the image has <= maxColors distinct colors keep them untouched.
    const exact = new Map();
    const exactList = [];
    let overflow = false;
    for (let i = 0, p = 0; i < count; i++, p += 4) {
      const key = (rgba[p] << 16) | (rgba[p + 1] << 8) | rgba[p + 2];
      let idx = exact.get(key);
      if (idx === undefined) {
        if (exactList.length >= maxColors) {
          overflow = true;
          break;
        }
        idx = exactList.length;
        exact.set(key, idx);
        exactList.push(key);
      }
      indices[i] = idx;
    }
    if (!overflow) {
      const bits = bitsFor(Math.max(2, exactList.length));
      const palette = new Uint8Array(3 << bits);
      for (let i = 0; i < exactList.length; i++) {
        palette[i * 3] = (exactList[i] >> 16) & 255;
        palette[i * 3 + 1] = (exactList[i] >> 8) & 255;
        palette[i * 3 + 2] = exactList[i] & 255;
      }
      return { palette, bits, indices };
    }

    // 15-bit histogram, sub-sampled for large frames.
    const hist = new Uint32Array(32768);
    const stride = Math.max(1, Math.floor(count / 90000));
    for (let i = 0; i < count; i += stride) {
      const p = i * 4;
      hist[((rgba[p] >> 3) << 10) | ((rgba[p + 1] >> 3) << 5) | (rgba[p + 2] >> 3)]++;
    }
    const bins = [];
    for (let i = 0; i < 32768; i++) if (hist[i]) bins.push(i);

    function makeBox(list) {
      let pop = 0;
      let rmin = 31, rmax = 0, gmin = 31, gmax = 0, bmin = 31, bmax = 0;
      for (let j = 0; j < list.length; j++) {
        const b = list[j];
        pop += hist[b];
        const r = b >> 10, g = (b >> 5) & 31, bl = b & 31;
        if (r < rmin) rmin = r;
        if (r > rmax) rmax = r;
        if (g < gmin) gmin = g;
        if (g > gmax) gmax = g;
        if (bl < bmin) bmin = bl;
        if (bl > bmax) bmax = bl;
      }
      const rr = rmax - rmin, gr = gmax - gmin, br = bmax - bmin;
      let axis = 0, range = rr;
      if (gr > range) { axis = 1; range = gr; }
      if (br > range) { axis = 2; range = br; }
      return { list, pop, axis, range };
    }

    const boxes = [makeBox(bins)];
    while (boxes.length < maxColors) {
      let best = -1, bestScore = -1;
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (b.list.length < 2) continue;
        const score = b.pop * (1 + b.range);
        if (score > bestScore) { bestScore = score; best = i; }
      }
      if (best < 0) break;
      const box = boxes[best];
      const shift = box.axis === 0 ? 10 : box.axis === 1 ? 5 : 0;
      const sorted = box.list.slice().sort((a, b) => ((a >> shift) & 31) - ((b >> shift) & 31));
      let acc = 0;
      let cut = 1;
      const half = box.pop / 2;
      for (let j = 0; j < sorted.length - 1; j++) {
        acc += hist[sorted[j]];
        cut = j + 1;
        if (acc >= half) break;
      }
      boxes.splice(best, 1, makeBox(sorted.slice(0, cut)), makeBox(sorted.slice(cut)));
    }

    const n = boxes.length;
    const bits = bitsFor(Math.max(2, n));
    const palette = new Uint8Array(3 << bits);
    const pr = new Int32Array(n), pg = new Int32Array(n), pb = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0, g = 0, b = 0, tot = 0;
      const list = boxes[i].list;
      for (let j = 0; j < list.length; j++) {
        const bin = list[j];
        const w = hist[bin];
        r += (bin >> 10) * w;
        g += ((bin >> 5) & 31) * w;
        b += (bin & 31) * w;
        tot += w;
      }
      tot = tot || 1;
      const rv = Math.round(r / tot), gv = Math.round(g / tot), bv = Math.round(b / tot);
      pr[i] = (rv << 3) | (rv >> 2);
      pg[i] = (gv << 3) | (gv >> 2);
      pb[i] = (bv << 3) | (bv >> 2);
      palette[i * 3] = pr[i];
      palette[i * 3 + 1] = pg[i];
      palette[i * 3 + 2] = pb[i];
    }

    const cache = new Int16Array(32768).fill(-1);
    for (let i = 0, p = 0; i < count; i++, p += 4) {
      const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      let idx = cache[key];
      if (idx < 0) {
        let bd = Infinity;
        idx = 0;
        const cr = (r & 0xf8) | 4, cg = (g & 0xf8) | 4, cb = (b & 0xf8) | 4;
        for (let c = 0; c < n; c++) {
          const dr = pr[c] - cr, dg = pg[c] - cg, db = pb[c] - cb;
          const d = dr * dr * 3 + dg * dg * 4 + db * db * 2;
          if (d < bd) { bd = d; idx = c; }
        }
        cache[key] = idx;
      }
      indices[i] = idx;
    }
    return { palette, bits, indices };
  }

  /* ---------- Encoder ---------- */

  class GifEncoder {
    constructor(width, height, opts) {
      opts = opts || {};
      this.width = width | 0;
      this.height = height | 0;
      if (this.width < 1 || this.height < 1 || this.width > 65535 || this.height > 65535) {
        throw new RangeError('Invalid GIF dimensions');
      }
      this.loop = opts.loop === undefined ? 0 : opts.loop; // 0 = forever
      this.optimize = opts.optimize !== false;
      this.maxColors = Math.min(256, opts.maxColors || 256);
      this.frames = [];
      this.prev = null;
    }

    // rgba: Uint8Array | Uint8ClampedArray of width*height*4; delay in 1/100 s.
    addFrame(rgba, delayCs) {
      const w = this.width, h = this.height;
      if (rgba.length < w * h * 4) throw new RangeError('Frame buffer too small');
      delayCs = Math.max(1, Math.min(65535, Math.round(delayCs || 10)));

      let x = 0, y = 0, fw = w, fh = h;
      if (this.optimize && this.prev) {
        const prev = this.prev;
        let minX = w, minY = h, maxX = -1, maxY = -1;
        for (let row = 0; row < h; row++) {
          const o = row * w * 4;
          for (let col = 0; col < w; col++) {
            const p = o + col * 4;
            if (rgba[p] !== prev[p] || rgba[p + 1] !== prev[p + 1] || rgba[p + 2] !== prev[p + 2]) {
              if (col < minX) minX = col;
              if (col > maxX) maxX = col;
              if (row < minY) minY = row;
              if (row > maxY) maxY = row;
            }
          }
        }
        if (maxX < 0) {
          // Identical to the previous frame: just hold it longer.
          const last = this.frames[this.frames.length - 1];
          last.delay = Math.min(65535, last.delay + delayCs);
          return;
        }
        x = minX; y = minY; fw = maxX - minX + 1; fh = maxY - minY + 1;
      }

      let region;
      if (fw === w && fh === h) {
        region = rgba.subarray(0, w * h * 4);
      } else {
        region = new Uint8Array(fw * fh * 4);
        for (let row = 0; row < fh; row++) {
          const s = ((y + row) * w + x) * 4;
          region.set(rgba.subarray(s, s + fw * 4), row * fw * 4);
        }
      }
      const q = quantize(region, fw * fh, this.maxColors);
      const minCode = Math.max(2, q.bits);
      this.frames.push({
        x, y, w: fw, h: fh, delay: delayCs,
        palette: q.palette, bits: q.bits, minCode,
        lzw: lzwEncode(q.indices, minCode),
      });
      if (this.optimize) this.prev = new Uint8Array(rgba.subarray(0, w * h * 4));
    }

    finish() {
      const out = new ByteSink(1 << 16);
      out.str('GIF89a');
      out.u16(this.width);
      out.u16(this.height);
      out.push(0x70); // no global table, 8-bit color resolution
      out.push(0);
      out.push(0);
      if (this.frames.length > 1 || this.loop !== 1) {
        out.push(0x21); out.push(0xff); out.push(11);
        out.str('NETSCAPE2.0');
        out.push(3); out.push(1);
        out.u16(this.loop);
        out.push(0);
      }
      for (const f of this.frames) {
        out.push(0x21); out.push(0xf9); out.push(4);
        out.push(0x04); // disposal 1: leave in place
        out.u16(f.delay);
        out.push(0);
        out.push(0);
        out.push(0x2c);
        out.u16(f.x); out.u16(f.y); out.u16(f.w); out.u16(f.h);
        out.push(0x80 | (f.bits - 1));
        out.bytes(f.palette);
        out.push(f.minCode);
        for (let p = 0; p < f.lzw.length; p += 255) {
          const n = Math.min(255, f.lzw.length - p);
          out.push(n);
          out.bytes(f.lzw.subarray(p, p + n));
        }
        out.push(0);
      }
      out.push(0x3b);
      return out.result();
    }
  }

  GifEncoder.lzwEncode = lzwEncode;
  GifEncoder.quantize = quantize;
  GifEncoder.GifEncoder = GifEncoder;
  return GifEncoder;
});
