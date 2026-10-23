'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const prefs = require('../src/main/recorder-prefs');

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sss-prefs-')), 'recorder-prefs.json');

test('defaults are 15 fps with optimize-when-finished on', () => {
  const n = prefs.normalize({});
  assert.equal(n.fps, 15);
  assert.equal(n.optimize, true);
  assert.equal(n.mode, 'screen');
});

test('normalize rejects bad values and coerces types', () => {
  const n = prefs.normalize({ mode: 'bogus', fps: 24, audio: 1, mic: 0, countdown: 3, highlightCursor: 'yes', optimize: 0 });
  assert.equal(n.mode, 'screen');
  assert.equal(n.fps, 15);
  assert.equal(n.audio, true);
  assert.equal(n.mic, false);
  assert.equal(n.countdown, true);
  assert.equal(n.highlightCursor, true);
  assert.equal(n.optimize, false);
  assert.equal(prefs.normalize({ countdown: 0 }).countdown, false);
  assert.equal(prefs.normalize({ fps: '30' }).fps, 30);
  assert.equal(prefs.normalize(null).fps, 15);
});

test('prefs saved by an older version are moved to the new defaults once', () => {
  const f = tmpFile();
  fs.writeFileSync(f, JSON.stringify({ mode: 'region', fps: 30, optimize: false, audio: false }));
  const loaded = prefs.load(f);
  assert.equal(loaded.fps, 15);
  assert.equal(loaded.optimize, true);
  assert.equal(loaded.mode, 'region');
  assert.equal(loaded.audio, false);
});

test('a choice made after the migration is kept', () => {
  const f = tmpFile();
  prefs.save(f, prefs.normalize({ fps: 30, optimize: false, mode: 'region' }));
  const loaded = prefs.load(f);
  assert.equal(loaded.v, prefs.PREFS_VERSION);
  assert.equal(loaded.fps, 30);
  assert.equal(loaded.optimize, false);
  assert.equal(prefs.normalize(loaded).mode, 'region');
});

test('save does not persist per-session display/window choices', () => {
  const f = tmpFile();
  prefs.save(f, { ...prefs.normalize({}), displayId: 7, windowId: 'abc' });
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.ok(!('displayId' in raw) && !('windowId' in raw));
});

test('missing or corrupt prefs file loads as empty', () => {
  assert.deepEqual(prefs.load(path.join(os.tmpdir(), 'sss-does-not-exist.json')), {});
  const f = tmpFile();
  fs.writeFileSync(f, '{not json');
  assert.deepEqual(prefs.load(f), {});
});
