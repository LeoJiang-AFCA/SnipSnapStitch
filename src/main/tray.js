const path = require('path');
const { Tray, Menu, nativeImage } = require('electron');
const settings = require('./settings');
const windows = require('./windows');

let tray = null;

// Multi-size .ico lets Windows pick the sharpest frame for the tray's DPI.
function makeIcon() {
  const img = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'icon.ico'));
  return img.isEmpty() ? nativeImage.createFromPath(path.join(__dirname, '..', '..', 'assets', 'icon-32.png')) : img;
}

function accel(key) {
  const v = settings.get(key);
  return v ? `\t${v}` : '';
}

function buildMenu() {
  const cap = () => require('./capture');
  return Menu.buildFromTemplate([
    { label: `Snip Area${accel('hotkeys.region')}`, click: () => cap().captureRegion() },
    { label: 'Scroll Capture', click: () => cap().captureScrolling() },
    { label: `Record Video${accel('hotkeys.record')}`, click: () => require('./recorder').startRecording({}) },
    { label: `Full Screen${accel('hotkeys.fullscreen')}`, click: () => cap().captureFullscreen() },
    { type: 'separator' },
    { label: 'Open Library', click: () => windows.openLibrary() },
    { label: 'Settings…', click: () => windows.openSettings() },
    { type: 'separator' },
    { label: 'Quit SnipSnapStitch', role: 'quit' },
  ]);
}

function init() {
  tray = new Tray(makeIcon());
  tray.setToolTip('SnipSnapStitch (SSS)');
  const refresh = () => tray.setContextMenu(buildMenu());
  refresh();
  settings.events.on('changed', refresh);
  tray.on('click', () => windows.openLibrary());
  return tray;
}

module.exports = { init };
