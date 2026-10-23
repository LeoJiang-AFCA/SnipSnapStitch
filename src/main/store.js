'use strict';
// Library store: images/videos on disk + JSON index. See ARCHITECTURE.md.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { app, nativeImage } = require('electron');

const THUMB_MAX = 320;
const events = new EventEmitter();

let dataDirOverride = null;
let items = null; // in-memory index (newest first on disk order irrelevant; sorted in list())
let chain = Promise.resolve();

// Serialize all operations that touch the index.
function enqueue(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

function dataDir() {
  return dataDirOverride || path.join(app.getPath('userData'), 'library');
}
function setDataDir(dir) {
  dataDirOverride = dir;
  items = null;
}
function indexPath() {
  return path.join(dataDir(), 'index.json');
}
function p(id, suffix) {
  return path.join(dataDir(), id + suffix);
}

async function atomicWrite(file, data) {
  const tmp = file + '.' + process.pid + '.tmp';
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}

async function load() {
  if (items) return items;
  await fsp.mkdir(dataDir(), { recursive: true });
  try {
    const parsed = JSON.parse(await fsp.readFile(indexPath(), 'utf8'));
    items = Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    if (e.code !== 'ENOENT') {
      try { await fsp.copyFile(indexPath(), indexPath() + '.corrupt'); } catch (_) { /* ignore */ }
    }
    items = [];
  }
  return items;
}

async function saveIndex() {
  await atomicWrite(indexPath(), JSON.stringify(items, null, 2));
}

function emitChanged(detail) {
  events.emit('changed', detail);
}

function newId() {
  return Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

function defaultName(prefix) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${prefix} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`;
}

function makeThumbBuffer(img) {
  const { width, height } = img.getSize();
  if (!width || !height) return null;
  const scale = Math.min(1, THUMB_MAX / Math.max(width, height));
  const t = scale < 1
    ? img.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'good' })
    : img;
  return t.toJPEG(82);
}

async function writeThumbFromImage(id, img) {
  try {
    if (!img || img.isEmpty()) return false;
    const out = makeThumbBuffer(img);
    if (!out) return false;
    await fsp.writeFile(p(id, '.thumb.jpg'), out);
    return true;
  } catch (_) {
    return false;
  }
}

function writeThumbFromBuffer(id, buf) {
  return writeThumbFromImage(id, nativeImage.createFromBuffer(buf));
}

function clone(it) {
  return it ? { ...it, tags: [...(it.tags || [])] } : null;
}

function find(id) {
  const it = items.find((x) => x.id === id);
  if (!it) throw new Error('Item not found: ' + id);
  return it;
}

async function addCapture(pngBuffer, opts = {}) {
  return enqueue(async () => {
    await load();
    const img = nativeImage.createFromBuffer(pngBuffer);
    if (img.isEmpty()) throw new Error('Invalid image data');
    const { width, height } = img.getSize();
    const id = newId();
    const buf = Buffer.isBuffer(pngBuffer) ? pngBuffer : Buffer.from(pngBuffer);
    await fsp.writeFile(p(id, '.png'), buf);
    // Both the working copy and the pristine original are written; the file copy is much cheaper than a second write of the buffer.
    await Promise.all([
      fsp.copyFile(p(id, '.png'), p(id, '.orig.png')),
      writeThumbFromImage(id, img),
    ]);
    const now = Date.now();
    const item = {
      id, type: 'image', source: opts.source || 'region',
      file: id + '.png', width, height, createdAt: now, updatedAt: now,
      name: opts.name || defaultName('Capture'),
      tags: [], favorite: false, sizeBytes: buf.length,
    };
    items.push(item);
    await saveIndex();
    emitChanged({ type: 'add', id });
    return clone(item);
  });
}

async function addMedia(buffer, opts = {}) {
  return enqueue(async () => {
    await load();
    const ext = ['webm', 'mp4', 'gif'].includes(opts.ext) ? opts.ext : 'webm';
    const id = newId();
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    await fsp.writeFile(p(id, '.' + ext), buf);
    if (opts.thumbBuffer) await writeThumbFromBuffer(id, Buffer.from(opts.thumbBuffer));
    const now = Date.now();
    const item = {
      id, type: ext === 'gif' ? 'gif' : 'video', source: opts.source || 'recording',
      file: id + '.' + ext, width: opts.width || 0, height: opts.height || 0,
      createdAt: now, updatedAt: now,
      name: opts.name || defaultName(ext === 'gif' ? 'GIF' : 'Recording'),
      tags: [], favorite: false, sizeBytes: buf.length,
    };
    items.push(item);
    await saveIndex();
    emitChanged({ type: 'add', id });
    return clone(item);
  });
}

// Replaces a video's file (e.g. with an optimized re-encode). `srcPath` is moved into the library as <id>.<ext>.
async function replaceMedia(id, srcPath, ext, opts = {}) {
  return enqueue(async () => {
    await load();
    const it = find(id);
    if (!['webm', 'mp4'].includes(ext) || it.type !== 'video') throw new Error('Cannot replace this item');
    const dest = p(id, '.' + ext);
    const old = path.join(dataDir(), it.file);
    await fsp.rename(srcPath, dest);
    if (old !== dest) await fsp.unlink(old).catch(() => {});
    it.file = id + '.' + ext;
    it.sizeBytes = opts.sizeBytes || (await fsp.stat(dest)).size;
    it.optimized = true;
    it.updatedAt = Date.now();
    await saveIndex();
    emitChanged({ type: 'update', id });
    return clone(it);
  });
}

async function list(filter = {}) {
  return enqueue(async () => {
    await load();
    const types = filter.type ? [].concat(filter.type) : null;
    const q = (filter.search || '').trim().toLowerCase();
    return items
      .filter((it) => !types || types.includes(it.type))
      .filter((it) => !filter.favorite || it.favorite)
      .filter((it) => !q || [it.name, it.source, it.type, ...(it.tags || [])].some((s) => String(s).toLowerCase().includes(q)))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(clone);
  });
}

async function get(id) {
  return enqueue(async () => {
    await load();
    return clone(items.find((x) => x.id === id));
  });
}

async function getFilePath(id) {
  const it = await get(id);
  return it ? path.join(dataDir(), it.file) : null;
}

async function getOriginalPath(id) {
  const it = await get(id);
  if (!it || it.type !== 'image') return null;
  return p(id, '.orig.png');
}

async function getThumbPath(id) {
  const it = await get(id);
  if (!it) return null;
  const tp = p(id, '.thumb.jpg');
  return fs.existsSync(tp) ? tp : null;
}

async function updateImage(id, pngBuffer) {
  return enqueue(async () => {
    await load();
    const it = find(id);
    const buf = Buffer.isBuffer(pngBuffer) ? pngBuffer : Buffer.from(pngBuffer);
    const img = nativeImage.createFromBuffer(buf);
    if (img.isEmpty()) throw new Error('Invalid image data');
    const size = img.getSize();
    await Promise.all([
      fsp.writeFile(path.join(dataDir(), it.file), buf),
      writeThumbFromImage(id, img),
    ]);
    it.width = size.width;
    it.height = size.height;
    it.sizeBytes = buf.length;
    it.updatedAt = Date.now();
    await saveIndex();
    emitChanged({ type: 'update', id });
    return clone(it);
  });
}

// Set/replace the thumbnail (e.g. generated by the renderer for videos) and optionally the dimensions.
async function setThumb(id, imageBuffer, dims = {}) {
  return enqueue(async () => {
    await load();
    const it = find(id);
    const ok = await writeThumbFromBuffer(id, Buffer.from(imageBuffer));
    if (dims.width && dims.height && !it.width) {
      it.width = dims.width;
      it.height = dims.height;
    }
    it.updatedAt = Date.now();
    await saveIndex();
    if (ok) emitChanged({ type: 'update', id });
    return clone(it);
  });
}

async function saveAnnotations(id, obj) {
  return enqueue(async () => {
    await load();
    find(id);
    await atomicWrite(p(id, '.annot.json'), JSON.stringify(obj));
    return true;
  });
}

async function getAnnotations(id) {
  try {
    return JSON.parse(await fsp.readFile(p(id, '.annot.json'), 'utf8'));
  } catch (_) {
    return null;
  }
}

async function mutate(id, fn, type = 'update') {
  return enqueue(async () => {
    await load();
    const it = find(id);
    fn(it);
    await saveIndex();
    emitChanged({ type, id });
    return clone(it);
  });
}

const rename = (id, name) => mutate(id, (it) => {
  const n = String(name || '').trim();
  if (n) it.name = n;
});
const setFavorite = (id, fav) => mutate(id, (it) => { it.favorite = !!fav; });
const setTags = (id, tags) => mutate(id, (it) => {
  const seen = new Set();
  it.tags = (Array.isArray(tags) ? tags : String(tags || '').split(','))
    .map((t) => String(t).trim())
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
});

async function remove(id) {
  return enqueue(async () => {
    await load();
    const idx = items.findIndex((x) => x.id === id);
    if (idx < 0) return false;
    items.splice(idx, 1);
    await saveIndex();
    try {
      const files = await fsp.readdir(dataDir());
      await Promise.all(files.filter((f) => f.startsWith(id + '.')).map((f) => fsp.unlink(path.join(dataDir(), f)).catch(() => {})));
    } catch (_) { /* ignore */ }
    emitChanged({ type: 'remove', id });
    return true;
  });
}

// Minimal single-page PDF embedding a JPEG.
function buildPdf(jpeg, w, h) {
  const pw = Math.round(w * 0.75), ph = Math.round(h * 0.75);
  const parts = [];
  const offsets = [];
  let len = 0;
  const push = (b) => { const buf = Buffer.isBuffer(b) ? b : Buffer.from(b, 'latin1'); parts.push(buf); len += buf.length; };
  const obj = (n, body) => { offsets[n] = len; push(`${n} 0 obj\n`); push(body); push('\nendobj\n'); };
  push('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>`);
  const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
  obj(4, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  offsets[5] = len;
  push('5 0 obj\n');
  push(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  push(jpeg);
  push('\nendstream\nendobj\n');
  const xref = len;
  let x = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(x);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
}

// Returns { path, format } (the path/format actually written; webp falls back to png since nativeImage can't encode it).
async function exportTo(id, destPath, opts = {}) {
  const it = await get(id);
  if (!it) throw new Error('Item not found: ' + id);
  const src = path.join(dataDir(), it.file);
  if (it.type !== 'image') {
    await fsp.copyFile(src, destPath);
    return { path: destPath, format: path.extname(src).slice(1) };
  }
  let format = String(opts.format || path.extname(destPath).slice(1) || 'png').toLowerCase();
  if (format === 'jpeg') format = 'jpg';
  const quality = Math.min(100, Math.max(1, Math.round(opts.quality || 92)));
  let out = destPath;
  let data;
  if (format === 'jpg' || format === 'pdf') {
    const img = nativeImage.createFromPath(src);
    const jpg = img.toJPEG(format === 'pdf' ? 95 : quality);
    data = format === 'pdf' ? buildPdf(jpg, it.width, it.height) : jpg;
  } else {
    if (format === 'webp') {
      format = 'png';
      out = destPath.replace(/\.webp$/i, '') + '.png';
    }
    data = await fsp.readFile(src);
  }
  await fsp.mkdir(path.dirname(out), { recursive: true });
  await fsp.writeFile(out, data);
  return { path: out, format };
}

module.exports = {
  events, setDataDir, dataDir,
  addCapture, addMedia, replaceMedia, list, get, getFilePath, getOriginalPath, getThumbPath,
  updateImage, setThumb, saveAnnotations, getAnnotations,
  rename, setFavorite, setTags, remove, exportTo,
};
