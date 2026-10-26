'use strict';
// With process-per-site, a transparent window whose renderer process already hosts another window comes up with an
// opaque white page background: Electron only applies the transparent background to the first page in a process.
// Re-applying it as the page loads (before 'ready-to-show') keeps such windows see-through.
function keepTransparent(win) {
  const apply = () => { if (!win.isDestroyed()) win.setBackgroundColor('#00000000'); };
  win.webContents.on('did-start-loading', apply);
  win.webContents.on('dom-ready', apply);
  return win;
}

module.exports = { keepTransparent };
