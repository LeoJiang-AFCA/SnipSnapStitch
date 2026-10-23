# Contributing to SnipSnapStitch

Thanks for helping! Bug reports, ideas, docs and code are all welcome.

## Ground rules
- Be kind — see the [Code of Conduct](CODE_OF_CONDUCT.md).
- Search existing issues before opening a new one. For security problems see [SECURITY.md](SECURITY.md).
- For anything larger than a small fix, open an issue first so we can agree on the approach.

## Development setup
Requirements: Windows 10/11, Node.js 20.9+ and npm. (Python 3 + Pillow only if you regenerate icons.)

```powershell
git clone https://github.com/leojiang/SnipSnapStitch.git
cd SnipSnapStitch
npm ci
npm start      # run the app
npm test       # unit tests (node:test)
```

More detail (testing harnesses, packaging, env switches) is in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md); the code layout is
in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); the scroll-stitching design is in [docs/SCROLL-CAPTURE.md](docs/SCROLL-CAPTURE.md).

When testing a dev build while the installed app is running, use an isolated profile so you don't hit the single-instance lock
or touch your real library: `npm start -- --user-data-dir=%TEMP%\sss-dev`.

## Pull requests
1. Fork and create a topic branch from `main` (`fix/scroll-gap`, `feat/horizontal-scroll`).
2. Keep changes focused; add or update tests for pure logic (see `test/`). Electron/UI flows are not unit-tested — describe how you verified them manually.
3. Run `npm test` — it must pass.
4. Update `CHANGELOG.md` (under *Unreleased*) and docs when behaviour changes.
5. Use clear commit messages ([Conventional Commits](https://www.conventionalcommits.org/) style is appreciated: `fix:`, `feat:`, `docs:`, `test:`, `chore:`).
6. Open the PR and fill in the template. CI must be green.

## Style
- Plain JavaScript (CommonJS in main/preload), no bundler or UI framework; keep new dependencies to a minimum.
- Keep `contextIsolation: true` / `nodeIntegration: false`; expose only what a window needs through its preload.
- Put testable logic in pure modules (like `capture-util.js`) with no Electron imports.
- Follow `.editorconfig` (2 spaces, LF).

## Compatibility note
The user-data folder is `%APPDATA%\snipsnapstitch`. Changing its location or the saved file formats needs a migration so
existing libraries and settings keep working.

## Licensing
By contributing you agree your contribution is licensed under the [MIT License](LICENSE).
