# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-10-26

First stable release.

### Added
- **Mode bar on Snip Area** (e.g. Print Screen): Snip Area · Scroll Capture · Record Video · Full Screen · ✕ at the top of
  the screen. Scroll Capture continues in the same overlay (no new screenshot), Full Screen saves the screen as it was when
  the snip started (and copies it), Record Video opens the recorder. Nothing extra loads until a mode is picked.
- **Editor: Copy & Delete** (now the highlighted button) copies the image, annotations included, to the clipboard, deletes
  the capture and closes the editor; **Delete** (bin icon) deletes it after a confirmation.

### Changed
- **Installer instead of the portable exe.** `SnipSnapStitch-Setup-<version>.exe` is a one-click, per-user install (no admin)
  into `%LOCALAPPDATA%\Programs\snipsnapstitch`. The portable exe re-extracted ~340 MB to a temp folder on every launch
  (~28 s start); the installed app starts in ~1.5 s.
- **Fast first launch after install/update**: the installer starts the app once in the background (`--prewarm`), so the
  antivirus scan of the new exe and DLLs (~10–25 s on a locked-down PC) happens under the installer's progress bar instead
  of on your first launch (measured 21.9 s → 1.9 s). The exe is now byte-identical across releases (it carries the Electron
  version, and the unused asar hash is stripped), so updates don't present a never-seen file to cloud scanning.
- **Start with Windows is on by default** (existing settings are switched on once; unticking it later is kept), so the app
  is already running in the tray when you need it.
- **Snip Area works like the Windows Snipping Tool**: releasing the mouse captures straight away (no ✓ Capture step),
  copies the snip to the clipboard and then follows "After capture" (editor by default). Scroll Capture, window capture and
  the recording area picker keep the adjust/confirm step.
- The selection magnifier zooms half as much (21×21 pixels instead of 11×11 in the same box).
- Library dates follow the Windows regional format.
- Faster, lighter start-up: scroll-capture helpers, the PowerShell window helper and the recorder now load on first use
  instead of at launch (idle: 6 → 4 processes, ~515 → ~325 MB). Snip Area keeps its pre-warmed overlays.
- Smaller download: only the en-US Chromium locale is shipped (~38 MB less), and private dev notes are no longer packed
  into `app.asar`.
- **Faster Snip Area / Print Screen**: screens are captured natively, all at once, instead of through Chromium. Print
  Screen → selection overlay is about twice as fast: ~2.7–3.4 s → ~1.2–1.5 s with three monitors, and ~1 s → ~0.55 s
  with one.
- **The editor appears almost immediately after a snip** (~0.2–0.4 s instead of up to ~1.6 s): a hidden editor is kept
  ready in the background.
- Slightly faster start-up: the app's main code ships as one bundled file.
- `--perf` (or `SSS_PERF=1`) writes a timing log to `perf.log` in the data folder for diagnosing slow starts or captures.

### Fixed
- **Video recording: white screen over the recording area.** While picking the area to record and during recording, the
  selection overlay and the recording frame were drawn as solid white instead of see-through. Transparent windows that
  share the app's single renderer process lost their transparent background; it is now re-applied as they load (also
  fixes white corners on the recording/scroll-capture control bars).

### Security
- Hardening from a security review (no exploitable issues were found): all windows are sandboxed; IPC is accepted only
  from the app's own pages; navigation, pop-ups and `<webview>` are blocked; the `sss://` scheme no longer bypasses the page
  security policy; library file paths and annotation reads are checked against the index; the editor can only delete its
  own capture; `reg.exe`/PowerShell are run by full path; the video optimizer only reads local files with a fixed demuxer;
  the exe has the RunAsNode, `NODE_OPTIONS` and `--inspect` fuses off and only loads the app from `app.asar`.

## [0.1.0] - 2026-10-23

First public release.

### Added
- Snip Area (region), Full Screen and **Scroll Capture** (manual scroll or auto-scroll, stitched into one tall image).
- Scroll-capture stitching: sticky header/footer detection, fixed side-column detection, mouse-pointer removal,
  gap/incomplete-capture warning.
- Video recording (WebM) with pause/resume, optional GIF export and optional "optimize to smaller MP4" (bundled ffmpeg).
- Library with thumbnails, tags, favourites and rename.
- Canvas annotation editor: arrow, line, rectangle, ellipse, text, callout, step badges, stamps, highlighter, pen,
  blur, spotlight, magnify, eyedropper, crop, canvas size, undo/redo, zoom and pan.
- Tray icon, global hotkeys, Settings window, optional "Start with Windows" and optional "Use Print Screen key".
- Portable single-file Windows executable.

[Unreleased]: https://github.com/LeoJiang-AFCA/SnipSnapStitch/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/LeoJiang-AFCA/SnipSnapStitch/compare/cfc06bd...v1.0.0
[0.1.0]: https://github.com/LeoJiang-AFCA/SnipSnapStitch/tree/cfc06bd
