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
| `main.js` | Startup: app name / AppUserModelId, pins userData to `%APPDATA%\snipsnapstitch`, `process-per-site`, login item (`--hidden`), registers IPC and modules |
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
- **Single-file exe** via electron-builder `portable` built from the `@electron/packager` folder output
  (`--prepackaged`), with `signAndEditExecutable: false` (winCodeSign extraction needs symlink privilege on some machines).
- Pan is the default editor tool: dragging empty canvas pans; clicking/dragging an annotation (or its handles) selects/moves it;
  other tools return to Pan on Esc.

## Security model
- Windows load only local pages; no remote content or network access in the app.
- Preloads expose narrow `window.*Api` surfaces; all privileged work happens in the main process via `ipcMain.handle`.
- The only registry write is the optional Print Screen setting (restored on untick/quit).

See [SCROLL-CAPTURE.md](SCROLL-CAPTURE.md) for the stitching algorithm and [DEVELOPMENT.md](DEVELOPMENT.md) for build/test workflow.
