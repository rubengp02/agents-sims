import { describe, expect, it } from 'vitest';

import { normalizeWorkflowPlan } from '../src/execution/workflowPlan.js';

const job = (role: string, dependsOn: number[] = [], parallelSafe?: boolean) => ({
  role,
  title: role,
  prompt: `Tarea ${role}`,
  dependsOn,
  parallelSafe,
});

describe('ordered workflow safety', () => {
  it('repairs unordered architecture/development/QA even when the model omits edges', () => {
    const plan = normalizeWorkflowPlan([job('tester'), job('developer'), job('architect')]);
    expect(plan.map((task) => task.role)).toEqual(['architect', 'developer', 'tester']);
    expect(plan[1].dependsOn).toEqual([0]);
    expect(new Set(plan[2].dependsOn)).toEqual(new Set([0, 1]));
  });
  it('keeps two independent analyses available in parallel before implementation', () => {
    const plan = normalizeWorkflowPlan([
      job('architect', [], true),
      job('designer', [], true),
      job('developer', [0, 1]),
      job('tester'),
    ]);
    expect(plan.slice(0, 2).map((task) => [task.parallelSafe, task.dependsOn])).toEqual([
      [true, []],
      [true, []],
    ]);
    expect(plan[2].dependsOn).toEqual([0, 1]);
    expect(plan[3].dependsOn).toContain(2);
  });
  it('accepts forward dependencies and remaps them after topological sorting', () => {
    const plan = normalizeWorkflowPlan([job('designer', [1], true), job('architect', [], true)]);
    expect(plan.map((task) => task.role)).toEqual(['architect', 'designer']);
    expect(plan[1].dependsOn).toEqual([0]);
  });
  it('does not assume independence when a model omits that declaration', () => {
    expect(normalizeWorkflowPlan([job('designer')])[0].parallelSafe).toBe(false);
  });
  it.each([
    [job('architect', [1]), job('developer')],
    [job('designer', [1]), job('architect', [0])],
    [job('tester', [0])],
    [job('chief')],
    [job('developer', [5])],
    [{ ...job('designer'), parallelSafe: 'yes' }],
  ])('rejects cycles, role conflicts and invalid model data atomically: %j', (...raw) => {
    expect(() => normalizeWorkflowPlan(raw)).toThrow();
  });
});
