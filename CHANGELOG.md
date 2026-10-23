# Changelog

All notable changes to this project are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Faster, lighter start-up: scroll-capture helpers, the PowerShell window helper and the recorder now load on first use
  instead of at launch (idle: 6 → 4 processes, ~515 → ~325 MB). Snip Area keeps its pre-warmed overlays.

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

[Unreleased]: https://github.com/LeoJiang-AFCA/SnipSnapStitch/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/LeoJiang-AFCA/SnipSnapStitch/releases/tag/v0.1.0
