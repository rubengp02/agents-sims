import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { projectFileTool } from '../src/tools/projectFiles.js';
import { OfficeToolRuntime } from '../src/tools/toolRuntime.js';
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'office-mutations-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
describe('server-authorized project mutations', () => {
  it('creates, updates, truncates and deletes only against the observed version', async () => {
    await projectFileTool(root, 'project_write', {
      path: 'src/a.txt',
      content: 'texto largo ñ',
      expectedSha256: null,
    });
    const read = (await projectFileTool(root, 'project_read', { path: 'src/a.txt' })) as {
      sha256: string;
      text: string;
    };
    expect(read.sha256).toBe(hash('texto largo ñ'));
    await expect(
      projectFileTool(root, 'project_write', {
        path: 'src/a.txt',
        content: 'overwrite',
        expectedSha256: '0'.repeat(64),
      }),
    ).rejects.toThrow();
    expect(readFileSync(join(root, 'src/a.txt'), 'utf8')).toBe('texto largo ñ');
    await projectFileTool(root, 'project_write', {
      path: 'src/a.txt',
      content: 'ñ',
      expectedSha256: read.sha256,
    });
    expect(readFileSync(join(root, 'src/a.txt'), 'utf8')).toBe('ñ');
    await projectFileTool(root, 'project_delete', { path: 'src/a.txt', expectedSha256: hash('ñ') });
    expect(existsSync(join(root, 'src/a.txt'))).toBe(false);
  });
  it('does not overwrite an existing file with create permission or create parents during a failed delete', async () => {
    writeFileSync(join(root, 'a.txt'), 'before');
    await expect(
      projectFileTool(root, 'project_write', {
        path: 'a.txt',
        expectedSha256: null,
        content: 'after',
      }),
    ).rejects.toThrow();
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('before');
    await expect(
      projectFileTool(root, 'project_delete', {
        path: 'missing/a.txt',
        expectedSha256: hash('before'),
      }),
    ).rejects.toThrow();
    expect(existsSync(join(root, 'missing'))).toBe(false);
  });
  it.each([
    '../outside.txt',
    '.env',
    '.git/config',
    'auth.json',
    'nested/secrets.json',
    'C:/outside.txt',
  ])('rejects protected paths: %s', async (path) => {
    await expect(
      projectFileTool(root, 'project_write', { path, expectedSha256: null, content: 'no' }),
    ).rejects.toThrow();
  });
  it('rejects a symlink outside the allowed tree', async () => {
    const outside = join(root, 'outside'),
      project = join(root, 'project');
    mkdirSync(outside);
    mkdirSync(project);
    symlinkSync(outside, join(project, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(
      projectFileTool(project, 'project_write', {
        path: 'link/file.txt',
        content: 'no',
        expectedSha256: null,
      }),
    ).rejects.toThrow();
    expect(existsSync(join(outside, 'file.txt'))).toBe(false);
  });
  it.each(['chief', 'architect', 'designer', 'tester'] as const)(
    'keeps %s unable to write despite a client-side permission flag',
    async (role) => {
      const session = new OfficeToolRuntime({ stateDir: join(root, 'state') }).createSession({
        taskId: 'fixture',
        role,
        allowWrites: true,
        project: root,
      });
      await expect(
        session.execute('project_write', { path: 'a', content: 'no', expectedSha256: null }),
      ).rejects.toThrow();
      await expect(
        session.execute('project_delete', { path: 'a', expectedSha256: hash('x') }),
      ).rejects.toThrow();
      expect(existsSync(join(root, 'a'))).toBe(false);
      await session.dispose();
    },
  );
  it('keeps an unauthorized developer read-only and returns real image bytes only by bound index', async () => {
    const image = join(root, 'image.png'),
      bytes = Buffer.from('fixture-bytes');
    writeFileSync(image, bytes);
    const session = new OfficeToolRuntime({ stateDir: join(root, 'state') }).createSession({
      taskId: 'fixture',
      role: 'developer',
      allowWrites: false,
      project: root,
      images: [{ name: 'image.png', path: image, mimeType: 'image/png' }],
    });
    await expect(
      session.execute('project_write', { path: 'a', content: 'no', expectedSha256: null }),
    ).rejects.toThrow();
    const list = await session.execute('attachment_list', {});
    expect(JSON.stringify(list)).not.toContain(root);
    expect((await session.execute('attachment_read', { index: 0 })).content).toEqual([
      { type: 'image', mimeType: 'image/png', data: bytes.toString('base64') },
    ]);
    await expect(
      session.execute('attachment_read', { index: 1, path: 'private' }),
    ).rejects.toThrow();
    await session.dispose();
  });
});
