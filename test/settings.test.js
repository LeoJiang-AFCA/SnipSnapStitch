'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { userData } = require('./helpers/mock-electron');

const fresh = () => {
  delete require.cache[require.resolve('../src/main/settings')];
  return require('../src/main/settings');
};
const file = path.join(userData, 'settings.json');

test('defaults: hotkeys, after-capture action and launch at login', () => {
  fs.rmSync(file, { force: true });
  const s = fresh();
  assert.equal(s.get('hotkeys.region'), 'Ctrl+Shift+S');
  assert.equal(s.get('hotkeys.record'), 'Ctrl+Shift+R');
  assert.equal(s.get('afterCapture'), 'editor');
  assert.equal(s.get('launchAtLogin'), true);
});

test('setMany persists known keys only and emits changed', () => {
  fs.rmSync(file, { force: true });
  const s = fresh();
  let fired = 0;
  s.events.on('changed', () => fired++);
  s.setMany({ delaySeconds: 3, launchAtLogin: false, notASetting: 1 });
  assert.equal(fired, 1);
  assert.equal(s.get('delaySeconds'), 3);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.delaySeconds, 3);
  assert.equal(saved.launchAtLogin, false);
  assert.ok(!('notASetting' in saved));
});

test('saved values survive a reload and new defaults still apply', () => {
  fs.writeFileSync(file, JSON.stringify({ afterCapture: 'library' }));
  const s = fresh();
  assert.equal(s.get('afterCapture'), 'library');
  assert.equal(s.get('hotkeys.fullscreen'), 'Ctrl+Shift+F');
});

test('a corrupt settings file falls back to defaults', () => {
  fs.writeFileSync(file, '{oops');
  const s = fresh();
  assert.equal(s.get('afterCapture'), 'editor');
});

test('older settings files move to Start with Windows once; a later untick is kept', () => {
  fs.writeFileSync(file, JSON.stringify({ launchAtLogin: false, afterCapture: 'library' }));
  let s = fresh();
  assert.equal(s.get('launchAtLogin'), true);
  assert.equal(s.get('afterCapture'), 'library');
  s.setMany({ launchAtLogin: false });
  s = fresh();
  assert.equal(s.get('launchAtLogin'), false);
});
