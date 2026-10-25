import assert from 'node:assert/strict';
import test from 'node:test';
import { validationDiagnostics } from './validation-diagnostics.mjs';

test('identifies colored Vitest failures while dropping private assertion contents', () => {
  assert.deepEqual(
    validationDiagnostics(
      [
        '\u001b[31m FAIL \u001b[0m __tests__/parallelWorkflow.test.ts > private task contents',
        'Error: private tool output',
        'expected: "private value"',
        'actual: false',
      ].join('\n'),
    ),
    ['FAIL __tests__/parallelWorkflow.test.ts', 'actual: false'],
  );
});

test('retains existing TAP diagnostics and rejects arbitrary paths and output', () => {
  assert.deepEqual(
    validationDiagnostics(
      [
        'not ok 2 - cancellation preserves receipt',
        "code: 'ERR_ASSERTION'",
        'FAIL /private/history.test.ts > private task',
        'secret=fixture-value',
        'expected: 2',
      ].join('\n'),
    ),
    ['not ok 2 - cancellation preserves receipt', "code: 'ERR_ASSERTION'", 'expected: 2'],
  );
});
