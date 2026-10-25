# Architecture

Electron 31 (Node 20), plain JavaScript, CommonJS in main/preload, no bundler and no UI framework. Every window uses
`contextIsolation: true` and `nodeIntegration: false` with its own preload in `src/preload/`.

```
src/main/       main process
src/preload/    one preload per window type (contextBridge APIs)
src/renderer/   editor, library, overlay (region picker), recorder, scrollbar, framestream, settings
assets/         icons (icon-source.png is the source art; see tools/build-icon.py)
test/           node:test unit tests + helpers/mock-electron.js
tools/          package.js (folder build), build-icon.py
docs/           design notes
```

## Main-process modules (`src/main`)
| File | Role |
|---|---|
| `main.js` | Startup: app name / AppUserModelId, pins userData to `%APPDATA%\snipsnapstitch`, `process-per-site`, `--prewarm` (installer warm-up: hidden window, then quit), login item (`--hidden`), registers IPC and modules |
| `windows.js` | Creates and pools windows (library, editor, settings, recorder setup) |
| `tray.js`, `shortcuts.js` | Tray menu; global hotkeys (Region `Ctrl+Shift+S`, Record `Ctrl+Shift+R`, Fullscreen `Ctrl+Shift+F`) and optional Print Screen |
| `printscreen.js` | Optional "Print Screen opens SSS": sets HKCU `Control Panel\Keyboard\PrintScreenKeyForSnippingEnabled` to 0, stores the original in settings (`printScreenBackup`), restores it when unticked and on quit |
| `settings.js` | JSON settings in userData (`hotkeys.*`, `afterCapture`, `launchAtLogin`, `replacePrintScreen`, `copyToClipboard`, `captureCursor`, `delaySeconds`, `saveFolder`, …) |
| `store.js` | Library store: `<id>.png`, `.orig.png`, `.thumb.jpg`, `.annot.json`, `index.json` (a corrupt index is backed up as `.corrupt`) |
| `capture.js` | Region / fullscreen / window / scrolling capture sessions, overlays, scroll session loop |
| `capture-util.js` | **Pure** logic: rect/DPI helpers, `staticRows`, `detectScrollOffset`, `ScrollStitcher`, cursor patching, `sameIgnoringBoxes`, overlay-bar detection |
| `frame-stream.js` | ~30 fps desktop video stream of the selected rect (getUserMedia) used by scroll capture; own partition `sss-framestream` |
| `scroll-ui.js`, `winbounds.js` | Floating scroll-capture control bar; PowerShell/user32 helper for wheel input, cursor position and window list |
| `recorder.js`, `recorder-prefs.js` | Video recorder (worker window, partition `recorder-capture`); prefs logic is a pure module (`PREFS_VERSION` migration) |
| `video-optimizer.js` | ffmpeg-static based "make smaller" (H.264 MP4); ffmpeg is unpacked from the asar |
| `library-ipc.js`, `editor-ipc.js` | IPC for the library and editor windows; `sss://` protocol serves files, thumbnails and MP4s |

The editor lives in `src/renderer/editor` (canvas rendering, tools, `core/` model/geometry/history – pure and unit-tested).
Library, overlay, recorder, scrollbar and settings windows are plain HTML/CSS/JS pages.

## Key design decisions
- **One shared renderer (`process-per-site`)**: roughly halves idle memory and speeds up opening the editor/recorder. The frame
  stream and recorder worker use their own partitions so a busy page cannot jank capture. `SSS_ISOLATED=1` reverts to per-window processes.
- **No native rewrite**: window spawn cost was reduced with pooled/pre-warmed windows and a shared process instead.
- **Cursor removal**: Chromium desktop capture cannot hide the pointer, so the pointer box is located per frame and rows are
  inpainted from neighbouring frames in the stitcher (auto-scroll also parks the pointer away).
- **Fixed side columns** (sidebars, minimaps) are detected and shown once at the top of a stitched image.
- **userData is `%APPDATA%\snipsnapstitch`**; `main.js` contains a one-time migration for libraries created by early builds.
- **Per-user NSIS installer** (one-click, no admin) via electron-builder, built from the `@electron/packager` folder output
  (`--prepackaged`), with `signAndEditExecutable: false` (winCodeSign extraction needs symlink privilege on some machines).
  Not `portable`: that target re-extracts the app to a temp folder on every launch (~28 s start) and gives the login item a
  temp path. Only the `en-US` locale pak ships, so the library formats dates with `app.getSystemLocale()` (via IPC).
- **Antivirus-friendly install**: the installer pre-starts the app once (`--prewarm`, `tools/installer.nsh`) so the scan of
  the new exe happens during install, and the exe stays byte-identical across releases (Electron version in its version
  resource, no embedded asar hash; `app.getVersion()` still comes from `package.json`).
- **Snip Area is release-to-capture** (`selectArea(..., { instant: true })`): mouse-up confirms, the PNG always goes to the
  clipboard, then `afterCapture` runs. Window capture, Scroll Capture and the recording area picker keep the confirm step.
- Pan is the default editor tool: dragging empty canvas pans; clicking/dragging an annotation (or its handles) selects/moves it;
  other tools return to Pan on Esc.

## Security model
- Windows load only local pages; no remote content or network access in the app.
- Preloads expose narrow `window.*Api` surfaces; all privileged work happens in the main process via `ipcMain.handle`.
- The only registry write is the optional Print Screen setting (restored on untick/quit).

## Startup and lazy loading
Goal: a snip-only user pays only for region capture. At launch the app creates the tray, hotkeys, IPC handlers, and a small
pool of hidden overlay windows (one per display, for instant Snip Area). Everything else loads on first use:
- **Scroll Capture**: `scroll-ui.js` and `frame-stream.js` are required when the capture starts. Their windows load while the
  user picks the area; the PowerShell helper (`winbounds.js`) starts at the same point and stops itself after 2 idle minutes.
  An unused pre-warmed frame-stream host is destroyed when the capture ends.
- **Recorder**: `recorder.js` and its IPC handlers load on the first Record action (hotkey, tray or the library button, which
  has a small `recorder:start` stub in `main.js`).
- **ffmpeg**: `ffmpeg-static` is only required when a video is optimized; stale-file cleanup runs 15 s after start.
Idle cost with no library window: 4 processes / ~325 MB (was 6 / ~515 MB plus a PowerShell process). Keep new heavy features
behind `require()` at the point of use and never spawn windows or processes at startup.

See [SCROLL-CAPTURE.md](SCROLL-CAPTURE.md) for the stitching algorithm and [DEVELOPMENT.md](DEVELOPMENT.md) for build/test workflow.
