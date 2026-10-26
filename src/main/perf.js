'use strict';
// Opt-in timing log (SSS_PERF=1 or --perf): start-up phases and capture latency (hotkey -> overlay on screen,
// mouse release -> editor ready). Lines go to the console and to <userData>\perf.log so builds can be compared.
const fs = require('fs');
const path = require('path');

const enabled = !!process.env.SSS_PERF || process.argv.includes('--perf');
let current = null;
let seq = 0;

function write(line) {
  console.log('[perf] ' + line);
  try {
    const file = path.join(require('electron').app.getPath('userData'), 'perf.log');
    fs.appendFile(file, new Date().toISOString() + ' ' + line + '\n', () => {});
  } catch {}
}

// Start-up milestone, measured from process start.
function mark(name) {
  if (enabled) write(`startup ${name} +${Math.round(performance.now())}ms`);
}

// Starts a named timeline (e.g. one capture); step() calls are logged against it until the next begin().
function begin(name) {
  if (!enabled) return;
  const t = performance.now();
  current = { name: `${name}#${++seq}`, t0: t, last: t };
  write(`${current.name} start`);
}

function step(what) {
  if (!enabled || !current) return;
  const t = performance.now();
  write(`${current.name} ${what} +${Math.round(t - current.t0)}ms (step ${Math.round(t - current.last)}ms)`);
  current.last = t;
}

module.exports = { enabled, mark, begin, step };
