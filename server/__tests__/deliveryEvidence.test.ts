import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { validDeliveryEvidence } from '../../core/src/deliveryEvidence.js';
import type { TeamTask } from '../../core/src/team.js';
import { buildDeliveryEvidence } from '../src/execution/deliveryEvidence.js';

const revision = (files: Record<string, string>) => ({
  format: 'sha256-v1' as const,
  files,
  digest: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
});
const base = revision({ 'app.ts': 'a'.repeat(64), 'old.ts': 'b'.repeat(64) });
const candidate = revision({ 'app.ts': 'c'.repeat(64), 'new.ts': 'd'.repeat(64) });
const root = { id: 'objective', objectiveRevision: 2 } as TeamTask;
const reviewer = {
  id: 'review',
  role: 'tester',
  status: 'completed',
  officeParentId: root.id,
  checkedRevision: candidate.digest,
  objectiveRevision: 2,
} as TeamTask;

describe('server-derived final delivery evidence', () => {
  it('records actual additions, modifications and removals rather than model claims', () => {
    const evidence = buildDeliveryEvidence({
      root,
      base,
      candidate,
      tasks: [],
      reviewTask: reviewer,
      checks: [{ id: 'test', exitCode: 0, durationMs: 100, passed: true }],
      direct: false,
      execution: 'simulated',
    });
    expect(evidence.changes.files).toEqual(['app.ts', 'new.ts', 'old.ts']);
    expect(evidence.review).toMatchObject({ state: 'tester', candidate: candidate.digest });
    expect(evidence.limitations.join(' ')).toContain('ejecutor simulado');
    expect(evidence.limitations.join(' ')).toContain('no atribuye');
    expect(validDeliveryEvidence(evidence)).toBe(true);
    expect(JSON.stringify(evidence)).not.toContain('blobDirectory');
  });
  it('does not invent tests, review or file evidence for a direct answer', () => {
    const evidence = buildDeliveryEvidence({
      root,
      tasks: [],
      checks: [],
      direct: true,
      execution: 'unknown',
    });
    expect(evidence.changes.state).toBe('not_captured');
    expect(evidence.checks).toEqual([]);
    expect(evidence.review).toEqual({ state: 'direct', taskId: null, candidate: null });
    expect(evidence.limitations.join(' ')).toContain('no cuentan como pruebas registradas');
  });
  it('rejects stale, incomplete or unrelated reviews and absolute file references', () => {
    const input = {
      root,
      tasks: [],
      base,
      candidate,
      checks: [],
      direct: false,
      execution: 'official-cli' as const,
    };
    for (const reviewTask of [
      undefined,
      { ...reviewer, checkedRevision: base.digest },
      { ...reviewer, status: 'blocked' as const },
      { ...reviewer, officeParentId: 'other' },
      { ...reviewer, objectiveRevision: 1 },
    ])
      expect(() => buildDeliveryEvidence({ ...input, reviewTask })).toThrow();
    expect(() => buildDeliveryEvidence({ ...input, direct: true })).toThrow();
    expect(() =>
      buildDeliveryEvidence({
        ...input,
        reviewTask: reviewer,
        candidate: revision({ 'C:/private/history.txt': 'a'.repeat(64) }),
      }),
    ).toThrow();
  });
});
