# Security Policy

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report privately through GitHub: **Security → Advisories → [Report a vulnerability](https://github.com/LeoJiang-AFCA/SnipSnapStitch/security/advisories/new)**.

Include the affected version, steps to reproduce, and the impact you foresee. You can expect an acknowledgement within
7 days. Once a fix is available it will be released and credited (unless you prefer to stay anonymous).

## Scope notes

SnipSnapStitch works fully offline and never uploads captures. Areas of particular interest:
the `sss://` file protocol, IPC handlers and preload bridges, the PowerShell/user32 helper in `src/main/winbounds.js`,
and the optional Print Screen registry change in `src/main/printscreen.js`.
