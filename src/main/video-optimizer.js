'use strict';
/**
 * Re-encodes library videos to a much smaller H.264 MP4 with a bundled ffmpeg.
 *
 * The recorder encodes in real time (fast, low-effort settings). Re-encoding afterwards with a slower preset and a
 * constant-quality target typically shrinks screen recordings 5-10x. Jobs run one at a time at low priority.
 * The result replaces the library item's file, and only when it is meaningfully smaller.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

const events = new EventEmitter(); // 'progress' {id, progress}, 'done' {id, before, after, replaced, error?}
const PRESETS = {
  balanced: { crf: 28, maxSide: 0 }, // looks the same, much smaller
  smallest: { crf: 33, maxSide: 1280 }, // visibly softer, smallest
};
const MIN_GAIN = 0.9; // keep the result only if it is under 90% of the original size
// Inputs are opened with the demuxer their extension implies and from local files only, so a library file whose
// content is e.g. a playlist can't make ffmpeg read other files or URLs.
const INPUT_FORMATS = { '.webm': 'matroska', '.mkv': 'matroska', '.mp4': 'mov', '.mov': 'mov' };

const jobs = new Map(); // id -> { child, cancelled, progress }
const queue = [];
let running = false;

function ffmpegPath() {
  const p = require('ffmpeg-static');
  return p ? p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep) : null;
}

function buildArgs(input, output, opts = {}) {
  const preset = PRESETS[opts.preset] || PRESETS.balanced;
  const fps = Math.max(5, Math.min(30, Math.round(opts.fps || 30)));
  // Even dimensions are required by yuv420p; maxSide optionally scales the longer side down.
  const filters = [`fps=${fps}`];
  if (preset.maxSide) {
    filters.push(`scale=w='trunc(if(gt(iw,ih),min(${preset.maxSide},iw),min(${preset.maxSide}*iw/ih,iw))/2)*2':h=-2`);
  } else {
    filters.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');
  }
  const format = INPUT_FORMATS[path.extname(input).toLowerCase()];
  if (!format) throw new Error('Unsupported video format: ' + path.extname(input));
  return [
    '-hide_banner', '-nostdin', '-y', '-protocol_whitelist', 'file', '-f', format, '-i', input,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', filters.join(','),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', String(preset.crf), '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k',
    '-movflags', '+faststart',
    '-progress', 'pipe:1', '-nostats',
    output,
  ];
}

// "00:00:38.75" -> ms
function parseDuration(text) {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  return m ? ((+m[1] * 60 + +m[2]) * 60 + parseFloat(m[3])) * 1000 : 0;
}

// `-progress` lines: out_time_us=1234567 (microseconds; older builds call it out_time_ms)
function parseOutTimeMs(line) {
  const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
  return m ? parseInt(m[1], 10) / 1000 : null;
}

function runFfmpeg(job, input, output, opts, onProgress) {
  return new Promise((resolve, reject) => {
    const bin = ffmpegPath();
    if (!bin || !fs.existsSync(bin)) return reject(new Error('The video optimizer (ffmpeg) is not installed.'));
    const child = spawn(bin, buildArgs(input, output, opts), { windowsHide: true });
    job.child = child;
    try { os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (e) { /* not fatal */ }
    let total = opts.durationMs || 0;
    let errText = '';
    let buf = '';
    child.stderr.on('data', (d) => {
      errText = (errText + d.toString()).slice(-4000);
      if (!total) total = parseDuration(errText);
    });
    child.stdout.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const line of lines) {
        const ms = parseOutTimeMs(line);
        if (ms !== null && total > 0) onProgress(Math.max(0, Math.min(0.99, ms / total)));
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (job.cancelled) return reject(new Error('cancelled'));
      if (code === 0) return resolve();
      const last = errText.trim().split(/\r?\n/).pop();
      reject(new Error('ffmpeg failed' + (last ? ': ' + last : ` (exit ${code})`)));
    });
  });
}

async function runJob(id, opts) {
  const store = require('./store');
  const job = jobs.get(id);
  const item = await store.get(id);
  if (!item || item.type !== 'video') throw new Error('Only videos can be optimized.');
  const input = path.join(store.dataDir(), item.file);
  const output = path.join(store.dataDir(), id + '.optimizing.mp4');
  const before = fs.statSync(input).size;
  try {
    await runFfmpeg(job, input, output, opts, (p) => {
      job.progress = p;
      events.emit('progress', { id, progress: p });
    });
    const after = fs.statSync(output).size;
    if (after >= before * MIN_GAIN) return { id, before, after, replaced: false };
    await store.replaceMedia(id, output, 'mp4', { sizeBytes: after });
    return { id, before, after, replaced: true };
  } finally {
    fs.promises.unlink(output).catch(() => {}); // gone already after a successful replace
  }
}

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const { id, opts } = queue.shift();
    let result;
    try {
      result = await runJob(id, opts);
    } catch (e) {
      result = { id, replaced: false, cancelled: e.message === 'cancelled', error: e.message };
    }
    jobs.delete(id);
    events.emit('done', { ...result, notify: !!opts.notify });
  }
  running = false;
}

/**
 * Queues a video for optimization. opts: { preset: 'balanced'|'smallest', fps, durationMs }.
 * Returns false if it is already queued/running.
 */
function optimize(id, opts = {}) {
  if (jobs.has(id)) return false;
  jobs.set(id, { child: null, cancelled: false, progress: 0 });
  queue.push({ id, opts });
  events.emit('progress', { id, progress: 0 });
  pump();
  return true;
}

function cancel(id) {
  const job = jobs.get(id);
  if (!job) return false;
  job.cancelled = true;
  const i = queue.findIndex((q) => q.id === id);
  if (i >= 0) {
    queue.splice(i, 1);
    jobs.delete(id);
    events.emit('done', { id, replaced: false, cancelled: true });
  } else if (job.child) {
    try { job.child.kill(); } catch (e) { /* already gone */ }
  }
  return true;
}

function active() {
  return [...jobs.entries()].map(([id, j]) => ({ id, progress: j.progress }));
}

function cancelAll() {
  for (const id of [...jobs.keys()]) cancel(id);
}

// Removes half-written output left behind by a crash or quit.
function cleanStale(dir) {
  try {
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.optimizing.mp4')) fs.unlinkSync(path.join(dir, f));
  } catch (e) { /* ignore */ }
}

module.exports = { events, PRESETS, optimize, cancel, cancelAll, active, cleanStale, buildArgs, parseDuration, parseOutTimeMs };
