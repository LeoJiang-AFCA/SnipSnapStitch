'use strict';
// Recorder preferences: defaults, validation and on-disk migration (no Electron dependency).
const fs = require('fs');

const DEFAULTS = { mode: 'screen', fps: 15, audio: true, mic: false, countdown: true, highlightCursor: false, optimize: true, displayId: null, windowId: null };
const PREFS_VERSION = 3;
const FPS_OPTIONS = [15, 20, 30, 60];

function load(file) {
  try {
    const p = JSON.parse(fs.readFileSync(file, 'utf8'));
    // Version 3 made 15 fps + "optimize when finished" the defaults; carry older saved prefs over to them once.
    if ((p.v || 0) < 3) {
      p.fps = DEFAULTS.fps;
      p.optimize = DEFAULTS.optimize;
    }
    return p;
  } catch (e) {
    return {};
  }
}

function save(file, o) {
  try {
    const { mode, fps, audio, mic, countdown, highlightCursor, optimize } = o;
    fs.writeFileSync(file, JSON.stringify({ v: PREFS_VERSION, mode, fps, audio, mic, countdown, highlightCursor, optimize }));
  } catch (e) { /* non-fatal */ }
}

function normalize(o) {
  const r = Object.assign({}, DEFAULTS, o || {});
  if (!['screen', 'region', 'window'].includes(r.mode)) r.mode = 'screen';
  r.fps = FPS_OPTIONS.includes(Number(r.fps)) ? Number(r.fps) : DEFAULTS.fps;
  r.audio = !!r.audio;
  r.mic = !!r.mic;
  r.countdown = r.countdown === true || (typeof r.countdown === 'number' && r.countdown > 0);
  r.highlightCursor = !!r.highlightCursor;
  r.optimize = !!r.optimize;
  return r;
}

module.exports = { DEFAULTS, PREFS_VERSION, FPS_OPTIONS, load, save, normalize };
