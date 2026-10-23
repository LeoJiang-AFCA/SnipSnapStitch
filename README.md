# SnipSnapStitch (SSS)

[![CI](https://github.com/leojiang/SnipSnapStitch/actions/workflows/ci.yml/badge.svg)](https://github.com/leojiang/SnipSnapStitch/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platform: Windows](https://img.shields.io/badge/platform-Windows%2010%2F11-0078d4)

A free, open-source screen capture tool for Windows: snip a region, **capture scrolling pages as one stitched image**, record
video, then annotate and organise everything in a built-in library. Everything runs locally — no account, no cloud, no telemetry.

## Features
- **Snip Area** – drag to capture any region (multi-monitor and DPI aware).
- **Scroll Capture** – manual scroll or auto-scroll; frames are stitched into one tall image. Handles sticky headers/footers,
  fixed sidebars/minimaps, removes the mouse pointer, and warns when content might be missing. Design notes: [docs/SCROLL-CAPTURE.md](docs/SCROLL-CAPTURE.md).
- **Record Video** – screen or region to WebM, pause/resume, optional GIF export, optional "optimize to smaller MP4".
- **Full Screen** capture.
- **Library** – thumbnail grid with tags, favourites, search and rename.
- **Editor** – arrow, line, rectangle, ellipse, text, callout, step badges, stamps, highlighter, pen, blur, spotlight, magnify,
  eyedropper, crop, canvas size, undo/redo, zoom and pan.
- Tray icon, global hotkeys, optional *Start with Windows*, optional *Use Print Screen key for SnipSnapStitch*.

| Action | Default hotkey |
|---|---|
| Snip Area | `Ctrl+Shift+S` |
| Record Video | `Ctrl+Shift+R` |
| Full Screen | `Ctrl+Shift+F` |

Hotkeys can be changed in Settings. In scroll capture, `Enter` finishes and `Esc` cancels.

## Download
Grab `SnipSnapStitch-<version>-portable.exe` from the [Releases](https://github.com/leojiang/SnipSnapStitch/releases) page
(verify it against `SHA256SUMS.txt`), copy it anywhere and double-click — no installer needed.

> The exe is **not code-signed**, so Windows SmartScreen may warn on first run ("More info" → "Run anyway").
> You can always build it yourself from source (below).

Your captures and settings are stored in `%APPDATA%\snipsnapstitch`.

## Build from source
Requires Windows, [Node.js](https://nodejs.org/) 20.9+ and npm.

```powershell
git clone https://github.com/leojiang/SnipSnapStitch.git
cd SnipSnapStitch
npm ci
npm start          # run in development
npm test           # unit tests
npm run package    # folder build in dist\ (fast start-up)
npm run dist       # single-file portable exe in release\
```

## Documentation
- [Architecture](docs/ARCHITECTURE.md) · [Scroll-capture design](docs/SCROLL-CAPTURE.md) · [Development guide](docs/DEVELOPMENT.md) · [Roadmap](docs/ROADMAP.md)
- [Changelog](CHANGELOG.md)

## Contributing
Issues and pull requests are welcome — please read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).
Report security problems privately as described in [SECURITY.md](SECURITY.md).

## License
[MIT](LICENSE) © Leo Jiang. Bundled third-party components (Electron, FFmpeg) are listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Snagit is a trademark of TechSmith Corporation; SnipSnapStitch is an independent project and is not affiliated with TechSmith.
