/* Builds the production app (asar-packed, own exe + icon) into dist/. Run: npm run package */
const path = require('path');
const { packager } = require('@electron/packager');

const root = path.join(__dirname, '..');

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
  ignore: [
    /^\/(dist|release|test|tools|docs|coverage)($|\/)/,
    /^\/\.(github|vscode|git)($|\/)/,
    /^\/\.(gitignore|gitattributes|editorconfig)$/,
    /^\/[A-Z-]+\.md$/,
    /^\/LICENSE$/,
    /^\/assets\/icon-(16|24|32|64|128|256|512|1024|source)\.png$/,
    /^\/assets\/icon\.png$/,
  ],
  win32metadata: { ProductName: 'SnipSnapStitch', FileDescription: 'SnipSnapStitch (SSS)' },
}).then((out) => console.log('Built:', out.join(', '))).catch((e) => { console.error(e); process.exit(1); });
