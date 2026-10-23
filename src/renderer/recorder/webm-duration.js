/* Patches a Duration element into MediaRecorder WebM output (which lacks one),
 * so players can show the length and seek. UMD: window.WebmDuration / module.exports.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WebmDuration = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ID_SEGMENT = 0x18538067;
  const ID_INFO = 0x1549a966;
  const ID_TIMECODE_SCALE = 0x2ad7b1;
  const ID_DURATION = 0x4489;

  function readId(buf, pos) {
    const b = buf[pos];
    if (b === undefined) return null;
    let len = 1;
    let mask = 0x80;
    while (len <= 4 && !(b & mask)) { len++; mask >>= 1; }
    if (len > 4 || pos + len > buf.length) return null;
    let id = 0;
    for (let i = 0; i < len; i++) id = id * 256 + buf[pos + i];
    return { id, len };
  }

  // Returns { value, len, unknown } or null.
  function readSize(buf, pos) {
    const b = buf[pos];
    if (b === undefined) return null;
    let len = 1;
    let mask = 0x80;
    while (len <= 8 && !(b & mask)) { len++; mask >>= 1; }
    if (len > 8 || pos + len > buf.length) return null;
    let value = b & (mask - 1);
    let allOnes = value === mask - 1;
    for (let i = 1; i < len; i++) {
      value = value * 256 + buf[pos + i];
      if (buf[pos + i] !== 255) allOnes = false;
    }
    return { value, len, unknown: allOnes };
  }

  function encodeSize8(value) {
    const out = new Uint8Array(8);
    out[0] = 0x01;
    let v = value;
    for (let i = 7; i >= 1; i--) { out[i] = v % 256; v = Math.floor(v / 256); }
    return out;
  }

  // buf: Uint8Array; durationMs: number. Returns a Uint8Array (possibly the same one).
  function fixDuration(buf, durationMs) {
    try {
      if (!(durationMs > 0)) return buf;
      let pos = 0;
      const head = readId(buf, pos);
      if (!head || head.id !== 0x1a45dfa3) return buf;
      const hs = readSize(buf, pos + head.len);
      if (!hs) return buf;
      pos += head.len + hs.len + hs.value;

      const seg = readId(buf, pos);
      if (!seg || seg.id !== ID_SEGMENT) return buf;
      const segSizePos = pos + seg.len;
      const segSize = readSize(buf, segSizePos);
      if (!segSize) return buf;
      const segDataStart = segSizePos + segSize.len;

      // Walk the segment's top-level children until Info.
      pos = segDataStart;
      let infoPos = -1, info = null, infoSize = null;
      while (pos < buf.length) {
        const el = readId(buf, pos);
        if (!el) return buf;
        const sz = readSize(buf, pos + el.len);
        if (!sz) return buf;
        if (el.id === ID_INFO) {
          infoPos = pos; info = el; infoSize = sz;
          break;
        }
        if (sz.unknown) return buf;
        pos += el.len + sz.len + sz.value;
      }
      if (infoPos < 0) return buf;

      const contentStart = infoPos + info.len + infoSize.len;
      const contentEnd = contentStart + infoSize.value;
      let timecodeScale = 1000000;
      let durPos = -1, durSize = 0;
      for (let p = contentStart; p < contentEnd;) {
        const el = readId(buf, p);
        if (!el) return buf;
        const sz = readSize(buf, p + el.len);
        if (!sz) return buf;
        const dataPos = p + el.len + sz.len;
        if (el.id === ID_TIMECODE_SCALE) {
          let v = 0;
          for (let i = 0; i < sz.value; i++) v = v * 256 + buf[dataPos + i];
          if (v > 0) timecodeScale = v;
        } else if (el.id === ID_DURATION) {
          durPos = dataPos; durSize = sz.value;
        }
        p = dataPos + sz.value;
      }
      const ticks = (durationMs * 1e6) / timecodeScale;

      if (durPos >= 0) {
        const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        if (durSize === 8) dv.setFloat64(durPos, ticks);
        else if (durSize === 4) dv.setFloat32(durPos, ticks);
        else return buf;
        return buf;
      }

      const dur = new Uint8Array(11);
      dur[0] = 0x44; dur[1] = 0x89; dur[2] = 0x88;
      new DataView(dur.buffer).setFloat64(3, ticks);

      const newInfoSize = encodeSize8(infoSize.value + dur.length);
      const parts = [];
      if (segSize.unknown) {
        parts.push(buf.subarray(0, infoPos));
      } else {
        // Known segment size: grow it, re-encoded in 8 bytes (shifts later offsets).
        const grown = encodeSize8(segSize.value + dur.length + (8 - infoSize.len));
        parts.push(buf.subarray(0, segSizePos), grown, buf.subarray(segDataStart, infoPos));
      }
      parts.push(buf.subarray(infoPos, infoPos + info.len), newInfoSize,
        buf.subarray(contentStart, contentEnd), dur, buf.subarray(contentEnd));
      let total = 0;
      for (const p of parts) total += p.length;
      const out = new Uint8Array(total);
      let o = 0;
      for (const p of parts) { out.set(p, o); o += p.length; }
      return out;
    } catch (e) {
      return buf;
    }
  }

  return { fixDuration };
});
