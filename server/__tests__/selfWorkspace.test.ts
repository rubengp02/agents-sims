import { execFileSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  ftruncateSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { captureDirectoryRevision } from '../src/execution/projectRevision.js';
import {
  createSelfWorkspace,
  inspectSelfWorkspace,
  integrateSelfWorkspace,
  isSelfProject,
  rehomeSelfWorkspace,
} from '../src/execution/selfWorkspace.js';

const roots: string[] = [];
afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'office-isolation-'));
  roots.push(root);
  const sourceRoot = join(root, 'source'),
    workspacesRoot = join(root, 'private-copies');
  mkdirSync(sourceRoot);
  writeFileSync(join(sourceRoot, 'app.ts'), 'original');
  return { root, sourceRoot, workspacesRoot };
}
describe('self-project isolated workspaces (real filesystem, no inference)', () => {
  it('relocates a copy preserving its edits, baseline and integration conflict checks', async () => {
    const { root, sourceRoot, workspacesRoot } = fixture();
    writeFileSync(join(sourceRoot, 'delete.ts'), 'to remove');
    const old = await createSelfWorkspace({ sourceRoot, workspacesRoot });
    writeFileSync(join(old.workspaceRoot, 'app.ts'), 'copy edit');
    writeFileSync(join(old.workspaceRoot, 'new.ts'), 'new file');
    rmSync(join(old.workspaceRoot, 'delete.ts'));
    const relocated = await rehomeSelfWorkspace(old.receiptPath, join(root, 'accessible'));
    expect(relocated.sourceRoot).toBe(old.sourceRoot);
    expect(relocated.base).toEqual(old.base);
    expect((await inspectSelfWorkspace(relocated.receiptPath)).changes).toEqual([
      { path: 'app.ts', kind: 'modified' },
      { path: 'delete.ts', kind: 'deleted' },
      { path: 'new.ts', kind: 'added' },
    ]);
    expect(readFileSync(join(old.workspaceRoot, 'app.ts'), 'utf8')).toBe('copy edit');
    writeFileSync(join(sourceRoot, 'app.ts'), 'concurrent original edit');
    const result = await integrateSelfWorkspace({
      receiptPath: relocated.receiptPath,
      reviewedPaths: ['app.ts'],
      reviewedSnapshot: captureDirectoryRevision(relocated.workspaceRoot),
    });
    expect(result.conflicts).toContain('app.ts');
    expect(readFileSync(join(sourceRoot, 'app.ts'), 'utf8')).toBe('concurrent original edit');
  });
  it('recovers receipts created before test runtimes were excluded', async () => {
    const { sourceRoot, workspacesRoot } = fixture();
    const receipt = await createSelfWorkspace({ sourceRoot, workspacesRoot });
    receipt.base['.vscode-test/old-runtime.dll'] = 'a'.repeat(64);
    writeFileSync(receipt.receiptPath, JSON.stringify(receipt));
    mkdirSync(join(receipt.workspaceRoot, '.vscode-test'));
    writeFileSync(
      join(receipt.workspaceRoot, '.vscode-test', 'old-runtime.dll'),
      'old generated file',
    );
    const recovered = await inspectSelfWorkspace(receipt.receiptPath);
    expect(recovered.changes).toEqual([]);
    expect(recovered.receipt.base['.vscode-test/old-runtime.dll']).toBeUndefined();
  });
  it('copies a project beyond the previous 256 MB limit while excluding test runtimes', async () => {
    const { sourceRoot, workspacesRoot } = fixture();
    const fd = openSync(join(sourceRoot, 'resource.bin'), 'w');
    ftruncateSync(fd, 257 * 1024 * 1024);
    closeSync(fd);
    mkdirSync(join(sourceRoot, '.vscode-test'));
    writeFileSync(join(sourceRoot, '.vscode-test', 'runtime.dll'), 'temporary runtime');
    const receipt = await createSelfWorkspace({ sourceRoot, workspacesRoot });
    expect(statSync(join(receipt.workspaceRoot, 'resource.bin')).size).toBe(257 * 1024 * 1024);
    expect(existsSync(join(receipt.workspaceRoot, '.vscode-test'))).toBe(false);
    expect((await inspectSelfWorkspace(receipt.receiptPath)).changes).toEqual([]);
  }, 60000);
  it('uses disk-backed review evidence and refuses changes introduced after verification', async () => {
    const { sourceRoot, workspacesRoot } = fixture();
    const receipt = await createSelfWorkspace({ sourceRoot, workspacesRoot });
    writeFileSync(join(receipt.workspaceRoot, 'app.ts'), 'reviewed');
    const reviewedSnapshot = captureDirectoryRevision(receipt.workspaceRoot);
    writeFileSync(join(receipt.workspaceRoot, 'app.ts'), 'unreviewed');
    const rejected = await integrateSelfWorkspace({
      receiptPath: receipt.receiptPath,
      reviewedPaths: ['app.ts'],
      reviewedSnapshot,
    });
    expect(rejected.conflicts).toEqual(['app.ts']);
    expect(readFileSync(join(sourceRoot, 'app.ts'), 'utf8')).toBe('original');
    writeFileSync(join(receipt.workspaceRoot, 'app.ts'), 'reviewed');
    const accepted = await integrateSelfWorkspace({
      receiptPath: receipt.receiptPath,
      reviewedPaths: ['app.ts'],
      reviewedSnapshot,
    });
    expect(accepted.applied).toEqual(['app.ts']);
  });
  it('refuses candidate changes after independent review without applying any reviewed file', async () => {
    const { sourceRoot, workspacesRoot } = fixture();
    const receipt = await createSelfWorkspace({ sourceRoot, workspacesRoot });
    writeFileSync(join(receipt.workspaceRoot, 'app.ts'), 'reviewed fix');
    const reviewedFiles = { 'app.ts': Buffer.from('reviewed fix').toString('base64') };
    writeFileSync(join(receipt.workspaceRoot, 'app.ts'), 'later unreviewed fix');
    const result = await integrateSelfWorkspace({
      receiptPath: receipt.receiptPath,
      reviewedPaths: ['app.ts'],
      reviewedFiles,
    });
    expect(result.applied).toEqual([]);
    expect(result.conflicts).toEqual(['app.ts']);
    expect(readFileSync(join(sourceRoot, 'app.ts'), 'utf8')).toBe('original');
    writeFileSync(join(receipt.workspaceRoot, 'app.ts'), 'reviewed fix');
    writeFileSync(join(receipt.workspaceRoot, 'unexpected.ts'), 'unreviewed addition');
    const added = await integrateSelfWorkspace({
      receiptPath: receipt.receiptPath,
      reviewedPaths: ['app.ts'],
      reviewedFiles,
    });
    expect(added.applied).toEqual([]);
    expect(added.conflicts).toEqual(['unexpected.ts']);
  });
  it('writes only the exact verified snapshot and accepts reviewed additions and deletions', async () => {
    const { sourceRoot, workspacesRoot } = fixture();
    const receipt = await createSelfWorkspace({ sourceRoot, workspacesRoot });
    rmSync(join(receipt.workspaceRoot, 'app.ts'));
    writeFileSync(join(receipt.workspaceRoot, 'new.ts'), 'independently reviewed');
    const result = await integrateSelfWorkspace({
      receiptPath: receipt.receiptPath,
      reviewedPaths: ['app.ts', 'new.ts'],
      reviewedFiles: { 'new.ts': Buffer.from('independently reviewed').toString('base64') },
    });
    expect(result.conflicts).toEqual([]);
    expect(result.applied).toEqual(['app.ts', 'new.ts']);
    expect(existsSync(join(sourceRoot, 'app.ts'))).toBe(false);
    expect(readFileSync(join(sourceRoot, 'new.ts'), 'utf8')).toBe('independently reviewed');
  });
  it('refuses a newly introduced parent junction instead of writing outside the project', async () => {
    const { root, sourceRoot, workspacesRoot } = fixture();
    const receipt = await createSelfWorkspace({ sourceRoot, workspacesRoot });
    mkdirSync(join(receipt.workspaceRoot, 'new-folder'));
    writeFileSync(join(receipt.workspaceRoot, 'new-folder', 'file.ts'), 'agent source');
    const outside = join(root, 'outside');
    mkdirSync(outside);
    symlinkSync(
      outside,
      join(sourceRoot, 'new-folder'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(
      integrateSelfWorkspace({
        receiptPath: receipt.receiptPath,
        reviewedPaths: ['new-folder/file.ts'],
      }),
    ).rejects.toThrow('enlaces');
    expect(existsSync(join(outside, 'file.ts'))).toBe(false);
  });
  it('copies current dirty and untracked source, excluding ignored files and credentials', async () => {
    const { sourceRoot, workspacesRoot } = fixture();
    execFileSync('git', ['init', sourceRoot], { windowsHide: true, stdio: 'ignore' });
    writeFileSync(join(sourceRoot, '.gitignore'), 'ignored/\n');
    execFileSync('git', ['-C', sourceRoot, 'add', 'app.ts'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    writeFileSync(join(sourceRoot, 'app.ts'), 'dirty local source');
    writeFileSync(join(sourceRoot, 'untracked.ts'), 'new source');
    for (const folder of ['node_modules', '.local-office', 'ignored']) {
      mkdirSync(join(sourceRoot, folder));
      writeFileSync(join(sourceRoot, folder, 'private.txt'), 'private');
    }
    writeFileSync(join(sourceRoot, '.env'), 'credential');
    writeFileSync(join(sourceRoot, 'auth.json'), 'credential');
    const receipt = await createSelfWorkspace({ sourceRoot, workspacesRoot });
    expect(readFileSync(join(receipt.workspaceRoot, 'app.ts'), 'utf8')).toBe('dirty local source');
    expect(readFileSync(join(receipt.workspaceRoot, 'untracked.ts'), 'utf8')).toBe('new source');
    for (const name of ['node_modules', '.local-office', 'ignored', '.env', 'auth.json', '.git'])
      expect(existsSync(join(receipt.workspaceRoot, name))).toBe(false);
    expect(receipt.status).toBe('review_required');
    expect(receipt.previewPort).toBe(4174);
    expect(isSelfProject(sourceRoot, sourceRoot)).toBe(true);
    expect(isSelfProject(workspacesRoot, sourceRoot)).toBe(false);
  });
  it('integrates only reviewed files, backs up originals, and preserves unreviewed changes', async () => {
    const { sourceRoot, workspacesRoot } = fixture();
    const receipt = await createSelfWorkspace({ sourceRoot, workspacesRoot });
    writeFileSync(join(receipt.workspaceRoot, 'app.ts'), 'fixed');
    writeFileSync(join(receipt.workspaceRoot, 'extra.ts'), 'pending review');
    expect((await inspectSelfWorkspace(receipt.receiptPath)).changes).toEqual([
      { path: 'app.ts', kind: 'modified' },
      { path: 'extra.ts', kind: 'added' },
    ]);
    const result = await integrateSelfWorkspace({
      receiptPath: receipt.receiptPath,
      reviewedPaths: ['app.ts'],
    });
    expect(result.applied).toEqual(['app.ts']);
    expect(result.conflicts).toEqual([]);
    expect(readFileSync(join(sourceRoot, 'app.ts'), 'utf8')).toBe('fixed');
    expect(existsSync(join(sourceRoot, 'extra.ts'))).toBe(false);
    expect(
      readFileSync(join(receipt.receiptPath, '..', 'integration-backup', 'app.ts'), 'utf8'),
    ).toBe('original');
    await expect(
      integrateSelfWorkspace({ receiptPath: receipt.receiptPath, reviewedPaths: ['app.ts'] }),
    ).rejects.toThrow('ya fue integrada');
  });
  it('preserves both versions on conflict without applying other reviewed changes', async () => {
    const { sourceRoot, workspacesRoot } = fixture();
    const receipt = await createSelfWorkspace({ sourceRoot, workspacesRoot });
    writeFileSync(join(receipt.workspaceRoot, 'app.ts'), 'agent edit');
    writeFileSync(join(receipt.workspaceRoot, 'new.ts'), 'new');
    writeFileSync(join(sourceRoot, 'app.ts'), 'human edit');
    const result = await integrateSelfWorkspace({
      receiptPath: receipt.receiptPath,
      reviewedPaths: ['new.ts', 'app.ts'],
    });
    expect(result.conflicts).toEqual(['app.ts']);
    expect(result.applied).toEqual([]);
    expect(readFileSync(join(sourceRoot, 'app.ts'), 'utf8')).toBe('human edit');
    expect(readFileSync(join(receipt.workspaceRoot, 'app.ts'), 'utf8')).toBe('agent edit');
    expect(existsSync(join(sourceRoot, 'new.ts'))).toBe(false);
  });
  it('detects external deletions and refuses copies within the live project', async () => {
    const { sourceRoot, workspacesRoot } = fixture();
    await expect(
      createSelfWorkspace({ sourceRoot, workspacesRoot: join(sourceRoot, 'copies') }),
    ).rejects.toThrow('fuera');
    const receipt = await createSelfWorkspace({ sourceRoot, workspacesRoot });
    writeFileSync(join(receipt.workspaceRoot, 'app.ts'), 'agent edit');
    rmSync(join(sourceRoot, 'app.ts'));
    expect(
      (
        await integrateSelfWorkspace({
          receiptPath: receipt.receiptPath,
          reviewedPaths: ['app.ts'],
        })
      ).conflicts,
    ).toEqual(['app.ts']);
    await expect(
      integrateSelfWorkspace({ receiptPath: receipt.receiptPath, reviewedPaths: ['../outside'] }),
    ).rejects.toThrow();
  });
});
