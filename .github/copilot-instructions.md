# SnipSnapStitch – instructions for Copilot

Electron 31 Windows app (Snagit-like capture / scroll-capture / record / annotate). Run npm commands in the repo root.
Read `docs/ARCHITECTURE.md` first, then `docs/ROADMAP.md`; see `docs/SCROLL-CAPTURE.md` for the scroll-stitching design and
`docs/DEVELOPMENT.md` for commands and testing.

Rules of thumb: Windows/PowerShell (no `&&` in Windows PowerShell 5); never kill a user's running app; test launches need
`--user-data-dir=<tmp>`; userData is `%APPDATA%\snipsnapstitch`; run `npm test` after changes; keep replies concise.
