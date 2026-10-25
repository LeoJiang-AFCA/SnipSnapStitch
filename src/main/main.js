const path = require('path');
const fs = require('fs');
const { app, ipcMain, dialog, BrowserWindow } = require('electron');

// Data lives in %APPDATA%\snipsnapstitch. Libraries created under the pre-rename folder (reasnagit) are copied over once.
if (!app.commandLine.hasSwitch('user-data-dir')) {
  const userData = path.join(app.getPath('appData'), 'snipsnapstitch');
  const legacy = path.join(app.getPath('appData'), 'reasnagit');
  try {
    if (!fs.existsSync(userData) && fs.existsSync(legacy)) fs.cpSync(legacy, userData, { recursive: true });
  } catch (e) {
    console.error('userData migration failed', e);
  }
  app.setPath('userData', userData);
}
app.setName('SnipSnapStitch');
app.setAppUserModelId('com.snipsnapstitch.app');

// All our windows load local pages, so let them share one renderer process: opening the editor or recorder then skips
// a process spawn (about 2x faster on this machine) and idle memory roughly halves. SSS_ISOLATED=1 turns this off.
if (!process.env.SSS_ISOLATED) app.commandLine.appendSwitch('process-per-site');

// Installer warm-up (tools/installer.nsh): start Chromium once (browser, GPU and renderer processes) and quit, so antivirus
// scans the new exe and DLLs while the installer still shows progress rather than on the user's first launch.
if (process.argv.includes('--prewarm')) {
  setTimeout(() => app.exit(0), 30000);
  app.whenReady().then(() => {
    const win = new BrowserWindow({ show: false });
    win.loadURL('about:blank').catch(() => {}).finally(() => app.quit());
  });
  return;
}

const settings = require('./settings');
const windows = require('./windows');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// Modules that may need to run before app 'ready' (e.g. custom protocol schemes).
const library = require('./library-ipc');
if (typeof library.registerProtocolScheme === 'function') library.registerProtocolScheme();

function registerIpc() {
  ipcMain.handle('settings:get-all', () => settings.getAll());
  ipcMain.handle('settings:set-many', (_e, obj) => settings.setMany(obj));
  ipcMain.handle('settings:choose-folder', async (e) => {
    const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      properties: ['openDirectory', 'createDirectory'],
    });
    return res.canceled ? null : res.filePaths[0];
  });
  ipcMain.handle('settings:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());
}

app.on('second-instance', () => windows.openLibrary());

// Only the packaged exe can be a login item (in development it would register electron.exe).
function applyLoginItem() {
  if (!app.isPackaged) return;
  try { app.setLoginItemSettings({ openAtLogin: !!settings.get('launchAtLogin'), args: ['--hidden'] }); } catch (e) { console.error('login item failed', e); }
}

app.whenReady().then(() => {
  registerIpc();
  library.register();
  require('./editor-ipc').register();
  require('./capture').register();
  // The recorder (and its IPC handlers) load on first use; this stub only covers the library's Record button.
  ipcMain.handle('recorder:start', (_e, opts) => require('./recorder').startRecording(opts));
  require('./tray').init();
  require('./printscreen').init();
  require('./shortcuts').init();
  applyLoginItem();
  settings.events.on('changed', applyLoginItem);
  if (!process.argv.includes('--hidden')) windows.openLibrary();
});

// Keep running in the tray when all windows are closed.
app.on('window-all-closed', () => {});
app.on('will-quit', () => {
  require('electron').globalShortcut.unregisterAll();
  require('./printscreen').restore();
});
