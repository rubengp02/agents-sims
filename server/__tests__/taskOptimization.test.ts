import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { TaskAssessment, TaskContext } from '../../core/src/team.js';
import { LocalChecks } from '../src/execution/localChecks.js';
import { assessTask, validateAssessment } from '../src/execution/taskAssessment.js';
import { prepareTaskContext, validateContext } from '../src/execution/taskContext.js';

const cases = JSON.parse(
  readFileSync(join(__dirname, '../../reports/contexto/casos-clasificacion.json'), 'utf8'),
) as Array<{
  id: string;
  prompt: string;
  assessment?: TaskAssessment;
  expected: string;
  roles: string[];
}>;
const packet: TaskContext = {
  objective: 'Corrige la función',
  files: ['src/math.ts'],
  decisions: ['Conserva el contrato'],
  acceptance: ['Casos límite válidos'],
  checks: ['unit'],
};
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});
describe('scope routing acceptance corpus (no inference)', () => {
  it.each(cases)('$id', (item) => {
    const result = assessTask(item.prompt, item.assessment);
    expect(result.difficulty).toBe(item.expected);
    expect(result.roles).toEqual(item.roles);
  });
  it('rejects invalid evidence instead of treating it as low risk', () => {
    expect(() => validateAssessment({ scope: 'bounded' } as TaskAssessment)).toThrow();
  });
});
describe('specific context', () => {
  it('preserves acceptance and decisions without needing history; deterministic identity', () => {
    const prepared = prepareTaskContext('developer', 'Implementa el encargo', packet);
    expect(prepared.prompt).toContain('Casos límite válidos');
    expect(prepared.prompt).toContain('Conserva el contrato');
    expect(prepared.fingerprint).toBe(
      prepareTaskContext('developer', 'Implementa el encargo', { ...packet }).fingerprint,
    );
    expect(prepared.fingerprint).not.toBe(
      prepareTaskContext('tester', 'Implementa el encargo', packet).fingerprint,
    );
  });
  it('marks incomplete handoffs explicitly and bounds them', () => {
    const prepared = prepareTaskContext('tester', 'Comprueba', packet, [
      { title: 'A', output: 'X'.repeat(20000) },
      { title: 'B', output: 'Y'.repeat(20000) },
    ]);
    expect(prepared.dependencyTruncated).toBe(true);
    expect(prepared.prompt).toContain('"truncated":true');
    expect(prepared.characters).toBeLessThan(10000);
  });
  it.each(['../private', '/private', 'C:\\private', 'src/../../private'])(
    'rejects out-of-project reference %s',
    (file) => {
      expect(() => validateContext({ ...packet, files: [file] })).toThrow();
    },
  );
  it('rejects lost acceptance and oversize packets instead of silently cutting them', () => {
    expect(() => validateContext({ ...packet, acceptance: [] })).toThrow();
    expect(() => validateContext({ ...packet, decisions: ['a'.repeat(1001)] })).toThrow();
  });
});
describe('mechanical checks bypass model calls', () => {
  function runner() {
    const root = mkdtempSync(join(tmpdir(), 'pixel-checks-'));
    roots.push(root);
    return {
      root,
      checks: new LocalChecks(
        {
          pass: { executable: process.execPath, args: ['-e', 'process.exit(0)'], timeoutMs: 2000 },
          fail: { executable: process.execPath, args: ['-e', 'process.exit(3)'], timeoutMs: 2000 },
          hang: {
            executable: process.execPath,
            args: ['-e', 'setInterval(()=>{},1000)'],
            timeoutMs: 40,
          },
        },
        root,
      ),
    };
  }
  it('records actual exit codes and stops on failure', async () => {
    const h = runner();
    const result = await h.checks.run(
      ['pass', 'fail', 'pass'],
      h.root,
      new AbortController().signal,
    );
    expect(result.map((check) => [check.id, check.exitCode, check.passed])).toEqual([
      ['pass', 0, true],
      ['fail', 3, false],
    ]);
  });
  it('refuses unconfigured strings without shell execution', async () => {
    const h = runner();
    await expect(
      h.checks.run(['pass; echo unsafe'], h.root, new AbortController().signal),
    ).rejects.toThrow();
  });
  it('stops hung checks and respects cancellation', async () => {
    const h = runner();
    expect((await h.checks.run(['hang'], h.root, new AbortController().signal))[0].passed).toBe(
      false,
    );
    const controller = new AbortController();
    controller.abort();
    await expect(h.checks.run(['pass'], h.root, controller.signal)).rejects.toThrow();
  });
});
