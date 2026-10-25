/* Builds the production app (asar-packed, own exe + icon) into dist/. Run: npm run package */
const fs = require('fs');
const path = require('path');
const { packager } = require('@electron/packager');

const root = path.join(__dirname, '..');
const electronVersion = require('electron/package.json').version;

// Packager embeds a hash of app.asar in the exe (resource INTEGRITY/ELECTRONASAR), so the exe would change with every code
// change. It is only checked when the EnableEmbeddedAsarIntegrityValidation fuse is on (we don't set fuses), so drop it.
async function stripAsarIntegrity(exePath) {
  const resedit = await require('resedit/cjs').load();
  const exe = resedit.NtExecutable.from(fs.readFileSync(exePath));
  const res = resedit.NtExecutableResource.from(exe);
  for (let i = res.entries.length - 1; i >= 0; i--) if (res.entries[i].type === 'INTEGRITY') res.entries.splice(i, 1);
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
}

packager({
  dir: root,
  name: 'SnipSnapStitch',
  platform: 'win32',
  arch: 'x64',
  out: path.join(root, 'dist'),
  overwrite: true,
  icon: path.join(root, 'assets', 'icon.ico'),
  asar: { unpack: '**/ffmpeg-static/ffmpeg.exe' },
  prune: true,
  // The UI is English only and Chromium falls back to en-US, so the other ~37 MB of locale packs are dropped.
  // (Library dates use the Windows regional locale instead; see library.js.)
  afterExtract: [(buildPath, _version, _platform, _arch, done) => {
    try {
      const dir = path.join(buildPath, 'locales');
      for (const f of fs.readdirSync(dir)) if (f !== 'en-US.pak') fs.rmSync(path.join(dir, f));
      done();
    } catch (e) { done(e); }
  }],
  ignore: [
    /^\/(dist|release|test|tools|docs|coverage)($|\/)/,
    /^\/\.(github|vscode|git|private)($|\/)/,
    /^\/\.(gitignore|gitattributes|editorconfig)$/,
    /^\/[A-Z-]+\.md$/,
    /^\/LICENSE$/,
    /^\/assets\/icon-(16|24|32|64|128|256|512|1024|source)\.png$/,
    /^\/assets\/icon\.png$/,
  ],
  // Keep the exe byte-identical across our releases (it only changes when Electron does): antivirus and cloud reputation
  // are per file hash, and a never-seen exe adds ~9 s to the first start on a locked-down PC. So the version resource
  // carries the Electron version (app.getVersion() still reads package.json) and the asar hash is stripped below.
  appVersion: electronVersion,
  win32metadata: { ProductName: 'SnipSnapStitch', FileDescription: 'SnipSnapStitch (SSS)' },
}).then(async (out) => {
  await stripAsarIntegrity(path.join(out[0], 'SnipSnapStitch.exe'));
  console.log('Built:', out.join(', '));
}).catch((e) => { console.error(e); process.exit(1); });
