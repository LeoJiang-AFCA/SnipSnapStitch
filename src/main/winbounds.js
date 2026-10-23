'use strict';
// Win32 helper: a persistent PowerShell process (user32/dwmapi via Add-Type) used for enumerating top-level
// window rectangles and injecting mouse-wheel input. All coordinates are PHYSICAL screen pixels.
// On non-Windows platforms every function resolves to an "unavailable" value instead of throwing.
const { spawn } = require('child_process');

const IS_WIN = process.platform === 'win32';

const CSHARP = String.raw`
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class RSNative {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern void mouse_event(uint f, uint dx, uint dy, int data, UIntPtr extra);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int size);

  public static void InitDpi() {
    try { if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetProcessDPIAware(); }
    catch (Exception) { try { SetProcessDPIAware(); } catch (Exception) { } }
  }

  public static string Windows(int excludePid) {
    var sb = new StringBuilder();
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      try {
        if (!IsWindowVisible(h) || IsIconic(h)) return true;
        uint pid; GetWindowThreadProcessId(h, out pid);
        if (excludePid > 0 && pid == (uint)excludePid) return true;
        int ex = GetWindowLong(h, -20);
        if ((ex & 0x80) != 0 && (ex & 0x40000) == 0) return true;
        int cloaked; if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
        var t = new StringBuilder(512); GetWindowText(h, t, 512);
        string title = t.ToString();
        if (title.Length == 0) return true;
        RECT r;
        if (DwmGetWindowAttribute(h, 9, out r, 16) != 0) { if (!GetWindowRect(h, out r)) return true; }
        int w = r.R - r.L, hh = r.B - r.T;
        if (w < 20 || hh < 20) return true;
        sb.Append("W|").Append(h.ToInt64()).Append('|').Append(r.L).Append('|').Append(r.T).Append('|')
          .Append(w).Append('|').Append(hh).Append('|').Append(pid).Append('|')
          .Append(Convert.ToBase64String(Encoding.UTF8.GetBytes(title))).Append('\n');
      } catch (Exception) { }
      return true;
    }, IntPtr.Zero);
    return sb.ToString();
  }

  public static void Wheel(int x, int y, int delta) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(30);
    mouse_event(0x0800, 0, 0, delta, UIntPtr.Zero);
  }
  public static void Move(int x, int y) { SetCursorPos(x, y); }
  public static string Cursor() { POINT p; GetCursorPos(out p); return "C|" + p.X + "|" + p.Y + "\n"; }
}
`;

const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
$src = @'
${CSHARP}
'@
Add-Type -TypeDefinition $src
[RSNative]::InitDpi()
[Console]::Out.WriteLine('READY')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $p = $line.Split(' ')
  try {
    switch ($p[1]) {
      'windows' { [Console]::Out.Write([RSNative]::Windows([int]$p[2])) }
      'wheel'   { [RSNative]::Wheel([int]$p[2], [int]$p[3], [int]$p[4]) }
      'move'    { [RSNative]::Move([int]$p[2], [int]$p[3]) }
      'cursor'  { [Console]::Out.Write([RSNative]::Cursor()) }
    }
  } catch { [Console]::Out.WriteLine('ERR|' + $_.Exception.Message.Replace("\`n", ' ')) }
  [Console]::Out.WriteLine('END|' + $p[0])
}
`;

const IDLE_MS = 2 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20000;

let proc = null;
let ready = null;
let nextId = 1;
let buffer = '';
let idleTimer = null;
const pending = new Map();

function failAll(err) {
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    p.reject(err);
  }
  pending.clear();
}

function onLine(line) {
  line = line.replace(/\r$/, '');
  if (line === 'READY') return ready && ready.resolve();
  const end = /^END\|(\d+)$/.exec(line);
  if (end) {
    const p = pending.get(Number(end[1]));
    if (p) {
      pending.delete(p.id);
      clearTimeout(p.timer);
      p.resolve(p.lines);
    }
    return;
  }
  // Output lines belong to the oldest pending request (requests are processed sequentially).
  const first = pending.values().next().value;
  if (first) first.lines.push(line);
}

function stop() {
  clearTimeout(idleTimer);
  idleTimer = null;
  const p = proc;
  proc = null;
  ready = null;
  buffer = '';
  failAll(new Error('winbounds helper stopped'));
  if (p) {
    try { p.stdin.end(); } catch {}
    try { p.kill(); } catch {}
  }
}

function start() {
  if (proc) return;
  const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
  );
  proc = child;
  let res;
  let rej;
  const promise = new Promise((a, b) => { res = a; rej = b; });
  promise.catch(() => {});
  ready = { promise, resolve: res, reject: rej };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      onLine(line);
    }
  });
  child.stderr.on('data', () => {});
  child.stdin.on('error', () => {});
  const onDead = () => {
    if (proc === child) {
      if (ready) ready.reject(new Error('winbounds helper exited'));
      proc = null;
      ready = null;
      failAll(new Error('winbounds helper exited'));
    }
  };
  child.on('exit', onDead);
  child.on('error', onDead);
}

async function request(cmd, args = []) {
  if (!IS_WIN) throw new Error('winbounds is only available on win32');
  start();
  clearTimeout(idleTimer);
  idleTimer = setTimeout(stop, IDLE_MS);
  if (idleTimer.unref) idleTimer.unref();
  const rdy = ready;
  const timeoutMs = REQUEST_TIMEOUT_MS;
  await Promise.race([
    rdy.promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('winbounds helper start timeout')), 30000).unref()),
  ]);
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('winbounds request timed out'));
    }, timeoutMs);
    pending.set(id, { id, lines: [], resolve, reject, timer });
    try {
      proc.stdin.write([id, cmd, ...args].join(' ') + '\n');
    } catch (e) {
      pending.delete(id);
      clearTimeout(timer);
      reject(e);
    }
  });
}

function checkErr(lines) {
  const e = lines.find((l) => l.startsWith('ERR|'));
  if (e) throw new Error(e.slice(4));
}

/** Top-level visible windows in z-order (topmost first): [{hwnd,x,y,w,h,pid,title}] in physical screen pixels. */
async function listWindows(opts = {}) {
  if (!IS_WIN) return [];
  const lines = await request('windows', [opts.excludePid || 0]);
  checkErr(lines);
  const out = [];
  for (const l of lines) {
    const p = l.split('|');
    if (p[0] !== 'W' || p.length < 8) continue;
    out.push({
      hwnd: p[1],
      x: Number(p[2]),
      y: Number(p[3]),
      w: Number(p[4]),
      h: Number(p[5]),
      pid: Number(p[6]),
      title: Buffer.from(p[7], 'base64').toString('utf8'),
    });
  }
  return out;
}

/** Moves the cursor to physical (x,y) and sends a wheel event (delta in 1/120 notch units; negative = scroll down). */
async function wheel(x, y, delta) {
  if (!IS_WIN) return false;
  checkErr(await request('wheel', [Math.round(x), Math.round(y), Math.round(delta)]));
  return true;
}

async function moveCursor(x, y) {
  if (!IS_WIN) return false;
  checkErr(await request('move', [Math.round(x), Math.round(y)]));
  return true;
}

async function getCursor() {
  if (!IS_WIN) return null;
  const lines = await request('cursor');
  const l = lines.find((s) => s.startsWith('C|'));
  if (!l) return null;
  const p = l.split('|');
  return { x: Number(p[1]), y: Number(p[2]) };
}

/** Starts the helper early so the first window capture is fast (no-op elsewhere). */
function warmUp() {
  if (!IS_WIN) return;
  try { start(); } catch {}
}

module.exports = { listWindows, wheel, moveCursor, getCursor, warmUp, dispose: stop, available: IS_WIN };
