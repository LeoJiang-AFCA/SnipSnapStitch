'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const opt = require('../src/main/video-optimizer');

const ffmpeg = require('ffmpeg-static');

test('parses ffmpeg duration and progress output', () => {
  assert.strictEqual(opt.parseDuration('  Duration: 00:01:02.50, start: 0.0'), 62500);
  assert.strictEqual(opt.parseDuration('no duration here'), 0);
  assert.strictEqual(opt.parseOutTimeMs('out_time_us=1500000'), 1500);
  assert.strictEqual(opt.parseOutTimeMs('out_time_ms=2000000'), 2000);
  assert.strictEqual(opt.parseOutTimeMs('frame=12'), null);
});

test('frame rate is capped at 30 and the preset decides crf', () => {
  const a = opt.buildArgs('in.webm', 'out.mp4', { preset: 'balanced', fps: 60 });
  assert.ok(a.join(' ').includes('fps=30'));
  assert.strictEqual(a[a.indexOf('-crf') + 1], '28');
  const b = opt.buildArgs('in.webm', 'out.mp4', { preset: 'smallest', fps: 15 });
  assert.ok(b.join(' ').includes('fps=15'));
  assert.strictEqual(b[b.indexOf('-crf') + 1], '33');
});

test('an input that is really a playlist is not followed to other files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-opt-'));
  try {
    const gen = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=64x48:rate=10:duration=1', '-c:v', 'libx264', path.join(dir, 'other.mkv')]);
    assert.strictEqual(gen.status, 0, String(gen.stderr));
    const evil = path.join(dir, 'evil.mp4');
    fs.writeFileSync(evil, 'ffconcat version 1.0\nfile other.mkv\n');
    const run = spawnSync(ffmpeg, opt.buildArgs(evil, path.join(dir, 'out.mp4'), {}));
    assert.notStrictEqual(run.status, 0);
    assert.throws(() => opt.buildArgs(path.join(dir, 'list.m3u8'), path.join(dir, 'out.mp4')), /Unsupported/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const [preset, size, maxW] of [['balanced', '321x241', 321], ['smallest', '1921x1081', 1280]]) {
  test(`ffmpeg re-encodes a ${size} source with the ${preset} preset to even dimensions`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-opt-'));
    try {
      const src = path.join(dir, 'in.mkv');
      const out = path.join(dir, 'out.mp4');
      const gen = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc=size=${size}:rate=10:duration=1`, '-c:v', 'libx264', '-pix_fmt', 'yuv444p', src]);
      assert.strictEqual(gen.status, 0, String(gen.stderr));
      const run = spawnSync(ffmpeg, opt.buildArgs(src, out, { preset, fps: 30 }));
      assert.strictEqual(run.status, 0, String(run.stderr));
      assert.ok(fs.statSync(out).size > 0);
      const probe = spawnSync(ffmpeg, ['-hide_banner', '-i', out]).stderr.toString();
      const m = /Video: h264[^\n]*?, (\d+)x(\d+)/.exec(probe);
      assert.ok(m, probe);
      const w = +m[1], h = +m[2];
      assert.strictEqual(w % 2, 0);
      assert.strictEqual(h % 2, 0);
      assert.ok(w <= maxW);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
