import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { isolatedProjectInstructions } from '../src/execution/projectInstructions.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'office-project-instructions-'));
  roots.push(root);
  const project = join(root, 'project'),
    workspace = join(root, 'workspace');
  mkdirSync(project);
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', project, ...args], { windowsHide: true, stdio: 'pipe' });
  git('init');
  writeFileSync(join(project, 'AGENTS.md'), 'TRACKED_PROJECT_RULE');
  git('add', 'AGENTS.md');
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-m',
    'fixture',
  );
  git('worktree', 'add', '--detach', workspace, 'HEAD');
  return { root, project, workspace };
}
describe('project instructions across isolated worktrees (real local Git, no model)', () => {
  it('does not duplicate guidance already available to native discovery', () => {
    const f = fixture();
    expect(isolatedProjectInstructions(f.project, f.project)).toBe('');
    expect(isolatedProjectInstructions(f.project, f.workspace)).toBe('');
  });
  it('preserves an ignored local override that Git does not copy', () => {
    const f = fixture();
    writeFileSync(join(f.project, '.git', 'info', 'exclude'), 'AGENTS.override.md\n');
    writeFileSync(join(f.project, 'AGENTS.override.md'), 'LOCAL_OVERRIDE_RULE');
    const text = isolatedProjectInstructions(f.project, f.workspace);
    expect(text).toContain('LOCAL_OVERRIDE_RULE');
    expect(text).not.toContain('TRACKED_PROJECT_RULE');
  });
  it('preserves nested project scope and excludes unrelated ancestor projects', () => {
    const f = fixture();
    writeFileSync(join(f.root, 'AGENTS.md'), 'UNRELATED_PARENT_RULE');
    mkdirSync(join(f.project, 'sub'));
    writeFileSync(join(f.project, 'sub', 'AGENTS.md'), 'NESTED_PROJECT_RULE');
    const text = isolatedProjectInstructions(join(f.project, 'sub'), f.workspace);
    expect(text).toContain('NESTED_PROJECT_RULE');
    expect(text).not.toContain('UNRELATED_PARENT_RULE');
    expect(text).not.toContain('TRACKED_PROJECT_RULE');
  });
  it('skips empty overrides and does not treat codex.md as an automatic instruction file', () => {
    const f = fixture();
    writeFileSync(join(f.project, 'AGENTS.override.md'), '  \n');
    writeFileSync(join(f.project, 'codex.md'), 'UNCONFIGURED_FALLBACK');
    expect(isolatedProjectInstructions(f.project, f.workspace)).toBe('');
  });
  it('blocks oversized instructions instead of silently discarding rules', () => {
    const f = fixture();
    writeFileSync(join(f.project, 'AGENTS.override.md'), 'x'.repeat(32_769));
    expect(() => isolatedProjectInstructions(f.project, f.workspace)).toThrow(/32 KiB/);
  });
});
