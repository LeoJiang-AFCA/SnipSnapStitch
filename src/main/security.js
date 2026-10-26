'use strict';
// App-wide hardening, installed once at startup (main.js) before any IPC handler is registered:
// - IPC is accepted only from our own pages (file:// under src/renderer), so content that somehow ended up in one of
//   our windows could not drive the main process.
// - Pages can't navigate away, open new windows or attach <webview>s.
const path = require('path');
const { fileURLToPath } = require('url');
const { app, ipcMain } = require('electron');

const RENDERER_DIR = path.join(__dirname, '..', 'renderer').toLowerCase() + path.sep;

function senderUrl(e) {
  try { return (e && e.senderFrame && e.senderFrame.url) || ''; } catch (_) { return ''; }
}

function isTrustedSender(e) {
  const url = senderUrl(e);
  if (!url.startsWith('file:')) return false;
  try {
    return path.resolve(fileURLToPath(url)).toLowerCase().startsWith(RENDERER_DIR);
  } catch (_) {
    return false;
  }
}

function blocked(channel, e) {
  console.warn(`[security] blocked IPC "${channel}" from "${senderUrl(e) || 'unknown'}"`);
}

function guardIpc() {
  const guardHandler = (channel, fn) => (e, ...args) => {
    if (!isTrustedSender(e)) {
      blocked(channel, e);
      throw new Error('IPC sender not allowed');
    }
    return fn(e, ...args);
  };
  const handle = ipcMain.handle.bind(ipcMain);
  const handleOnce = ipcMain.handleOnce.bind(ipcMain);
  ipcMain.handle = (channel, fn) => handle(channel, guardHandler(channel, fn));
  ipcMain.handleOnce = (channel, fn) => handleOnce(channel, guardHandler(channel, fn));

  const on = ipcMain.on.bind(ipcMain);
  ipcMain.on = ipcMain.addListener = (channel, fn) => {
    const guarded = function (e, ...args) {
      if (!isTrustedSender(e)) {
        blocked(channel, e);
        if (e) e.returnValue = null; // never leave a sendSync caller waiting
        return undefined;
      }
      return fn.call(this, e, ...args);
    };
    guarded.listener = fn; // lets removeListener(channel, fn) find it, as for once() wrappers
    on(channel, guarded);
    return ipcMain;
  };
}

function guardNavigation() {
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    // Only renderer-initiated navigations get here; our own loadFile/loadURL calls don't.
    contents.on('will-navigate', (e) => e.preventDefault());
    contents.on('will-attach-webview', (e) => e.preventDefault());
  });
}

let installed = false;
function install() {
  if (installed) return;
  installed = true;
  guardIpc();
  guardNavigation();
}

module.exports = { install, isTrustedSender };
