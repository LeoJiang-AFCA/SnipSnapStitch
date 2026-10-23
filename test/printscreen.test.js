'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers/mock-electron');

const { parseQuery } = require('../src/main/printscreen');
const settings = require('../src/main/settings');

test('parseQuery reads the Print Screen registry value', () => {
  const out = '\r\nHKEY_CURRENT_USER\\Control Panel\\Keyboard\r\n    PrintScreenKeyForSnippingEnabled    REG_DWORD    0x1\r\n';
  assert.equal(parseQuery(out), 1);
  assert.equal(parseQuery(out.replace('0x1', '0x0')), 0);
  assert.equal(parseQuery(''), null);
  assert.equal(parseQuery('ERROR: The system was unable to find the specified registry key or value.'), null);
});

test('replacing Print Screen is off by default', () => {
  assert.equal(settings.DEFAULTS.replacePrintScreen, false);
  assert.equal(settings.DEFAULTS.printScreenBackup, null);
});
