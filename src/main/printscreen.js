// Optional: make Print Screen open SnipSnapStitch instead of the Windows Snipping Tool.
// Windows routes Print Screen to the Snipping Tool through a per-user setting; while the option is on that setting is
// switched off (the original value is remembered) and the app registers Print Screen itself (see shortcuts.js).
// The setting is put back when the option is turned off and when the app quits.
const path = require('path');
const { execFileSync } = require('child_process');
const settings = require('./settings');

const KEY = 'HKCU\\Control Panel\\Keyboard';
const NAME = 'PrintScreenKeyForSnippingEnabled';
// Full path, so a reg.exe in the current directory is never picked up.
const REG_EXE = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');

// Value of the registry setting from `reg query` output; null when it is not set.
function parseQuery(out) {
  const m = new RegExp(`${NAME}\\s+REG_DWORD\\s+0x([0-9a-f]+)`, 'i').exec(String(out || ''));
  return m ? parseInt(m[1], 16) : null;
}

const reg = (args) => execFileSync(REG_EXE, args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });

function readValue() {
  try { return parseQuery(reg(['query', KEY, '/v', NAME])); } catch { return null; }
}

function writeValue(v) {
  try {
    if (v === null) reg(['delete', KEY, '/v', NAME, '/f']);
    else reg(['add', KEY, '/v', NAME, '/t', 'REG_DWORD', '/d', String(v), '/f']);
  } catch (e) { console.warn('[printscreen] registry update failed:', e.message); }
}

const supported = () => process.platform === 'win32';
// The remembered original value: a number, or 'unset' when the setting did not exist.
const remembered = () => settings.get('printScreenBackup');

function enable() {
  if (!supported()) return;
  const cur = readValue();
  // After a crash the setting is still switched off; keep the value remembered back then.
  if (remembered() === null || cur !== 0) settings.set('printScreenBackup', cur === null ? 'unset' : cur);
  if (cur !== 0) writeValue(0);
}

function restore() {
  if (!supported()) return;
  const b = remembered();
  if (b === null) return;
  writeValue(b === 'unset' ? null : Number(b));
}

function sync() {
  if (settings.get('replacePrintScreen')) enable();
  else if (remembered() !== null) { restore(); settings.set('printScreenBackup', null); }
}

function init() {
  sync();
  settings.events.on('changed', (key) => { if (!key || key === 'replacePrintScreen') sync(); });
}

module.exports = { init, restore, parseQuery };
