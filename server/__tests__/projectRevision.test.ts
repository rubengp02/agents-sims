import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  captureDirectoryRevision,
  projectRevisionCapture,
} from '../src/execution/projectRevision.js';
import { buildReviewPacket, captureRevision } from '../src/execution/reviewPacket.js';
import { revisionFile } from '../src/execution/revisionStore.js';

const directories: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'office-folder-review-'));
  directories.push(root);
  const project = join(root, 'project');
  mkdirSync(project);
  return { root, project };
}
afterEach(() =>
  directories.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })),
);

describe('project revisions without a repository (local files, no inference)', () => {
  it.each([false, true])(
    'keeps Codex instructions while excluding generated images (Git: %s)',
    (git) => {
      const { project } = fixture();
      if (git) execFileSync('git', ['init', project], { windowsHide: true, stdio: 'ignore' });
      mkdirSync(join(project, '.codex', 'generated_images'), { recursive: true });
      writeFileSync(join(project, '.codex', 'instructions.md'), 'Project instructions');
      writeFileSync(
        join(project, '.codex', 'generated_images', 'resource.png'),
        Buffer.alloc(32_000_001),
      );
      const capture = projectRevisionCapture(project);
      expect(Object.keys(capture().files)).toEqual(['.codex/instructions.md']);
    },
  );
  it('captures an ordinary parent folder containing a repository without its ignored test artifacts', () => {
    const { project } = fixture();
    const nested = join(project, 'application');
    mkdirSync(nested);
    execFileSync('git', ['init', nested], { windowsHide: true, stdio: 'ignore' });
    writeFileSync(join(nested, '.gitignore'), 'generated/\n');
    writeFileSync(join(nested, 'app.py'), 'print(1)');
    mkdirSync(join(nested, 'generated'));
    writeFileSync(join(nested, 'generated', 'output.bin'), Buffer.alloc(32_000_001));
    mkdirSync(join(project, 'allure-results'));
    writeFileSync(join(project, 'allure-results', 'output.json'), 'generated result');
    const capture = projectRevisionCapture(project),
      before = capture();
    expect(Object.keys(before.files)).toEqual(['application/.gitignore', 'application/app.py']);
    writeFileSync(join(nested, 'generated', 'output.bin'), 'new output');
    expect(capture().digest).toBe(before.digest);
    writeFileSync(join(nested, 'app.py'), 'print(2)');
    expect(capture().digest).not.toBe(before.digest);
    expect(existsSync(join(project, '.git'))).toBe(false);
  });
  it('reviews additions, edits and deletions without creating Git metadata or changing source files', () => {
    const { root, project } = fixture();
    writeFileSync(join(project, 'edit.txt'), 'before\n');
    writeFileSync(join(project, 'delete.txt'), 'removed\n');
    const capture = projectRevisionCapture(project),
      base = capture();
    writeFileSync(join(project, 'edit.txt'), 'after\n');
    writeFileSync(join(project, 'new.txt'), 'created\n');
    rmSync(join(project, 'delete.txt'));
    const after = capture();
    const packet = buildReviewPacket(
      base,
      after,
      { objective: 'Update', files: [], decisions: [], acceptance: ['Correct result'], checks: [] },
      [],
      'focused',
      join(root, 'private-review'),
    );
    expect(after.digest).not.toBe(base.digest);
    expect(packet.files.map((f) => f.path)).toEqual(['delete.txt', 'edit.txt', 'new.txt']);
    expect(packet.diff).toContain('-before');
    expect(packet.diff).toContain('+after');
    expect(packet.diff).toContain('+created');
    expect(packet.diff).toContain('-removed');
    expect(existsSync(join(project, '.git'))).toBe(false);
    expect(() => captureRevision(project)).toThrow('repositorio Git');
  });
  it('excludes dependencies, credentials and generated outputs while retaining source files', () => {
    const { project } = fixture();
    for (const dir of ['node_modules', '.venv', '__pycache__', '.local-office', 'dist']) {
      mkdirSync(join(project, dir));
      writeFileSync(join(project, dir, 'file.txt'), dir);
    }
    writeFileSync(join(project, '.env'), 'PRIVATE_FIXTURE');
    writeFileSync(join(project, '.env.local'), 'PRIVATE_FIXTURE');
    writeFileSync(join(project, '.env.example'), 'PUBLIC_EXAMPLE');
    writeFileSync(join(project, 'app.py'), 'print(1)');
    const before = captureDirectoryRevision(project);
    expect(Object.keys(before.files)).toEqual(['.env.example', 'app.py']);
    writeFileSync(join(project, 'node_modules/file.txt'), 'cache update');
    expect(captureDirectoryRevision(project).digest).toBe(before.digest);
  });
  it('keeps a folder capture stable if the task subsequently initializes Git', () => {
    const { project } = fixture();
    writeFileSync(join(project, 'app.py'), 'before');
    const capture = projectRevisionCapture(project),
      before = capture();
    execFileSync('git', ['init', project], { windowsHide: true, stdio: 'ignore' });
    writeFileSync(join(project, '.gitignore'), 'app.py\n');
    writeFileSync(join(project, 'app.py'), 'after');
    expect(readFileSync(revisionFile(capture(), 'app.py')!, 'utf8')).toBe('after');
    expect(capture().digest).not.toBe(before.digest);
    expect(projectRevisionCapture(project)().files['app.py']).toBeUndefined();
  });
  it('preserves errors in an existing broken repository', () => {
    const { project } = fixture();
    writeFileSync(join(project, '.git'), 'gitdir: missing-repository');
    expect(() => projectRevisionCapture(project)).toThrow('repositorio Git');
  });
  it('rejects links outside the project and captures legitimate files larger than the old limit', () => {
    const { root, project } = fixture();
    const outside = join(root, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, join(project, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => captureDirectoryRevision(project)).toThrow('enlace');
    rmSync(join(project, 'link'));
    writeFileSync(join(project, 'large.bin'), Buffer.alloc(32_000_001));
    const snapshot = captureDirectoryRevision(project);
    expect(snapshot.format).toBe('sha256-v1');
    expect(statSync(revisionFile(snapshot, 'large.bin')!).size).toBe(32_000_001);
    expect(JSON.stringify(snapshot).length).toBeLessThan(1000);
  });
  it.each([false, true])(
    'ignores VS Code test installations without limiting source size (Git: %s)',
    (git) => {
      const { project } = fixture();
      if (git) execFileSync('git', ['init', project], { windowsHide: true, stdio: 'ignore' });
      mkdirSync(join(project, '.vscode-test'));
      writeFileSync(join(project, '.vscode-test', 'runtime.dll'), Buffer.alloc(40_000_000));
      writeFileSync(join(project, 'source.ts'), 'export const realSource = true');
      expect(Object.keys(projectRevisionCapture(project)().files)).toEqual(['source.ts']);
    },
  );
  it('captures more than ten thousand source files without copying their contents into the manifest', () => {
    const { project } = fixture();
    for (let i = 0; i < 10001; i++) writeFileSync(join(project, `file-${i}.ts`), 'same content');
    const snapshot = captureDirectoryRevision(project);
    expect(Object.keys(snapshot.files)).toHaveLength(10001);
    expect(new Set(Object.values(snapshot.files)).size).toBe(1);
  }, 60000);
});
