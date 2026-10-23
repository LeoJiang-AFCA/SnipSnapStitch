'use strict';
// Lets main-process modules that only use Electron lightly (app paths) be loaded under plain Node.
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sss-test-'));
const fake = {
  app: { getPath: () => userData, isPackaged: false },
  nativeImage: {},
};

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return fake;
  return origLoad.call(this, request, ...rest);
};

module.exports = { userData, fake };
