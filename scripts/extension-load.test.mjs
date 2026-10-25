import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('the built VS Code extension loads without standalone image or browser tools', () => {
  // VS Code supplies this module at runtime. The fresh process checks the real
  // bundle before activation, without opening an IDE or touching personal state.
  const script = `
    const assert = require('node:assert/strict');
    const Module = require('node:module');
    const original = Module._load;
    Module._load = function (id, ...args) {
      if (id === 'vscode') return {};
      if (id === 'sharp' || id === 'playwright') throw new Error('Standalone tools loaded by extension');
      return original.call(this, id, ...args);
    };
    const extension = require('./dist/extension.js');
    assert.equal(typeof extension.activate, 'function');
    assert.equal(typeof extension.deactivate, 'function');
    console.log('extension-load-ok');
  `;
  const output = execFileSync(process.execPath, ['-e', script], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
  });
  assert.match(output, /extension-load-ok/);
});
