# Development guide

## Environment
Windows 10/11, Node.js 20.9+, npm 10. Python 3 with Pillow is only needed to regenerate icons.

## Commands (repo root)
```powershell
npm ci
npm start                       # dev run (electron .)
npm test                        # node --test test/
npm run package                 # folder build: dist\SnipSnapStitch-win32-x64 (fast start)
npm run dist                    # package + electron-builder NSIS -> release\SnipSnapStitch-Setup-<version>.exe
python tools\build-icon.py      # regenerate assets\icon*.png/.ico from assets\icon-source.png
```
- `npm run dist` needs `CSC_IDENTITY_AUTO_DISCOVERY=false`; `signAndEditExecutable` is false; `publish` is null (no
  `latest.yml`). `tools/package.js` keeps only the `en-US` Chromium locale and excludes `.git`, `.github`, `.vscode` and
  `.private` from `app.asar`.
- The installer is one-click and per-user (`%LOCALAPPDATA%\Programs\snipsnapstitch`). It **closes every process named
  `SnipSnapStitch.exe`** before installing, so never run it (or its uninstaller) while a copy you care about is running.
  To test install/uninstall, build a renamed clone (`--config.executableName=… --config.productName=… --config.appId=…`),
  then `Setup.exe /S /D=<dir>` and `"Uninstall <name>.exe" /S /currentuser`.
- We moved off electron-builder `portable`: it re-extracted the whole app to a temp folder on every launch (~28 s start vs
  ~1.5 s installed). ffmpeg lives in `app.asar.unpacked\node_modules\ffmpeg-static\ffmpeg.exe`.
- **First start of a newly written exe** is slow on locked-down PCs (this one: Cortex XDR + Defender with strict cloud
  settings): ~8–10 s to scan the 172 MB exe and DLLs, plus ~8 s more if its hash has never been seen. Two mitigations:
  - `tools/installer.nsh` (`customInstall`) runs `SnipSnapStitch.exe --prewarm` with a throwaway profile in `$PLUGINSDIR`;
    `main.js` opens one hidden window and quits, so the scan happens during install (first launch 21.9 s → 1.9 s).
  - `tools/package.js` keeps the exe byte-identical across our releases: `appVersion` is the Electron version and the
    INTEGRITY/ELECTRONASAR resource is stripped (via `resedit`). Enabling the asar-integrity fuse later would undo this.
    It then sets the exe fuses (`@electron/fuses`; check with `npx @electron/fuses read --app <exe>`). Their values are
    fixed, so they don't change the exe between releases.
- Env switches: `SSS_ISOLATED=1` (one renderer per window), `--hidden` (start in tray), `--user-data-dir=<dir>` (isolated profile),
  `--perf` or `SSS_PERF=1` (timing log: console and `<userData>\perf.log`), `SSS_NO_NATIVE_CAPTURE=1` (use `desktopCapturer`).
- `tools/package.js` bundles `src/main` into one `main.js` with esbuild (`afterCopy`; `electron`, `ffmpeg-static` and
  `node-screenshots` stay external). `npm start` and the tests run the unbundled sources. The `node-screenshots` `.node`
  binary is unpacked from the asar like ffmpeg (both `tools/package.js` and the `build.asarUnpack` list).
- Don't stop a running SnipSnapStitch to test; launch with an isolated `--user-data-dir`.

## Releasing
1. Update `version` in `package.json` and move *Unreleased* notes to a new section in `CHANGELOG.md`.
2. Commit, then tag and push: `git tag v0.1.0; git push origin v0.1.0`.
3. The **Release** workflow tests, builds the installer, and creates a **draft** GitHub release with a SHA-256 checksum. Review and publish it.

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
  - packaged build: start `dist\…\SnipSnapStitch.exe --remote-debugging-port=<port> --user-data-dir=<tmp> --perf` and drive
    it over the DevTools protocol (`libraryApi.capture('fullscreen'|'window')`, `Input.dispatchMouseEvent` on the overlay).
    Window capture doesn't touch the clipboard; Snip Area always copies.
  - Always check for orphaned `electron.exe` processes afterwards.

## Gotchas
- A frame-stream test needs real motion on screen.
- `desktopCapturer` thumbnail sizes must be integers.
- After a crash the Print Screen registry value stays 0 until the app next starts with the option off or quits normally.
- `@electron/packager` is pinned to v18 (v20 needs Node ≥ 20.11).
- Electron 40+ downloads its binary with `@electron/get` v5, which needs Node ≥ 22.12. Upgrading Electron therefore means
  upgrading Node first; it also changes the exe hash once (see the antivirus note above).

## Recorder notes
- Defaults: 15 fps, "optimize to smaller video when finished" on (prefs version 3 migrates older saved prefs once).
- Optimizer: ffmpeg-static H.264 MP4 with presets via a dialog; "Make video smaller…" is also available in the library.

## Performance notes
- Measure with `--perf` (packaged or dev): `startup …` marks are from process start, and each capture logs its steps
  (`snip#N`: windows hidden → screen grabbed → overlay on screen; `after-selection#N`: cropped → saved → copied → editor).
- Packaged, warm start: tray and hotkeys ready ≈0.45–0.6 s. Snip Area: Print Screen → overlay ≈0.55 s on one display and
  ≈1.2–1.5 s on three (was 2.7–3.4 s with `desktopCapturer`). Mouse release → editor on screen ≈0.15–0.45 s with the spare
  editor.
- Library window ready ≈0.9 s. Idle memory ≈480–560 MB with `process-per-site`.
- Remaining main-thread costs: PNG encode of very tall stitched images (~1.5 s) and the clipboard write (~0.9 s).
- Tried without useful gain: `--in-process-gpu`, `--disable-gpu`, `--renderer-process-limit`, `--disable-site-isolation-trials`.
