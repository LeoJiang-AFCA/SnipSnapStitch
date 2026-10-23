# Development guide

## Environment
Windows 10/11, Node.js 20.9+, npm 10. Python 3 with Pillow is only needed to regenerate icons.

## Commands (repo root)
```powershell
npm ci
npm start                       # dev run (electron .)
npm test                        # node --test test/
npm run package                 # folder build: dist\SnipSnapStitch-win32-x64 (fast start)
npm run dist                    # package + electron-builder portable -> release\SnipSnapStitch-<version>-portable.exe
python tools\build-icon.py      # regenerate assets\icon*.png/.ico from assets\icon-source.png
```
- `npm run dist` needs `CSC_IDENTITY_AUTO_DISCOVERY=false`; `signAndEditExecutable` is false. If the target exe is locked by a
  running copy, build with `--config.portable.artifactName=SnipSnapStitch-new.exe` and move it afterwards.
- The portable exe unpacks to a temp folder on each launch (slower start than the folder build). ffmpeg lives in
  `app.asar.unpacked\node_modules\ffmpeg-static\ffmpeg.exe`.
- Env switches: `SSS_ISOLATED=1` (one renderer per window), `--hidden` (start in tray), `--user-data-dir=<dir>` (isolated profile).
- Don't stop a running SnipSnapStitch to test; launch with an isolated `--user-data-dir`.

## Releasing
1. Update `version` in `package.json` and move *Unreleased* notes to a new section in `CHANGELOG.md`.
2. Commit, then tag and push: `git tag v0.1.0; git push origin v0.1.0`.
3. The **Release** workflow tests, builds the portable exe, and creates a **draft** GitHub release with a SHA-256 checksum. Review and publish it.

## Testing approach
- Unit tests (`test/`): capture-util (stitching, scroll detection, fixed columns, cursor patching), editor-core, gif-encoder,
  video-optimizer, recorder-prefs, settings, store, printscreen. `test/helpers/mock-electron.js` fakes `electron` so
  `store.js`/`settings.js` run under plain Node. `nativeImage` paths aren't unit-tested.
- Real-flow harnesses (throw-away scripts run with `node_modules\electron\dist\electron.exe script.js` and
  `app.setPath('userData', tmp)`):
  - scroll capture: open an always-on-top striped page, call `capture.captureScrolling()`, drive the overlay with
    `sendInputEvent`, trigger `ipcMain.emit('scrollbar:action', {sender:{id: bar.webContents.id}}, 'done'|'auto')`.
  - recording: `recorder.startRecording({setup:false, ...})`, pause, resume, stop.
  - frame-stream fps: needs an animated window (a static screen yields one frame); use `encodeURIComponent` for data URLs.
  - Print Screen: register via `shortcuts.js`, send the key with `keybd_event(0x2C)` from PowerShell, check with `reg query`.
  - editor smoke: `store.addCapture` then `windows.openEditor(id)`, inspect the DOM via `executeJavaScript`.
  - Always check for orphaned `electron.exe` processes afterwards.

## Gotchas
- A frame-stream test needs real motion on screen.
- `desktopCapturer` thumbnail sizes must be integers.
- After a crash the Print Screen registry value stays 0 until the app next starts with the option off or quits normally.
- `@electron/packager` is pinned to v18 (v20 needs Node ≥ 20.11).

## Recorder notes
- Defaults: 15 fps, "optimize to smaller video when finished" on (prefs version 3 migrates older saved prefs once).
- Optimizer: ffmpeg-static H.264 MP4 with presets via a dialog; "Make video smaller…" is also available in the library.

## Performance notes
- Library window ready ≈0.9 s; editor open 300–400 ms with the shared renderer. Idle memory ≈480–560 MB with `process-per-site`.
- Remaining main-thread costs: PNG encode of very tall stitched images (~1.5 s) and the clipboard write (~0.9 s).
- Tried without useful gain: `--in-process-gpu`, `--disable-gpu`, `--renderer-process-limit`, `--disable-site-isolation-trials`.
