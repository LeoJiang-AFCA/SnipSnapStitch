const { globalShortcut } = require('electron');
const settings = require('./settings');

const ACTIONS = {
  'hotkeys.region': () => require('./capture').captureRegion(),
  'hotkeys.fullscreen': () => require('./capture').captureFullscreen(),
  'hotkeys.record': () => require('./recorder').startRecording({}),
};

function toAccelerator(s) {
  return String(s || '').replace(/\bCtrl\b/i, 'CommandOrControl');
}

function registerAll() {
  globalShortcut.unregisterAll();
  const failed = [];
  if (settings.get('replacePrintScreen')) {
    let ok = false;
    try { ok = globalShortcut.register('PrintScreen', () => Promise.resolve().then(ACTIONS['hotkeys.region']).catch((err) => console.error('PrintScreen failed', err))); } catch {}
    if (!ok) failed.push('printscreen');
  }
  for (const [key, fn] of Object.entries(ACTIONS)) {
    const accel = toAccelerator(settings.get(key));
    if (!accel) continue;
    let ok = false;
    try {
      ok = globalShortcut.register(accel, () => {
        Promise.resolve()
          .then(fn)
          .catch((err) => console.error(`${key} failed`, err));
      });
    } catch {}
    if (!ok) failed.push(key);
  }
  return failed;
}

function init() {
  registerAll();
  settings.events.on('changed', registerAll);
}

module.exports = { init, registerAll };
