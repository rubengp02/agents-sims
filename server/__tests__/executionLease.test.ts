import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { acquireCodexLease } from '../src/execution/executionLease.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function root() {
  const value = mkdtempSync(join(tmpdir(), 'pixel-slots-'));
  roots.push(value);
  return value;
}

describe('cross-process Codex execution slots', () => {
  it('allows two readers and rejects a third, then frees only its owned slot', () => {
    const dir = root();
    const a = acquireCodexLease(dir, 'a', true),
      b = acquireCodexLease(dir, 'b', true);
    try {
      expect(() => acquireCodexLease(dir, 'third', true)).toThrow();
      a();
      expect(readdirSync(dir).filter((file) => file.endsWith('.lock'))).toHaveLength(1);
      const c = acquireCodexLease(dir, 'c', true);
      c();
      b();
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      a();
      b();
    }
  });
  it('blocks standalone/exclusive execution while any managed reader runs', () => {
    const dir = root();
    const release = acquireCodexLease(dir, 'reader', true);
    try {
      expect(() => acquireCodexLease(dir, 'writer', false)).toThrow();
    } finally {
      release();
    }
    const writer = acquireCodexLease(dir, 'writer', false);
    writer();
  });
  it('blocks readers when the CLI or a write task holds the original exclusive lock', () => {
    const dir = root();
    const release = acquireCodexLease(dir, 'exclusive', false);
    try {
      expect(() => acquireCodexLease(dir, 'reader', true)).toThrow();
    } finally {
      release();
    }
  });
  it('preserves abandoned locks instead of automatically treating them as permission', () => {
    const dir = root();
    writeFileSync(join(dir, 'executor.lock'), 'unverified previous run');
    expect(() => acquireCodexLease(dir, 'new', true)).toThrow();
    expect(existsSync(join(dir, 'executor.lock'))).toBe(true);
    expect(existsSync(join(dir, 'executor-gate.lock'))).toBe(false);
  });
  it('does not remove a lock replaced by another owner', () => {
    const dir = root();
    const release = acquireCodexLease(dir, 'first', true);
    writeFileSync(join(dir, 'executor-read-0.lock'), JSON.stringify({ runId: 'another-owner' }));
    release();
    expect(existsSync(join(dir, 'executor-read-0.lock'))).toBe(true);
  });
});
