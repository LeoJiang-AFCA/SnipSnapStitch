const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { EventEmitter } = require('events');

const DEFAULTS = {
  'hotkeys.region': 'Ctrl+Shift+S',
  'hotkeys.fullscreen': 'Ctrl+Shift+F',
  'hotkeys.window': 'Ctrl+Shift+W',
  'hotkeys.record': 'Ctrl+Shift+R',
  afterCapture: 'editor',
  launchAtLogin: false,
  replacePrintScreen: false,
  printScreenBackup: null,
  copyToClipboard: false,
  captureCursor: false,
  delaySeconds: 0,
  saveFolder: null,
};

const events = new EventEmitter();
let cache = null;

function file() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function load() {
  if (cache) return cache;
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {}
  cache = { ...DEFAULTS, ...saved };
  return cache;
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    const tmp = file() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
    fs.renameSync(tmp, file());
  } catch (err) {
    console.error('settings persist failed', err);
  }
}

function get(key) {
  const s = load();
  return key in s ? s[key] : DEFAULTS[key];
}

function set(key, val) {
  load()[key] = val;
  persist();
  events.emit('changed', key, val);
}

function setMany(obj) {
  const s = load();
  for (const [k, v] of Object.entries(obj || {})) {
    if (k in DEFAULTS) s[k] = v;
  }
  persist();
  events.emit('changed');
}

function getAll() {
  return { ...load() };
}

module.exports = { get, set, setMany, getAll, events, DEFAULTS };
