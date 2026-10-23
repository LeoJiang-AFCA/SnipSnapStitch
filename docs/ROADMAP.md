# Roadmap

Contributions welcome — comment on or open an issue before starting anything large.

## Needs verification / known issues
- **False "Scrolling capture incomplete" warning** after a slow manual scroll + Done (see the last section of
  [SCROLL-CAPTURE.md](SCROLL-CAPTURE.md)). Needs diagnostics and a tighter `lost` rule.
- Verify on real machines: the "Use Print Screen key" option, "Start with Windows" (packaged exe only), and the rebuilt
  portable exe end-to-end (tray, scroll capture, record, optimizer).
- Check the icon at 16/32 px in the tray/taskbar (`tools/build-icon.py`: crop `BOX`, glow fade).
- Real VS Code / Excel verification of overlay-bar (scrollbar) detection — currently validated on synthetic data only.

## Ideas
- Encode large PNGs in a worker thread (a 1800×12000 stitched image blocks the main process ~1.5 s).
- Parallelise editor spawn with the save in `finalize`; avoid rebuilding all library cards on each change.
- Pre-warm the editor window.
- Code signing for the exe (SmartScreen warnings on first run).
- Tests for Electron/UI flows and `nativeImage` paths (recording area selection, pause, Pan tool, scroll flow, export).
- Scroll capture: horizontal scrolling and scrolling up.
- Installer (NSIS) and/or winget package in addition to the portable exe.
