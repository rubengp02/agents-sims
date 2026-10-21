import test from 'node:test';
import assert from 'node:assert/strict';
import { countByStatus } from './task-summary.mjs';

test('empty arrays return exactly the three zero counts', () => {
  assert.deepEqual(countByStatus([]), { pending: 0, running: 0, done: 0 });
});

test('counts mixed and repeated statuses', () => {
  const tasks = ['done', 'pending', 'running', 'pending', 'done', 'pending'].map((status) => ({
    status,
  }));
  assert.deepEqual(countByStatus(tasks), { pending: 3, running: 1, done: 2 });
});

test('retains zero counts for absent statuses', () => {
  assert.deepEqual(countByStatus([{ status: 'running' }]), {
    pending: 0,
    running: 1,
    done: 0,
  });
});

test('returns a fresh result on every call', () => {
  const first = countByStatus([]);
  const second = countByStatus([]);
  assert.notStrictEqual(first, second);
  first.pending = 10;
  assert.equal(second.pending, 0);
});

test('rejects non-array inputs', () => {
  for (const value of [undefined, null, {}, 'pending', 1, true, () => {}]) {
    assert.throws(() => countByStatus(value), TypeError);
  }
});

test('rejects null and non-object elements', () => {
  for (const value of [null, undefined, 'done', 1, false, Symbol('task'), () => {}]) {
    assert.throws(() => countByStatus([value]), TypeError);
  }
});

test('rejects missing status properties', () => {
  assert.throws(() => countByStatus([{}]), TypeError);
  assert.throws(() => countByStatus([{ name: 'task' }]), TypeError);
});

test('rejects unknown, case-mismatched and non-string statuses', () => {
  for (const status of [
    'Pending',
    'DONE',
    '',
    'unknown',
    'toString',
    '__proto__',
    undefined,
    null,
    0,
    true,
    {},
    new String('done'),
  ]) {
    assert.throws(() => countByStatus([{ status }]), TypeError);
  }
});

test('does not mutate frozen inputs and ignores extra fields', () => {
  const task = Object.freeze({ status: 'done', title: 'Example', extra: 42 });
  const tasks = Object.freeze([task]);
  assert.deepEqual(countByStatus(tasks), { pending: 0, running: 0, done: 1 });
  assert.deepEqual(tasks, [{ status: 'done', title: 'Example', extra: 42 }]);
});

test('rejects sparse array entries', () => {
  assert.throws(() => countByStatus(new Array(1)), TypeError);
});

test('leaves inputs unchanged when a later element is invalid', () => {
  const tasks = [{ status: 'pending' }, { status: 'invalid' }];
  const before = structuredClone(tasks);
  assert.throws(() => countByStatus(tasks), TypeError);
  assert.deepEqual(tasks, before);
});
