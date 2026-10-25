import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LocalFileApprovals } from '../src/execution/localFileApprovals.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture(write = true) {
  const root = mkdtempSync(join(tmpdir(), 'office-patch-'));
  roots.push(root);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/label.mjs'), 'baseline');
  const policy = new LocalFileApprovals(root, write);
  const request = { threadId: 'thread', turnId: 'turn', itemId: 'patch' };
  const observe = (path: string, kind: Record<string, unknown> = { type: 'update' }) =>
    policy.observe('item/started', {
      threadId: 'thread',
      turnId: 'turn',
      item: {
        id: 'patch',
        type: 'fileChange',
        status: 'inProgress',
        changes: [{ path, kind, diff: '' }],
      },
    });
  return { root, policy, request, observe, accept: () => policy.accept(request, 'thread', 'turn') };
}
describe('one observed local patch at a time', () => {
  it.each(['src/label.mjs', 'src/new/deep.mjs'])(
    'accepts an authorized project edit: %s',
    (path) => {
      const f = fixture();
      f.observe(join(f.root, path));
      expect(f.accept()).toBe(true);
      expect(f.accept()).toBe(false);
    },
  );
  it('keeps readers read-only', () => {
    const f = fixture(false);
    f.observe('src/label.mjs');
    expect(f.accept()).toBe(false);
  });
  it.each([
    '../outside.mjs',
    '.git/config',
    '.env',
    'src/auth.json',
    'src/key.pem',
    'src/file:stream',
  ])('rejects an unauthorized target: %s', (path) => {
    const f = fixture();
    f.observe(path);
    expect(f.accept()).toBe(false);
  });
  it('validates move destinations as well as source paths', () => {
    const f = fixture();
    f.observe('src/label.mjs', { type: 'update', move_path: '../outside.mjs' });
    expect(f.accept()).toBe(false);
    f.observe('src/label.mjs', { type: 'update', move_path: 'src/renamed.mjs' });
    expect(f.accept()).toBe(true);
  });
  it('rejects symlink ancestors including a new file below a linked directory', () => {
    const f = fixture();
    symlinkSync(join(f.root, 'src'), join(f.root, 'linked'), 'junction');
    f.observe('linked/new.mjs');
    expect(f.accept()).toBe(false);
  });
  it('rejects unobserved, obsolete, mismatched, or broader grants', () => {
    const f = fixture();
    expect(f.accept()).toBe(false);
    f.observe('src/label.mjs');
    expect(f.policy.accept({ ...f.request, grantRoot: f.root }, 'thread', 'turn')).toBe(false);
    f.observe('src/label.mjs');
    expect(f.policy.accept({ ...f.request, turnId: 'other' }, 'thread', 'turn')).toBe(false);
    f.observe('src/label.mjs');
    f.policy.clear();
    expect(f.accept()).toBe(false);
    f.observe('src/label.mjs');
    f.policy.observe('item/completed', { item: { id: 'patch', type: 'fileChange' } });
    expect(f.accept()).toBe(false);
  });
});
