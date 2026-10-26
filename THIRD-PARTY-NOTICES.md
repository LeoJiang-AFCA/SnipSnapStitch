# Third-party notices

SnipSnapStitch is licensed under the MIT License (see `LICENSE`). It depends on, and the installer bundles:

| Component | License | Notes |
|---|---|---|
| [Electron](https://github.com/electron/electron) | MIT | Runtime (includes Chromium and Node.js, each under their own licenses) |
| [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) | GPL-3.0-or-later (package scripts) | Downloads a prebuilt FFmpeg binary |
| [FFmpeg](https://ffmpeg.org/) binary shipped by ffmpeg-static | GPL-3.0 (that build) | Used only as a separate process (`ffmpeg.exe`) for the optional "make video smaller" feature |
| [node-screenshots](https://github.com/nashaofu/node-screenshots) | Apache-2.0 (package metadata; its `LICENSE` file is MIT) | Prebuilt native module for fast screen capture |

## FFmpeg

The distributed executable contains an unmodified FFmpeg binary built under the GNU GPL v3. It is launched as a separate
program and is not linked into SnipSnapStitch's own code. The license text is `ffmpeg.exe.LICENSE` in the
`ffmpeg-static` npm package (bundled under `node_modules/ffmpeg-static/` inside the app). FFmpeg source code is available
from <https://ffmpeg.org/download.html>; the binaries come from the
[ffmpeg-static releases](https://github.com/eugeneware/ffmpeg-static/releases).

Run `npm ls --all --prod` for the complete dependency tree; Electron ships its own `LICENSES.chromium.html`.

## Trademarks

Snagit is a trademark of TechSmith Corporation. SnipSnapStitch is an independent project and is not affiliated with,
endorsed by, or derived from TechSmith's code.
