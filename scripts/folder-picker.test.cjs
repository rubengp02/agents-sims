const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

test(
  'Windows folder picker is a GUI executable and communicates without a console',
  {
    skip: process.platform !== 'win32',
  },
  () => {
    const helper = path.resolve(__dirname, '../dist/native/office-folder-picker.exe');
    const image = readFileSync(helper);
    const pe = image.readUInt32LE(0x3c);
    assert.equal(image.readUInt32LE(pe), 0x4550);
    // IMAGE_SUBSYSTEM_WINDOWS_GUI, rather than WINDOWS_CUI (console).
    assert.equal(image.readUInt16LE(pe + 24 + 68), 2);
    const response = execFileSync(helper, ['--self-test'], { encoding: 'utf8', timeout: 5000 });
    assert.equal(Buffer.from(response.trim(), 'base64').toString('utf8'), 'native-ready');
  },
);
