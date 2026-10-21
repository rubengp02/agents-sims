import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { TaskAssessment, TaskContext, WorkflowDecomposition } from '../../core/src/team.js';
import { AdaptiveRuntime } from '../src/execution/adaptiveRuntime.js';
import { acquireCodexLease } from '../src/execution/executionLease.js';
import { LocalChecks } from '../src/execution/localChecks.js';
import { TeamCoordinator } from '../src/execution/teamCoordinator.js';
import type { ExecuteOptions, OfficialExecutor, RunRecord } from '../src/execution/types.js';
import { UsageHistory } from '../src/execution/usageHistory.js';
import {
  chooseWorkflowSchedule,
  ownershipOverlaps,
  validateDecomposition,
} from '../src/execution/workflowPolicy.js';
import { verifiedWorkspace, WorkflowWorkspaceManager } from '../src/execution/workflowWorkspace.js';

const assessment: TaskAssessment = {
  scope: 'bounded',
  risk: 'low',
  uncertainty: 'low',
  modules: ['module'],
  tests: 'available',
};
const context: TaskContext = {
  objective: 'Implementa dos módulos independientes',
  files: ['a.mjs', 'b.mjs'],
  decisions: [],
  acceptance: ['a', 'b'],
  checks: ['a', 'b', 'joint'],
};
const decomposition: WorkflowDecomposition = {
  sharedFiles: [],
  parts: ['a', 'b'].map((name) => ({
    title: name,
    objective: `Implementa ${name}`,
    ownedFiles: [`${name}.mjs`],
    assessment,
    context: {
      objective: `Implementa ${name}`,
      files: [`${name}.mjs`],
      decisions: [],
      acceptance: [name],
      checks: [name],
    },
  })),
};
function fixture(
  options: {
    jointFails?: boolean;
    unknown?: boolean;
    scopeViolation?: boolean;
    experimental?: boolean;
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'office-parallel-'));
  const project = join(dir, 'repo'),
    managed = join(dir, 'spaces');
  mkdirSync(project);
  mkdirSync(managed);
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: project, windowsHide: true, stdio: 'pipe' });
  git(['init', '--initial-branch=main']);
  git(['config', 'core.autocrlf', 'false']);
  for (const name of ['a', 'b'])
    writeFileSync(join(project, `${name}.mjs`), `export const ${name}=0;\n`);
  git(['add', '.']);
  git([
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-m',
    'base',
  ]);
  const manager = new WorkflowWorkspaceManager(
    managed,
    join(dir, 'evidence'),
    async (_project, id, base) => {
      const space = join(managed, id);
      git(['worktree', 'add', '--detach', space, base]);
      return space;
    },
  );
  const checks = new LocalChecks(
    Object.fromEntries(
      ['a', 'b', 'joint'].map((name) => [
        name,
        {
          executable: process.execPath,
          args: [
            '--input-type=module',
            '-e',
            name === 'joint'
              ? `import {a} from './a.mjs';import {b} from './b.mjs';if(a+b!==${options.jointFails ? 999 : 3})process.exit(1);`
              : `import {${name}} from './${name}.mjs';if(${name}!==${name === 'a' ? 1 : 2})process.exit(1);`,
          ],
          timeoutMs: 5000,
          acceptance: name === 'joint',
          criteria: context.acceptance,
        },
      ]),
    ),
    join(dir, 'logs'),
    project,
  );
  let active = 0,
    peak = 0,
    sequence = 0;
  const calls: ExecuteOptions[] = [];
  const executor: OfficialExecutor = {
    provider: 'codex',
    engine: 'agent-orchestrator',
    workspaceManager: manager,
    maxConcurrentReadOnly: 2,
    diagnose: vi.fn(async () => ({
      checkedAt: Date.now(),
      plan: 'plus' as const,
      quota: [],
      models: [{ id: 'gpt-6.1-sol', efforts: ['low', 'high'] }],
    })),
    execute: async (input) => {
      calls.push(input);
      active++;
      peak = Math.max(peak, active);
      const id = String(++sequence);
      const record: RunRecord = {
        version: 1,
        id,
        provider: 'codex',
        billing: 'subscription-only',
        status: 'running',
        project,
        requestedModel: input.model!,
        requestedEffort: input.effort!,
        confirmedModel: null,
        sessionId: id,
        sessionMode: 'new',
        executionProject: input.ownedWorkspace?.path ?? input.inheritedWorkspace,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        reasonCode: null,
        inputTokens: null,
        outputTokens: null,
        subscriptionCheckedAt: Date.now(),
      };
      input.onState?.(record);
      await new Promise((r) => setTimeout(r, 80));
      if (input.ownedWorkspace) {
        verifiedWorkspace(input.ownedWorkspace);
        const name =
          input.ownedWorkspace.workerId ===
          calls.find((c) => c.ownedWorkspace)?.ownedWorkspace?.workerId
            ? 'a'
            : 'b';
        if (!input.signal?.aborted)
          writeFileSync(
            join(input.ownedWorkspace.path, `${name}.mjs`),
            `export const ${name}=${name === 'a' ? 1 : 2};\n`,
          );
        if (options.scopeViolation)
          writeFileSync(join(input.ownedWorkspace.path, 'foreign.txt'), 'bad');
      }
      active--;
      record.status = input.signal?.aborted ? 'cancelled' : 'completed';
      record.updatedAt = Date.now();
      record.inputTokens = options.unknown ? null : 100;
      record.outputTokens = options.unknown ? null : 10;
      input.onOutput?.(
        (input.officeRole === 'tester' ? 'OFFICE_REVIEW {"findings":[]}\n' : '') +
          'OFFICE_RESULT {"status":"completed"}',
      );
      input.onState?.(record);
      return record;
    },
  };
  const checkpoint = join(dir, 'checkpoint.json');
  const runtime = new AdaptiveRuntime(
    new UsageHistory(join(dir, 'history.json')),
    join(dir, 'artifacts'),
  );
  const team = new TeamCoordinator(
    { codex: executor, claude: executor },
    undefined,
    undefined,
    checks,
    undefined,
    checkpoint,
    runtime,
  );
  team.configure({
    mode: 'auto',
    claudeEnabled: false,
    maxRuns: 8,
    maxParallel: 2,
    experimentalParallelWriters: options.experimental !== false,
    maxMinutes: 2,
    maxTokens: 10000,
  });
  return {
    dir,
    project,
    manager,
    checks,
    team,
    executor,
    checkpoint,
    runtime,
    calls,
    peak: () => peak,
  };
}
async function prepare(h: ReturnType<typeof fixture>, review = true, risk: 'low' | 'high' = 'low') {
  h.team.addScopedWorkflow(
    h.project,
    context,
    {
      ...assessment,
      risk,
      scope: 'cross-module',
      modules: ['a', 'b'],
      acceptanceCoverage: 'complete',
    },
    true,
    decomposition,
  );
  for (const task of h.team.snapshot().tasks) {
    await h.team.assign(task.id);
    h.team.reviewBudget(task.id, 1000, 5000, 12000);
  }
  const workflow = h.team.snapshot().workflows![0];
  if (review) h.team.reviewWorkflowBudget(workflow.id, 20000, 20000, 60000);
  return workflow;
}
async function finish(h: ReturnType<typeof fixture>) {
  await vi.waitFor(() => expect(h.team.snapshot().running).toBe(false), { timeout: 15000 });
}

describe('isolated workflow, no inference', () => {
  it('defaults legacy settings to one programmer even with AO, two slots and a valid decomposition', () => {
    const h = fixture({ experimental: false });
    const { experimentalParallelWriters: _ignored, ...legacy } = h.team.snapshot().settings;
    h.team.configure(legacy);
    expect(h.team.snapshot().settings.experimentalParallelWriters).toBe(false);
    h.team.addScopedWorkflow(
      h.project,
      context,
      { ...assessment, acceptanceCoverage: 'complete' },
      true,
      decomposition,
    );
    const state = h.team.snapshot();
    expect(state.tasks.filter((t) => t.role === 'developer')).toHaveLength(1);
    expect(state.workflows).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
    expect(state.tasks[0].context?.files).toEqual(context.files);
    expect(state.tasks[0].context?.acceptance).toEqual(context.acceptance);
    expect(state.tasks[0].prompt).toContain(decomposition.parts[0].objective);
    expect(state.tasks[0].prompt).toContain(decomposition.parts[1].objective);
  });
  it('keeps part decisions and required deep review when collapsing a risky decomposition', () => {
    const h = fixture({ experimental: false }),
      split = structuredClone(decomposition);
    split.parts[0].context.decisions = ['Conservar el formato existente'];
    split.parts[0].assessment.risk = 'high';
    const tasks = h.team.addScopedWorkflow(h.project, context, assessment, true, split);
    expect(tasks.filter((t) => t.role === 'developer')).toHaveLength(1);
    expect(tasks.find((t) => t.role === 'tester')?.reviewMode).toBe('deep');
    expect(
      tasks.every((t) => t.context?.decisions.includes('Conservar el formato existente')),
    ).toBe(true);
  });
  it('disabling the experiment blocks an already prepared two-writer plan without dispatch', async () => {
    const h = fixture();
    await prepare(h);
    h.team.configure({ ...h.team.snapshot().settings, experimentalParallelWriters: false });
    for (const task of h.team.snapshot().tasks) {
      await h.team.assign(task.id);
      h.team.reviewBudget(task.id, 1000, 5000, 12000);
    }
    await expect(h.team.start()).rejects.toMatchObject({
      code: 'experimental_parallel_writers_disabled',
    });
    expect(h.calls).toHaveLength(0);
    expect(h.team.snapshot().workflows).toHaveLength(1);
  });
  it('rejects a replaced worktree even when it has the same path, repository and commit', async () => {
    const h = fixture(),
      a = await h.manager.prepare(h.project, 'identity', 'a');
    const retained = resolve(h.dir, 'retained');
    for (const path of [a.path, retained]) {
      const rel = relative(resolve(h.dir), resolve(path));
      if (!rel || rel.startsWith('..') || isAbsolute(rel))
        throw new Error('Fixture path outside temporary root');
    }
    // Git owns its metadata; no direct writes to protected .git files.
    const git = (args: string[]) =>
      execFileSync('git', ['-C', h.project, ...args], { windowsHide: true, stdio: 'pipe' });
    git(['worktree', 'move', a.path, retained]);
    git(['worktree', 'add', '--detach', a.path, a.baseSHA]);
    expect(() => verifiedWorkspace(a)).toThrow();
  });
  it('validates a simulated chief decomposition without granting it workspace paths or execution', async () => {
    const h = fixture();
    const executor: OfficialExecutor = {
      ...h.executor,
      execute: async (options) => {
        const record = await h.executor.execute({ ...options, onOutput: undefined });
        options.onOutput?.(JSON.stringify({ decomposition }));
        return record;
      },
    };
    const team = new TeamCoordinator(
      { codex: executor, claude: executor },
      undefined,
      undefined,
      h.checks,
    );
    team.configure({ ...h.team.snapshot().settings, experimentalParallelWriters: true });
    await team.plan(h.project, context.objective, true, {
      context,
      assessment: { ...assessment, risk: 'high' },
    });
    expect(team.snapshot().runsUsed).toBe(1);
    expect(team.snapshot().workflows).toHaveLength(1);
    expect(team.snapshot().tasks.filter((t) => t.role === 'developer')).toHaveLength(2);
    expect(team.snapshot().tasks.filter((t) => t.workspaceId)).toHaveLength(0);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].allowWrites).toBe(false);
  });
  it('reviews the integrated diff in a new read-only session and serializes high risk', async () => {
    const h = fixture();
    await prepare(h, true, 'high');
    await h.team.start();
    await finish(h);
    const state = h.team.snapshot(),
      w = state.workflows![0],
      review = h.calls.find((c) => c.officeRole === 'tester')!;
    expect(w.status).toBe('accepted');
    expect(w.mode).toBe('serial');
    expect(h.peak()).toBe(1);
    expect(review.allowWrites).toBe(false);
    expect(review.inheritedWorkspace).toBe(w.candidateProject);
    expect(review.prompt).toContain('a.mjs');
    expect(review.prompt).toContain('b.mjs');
    expect(review.executionSessionKey).not.toBe(
      h.calls.find((c) => c.officeRole === 'developer')!.executionSessionKey,
    );
    expect(state.tasks.find((t) => t.role === 'tester')!.checkedRevision).toBe(w.candidateHash);
  });
  it('preserves both patches on textual conflict and never changes the source', async () => {
    const h = fixture(),
      a = await h.manager.prepare(h.project, 'conflict', 'a'),
      b = await h.manager.prepare(h.project, 'conflict', 'b');
    writeFileSync(join(a.path, 'a.mjs'), 'export const a=1;\n');
    writeFileSync(join(b.path, 'a.mjs'), 'export const a=9;\n');
    const results = [h.manager.seal(a, ['a.mjs']), h.manager.seal(b, ['a.mjs'])];
    const workflow = {
      id: 'conflict',
      project: h.project,
      baseSHA: a.baseSHA,
      context,
      assessment,
      taskIds: [],
      sharedFiles: [],
      mode: 'serial' as const,
      reason: 'fixture',
      status: 'integrating' as const,
    };
    await expect(
      h.manager.integrate(workflow, results, h.checks, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'integration_conflict' });
    expect(existsSync(join(h.dir, 'evidence', 'conflict', `0-${a.id}.patch`))).toBe(true);
    expect(existsSync(join(h.dir, 'evidence', 'conflict', `1-${b.id}.patch`))).toBe(true);
    expect(readFileSync(join(h.project, 'a.mjs'), 'utf8')).toContain('=0');
  });
  it('integrates additions and deletions, and detects changed sealed results', async () => {
    const h = fixture(),
      a = await h.manager.prepare(h.project, 'files', 'a'),
      b = await h.manager.prepare(h.project, 'files', 'b');
    writeFileSync(join(a.path, 'added.mjs'), 'export const value=7;\n');
    unlinkSync(join(b.path, 'b.mjs'));
    const results = [h.manager.seal(a, ['added.mjs']), h.manager.seal(b, ['b.mjs'])];
    const checks = new LocalChecks(
      {
        joint: {
          executable: process.execPath,
          args: [
            '--input-type=module',
            '-e',
            "import {value} from './added.mjs';import {existsSync} from 'node:fs';if(value!==7||existsSync('b.mjs'))process.exit(1)",
          ],
          acceptance: true,
          timeoutMs: 5000,
        },
      },
      join(h.dir, 'joint-logs'),
      h.project,
    );
    const workflow = {
      id: 'files',
      project: h.project,
      baseSHA: a.baseSHA,
      context: { ...context, checks: ['joint'] },
      assessment,
      taskIds: [],
      sharedFiles: [],
      mode: 'serial' as const,
      reason: 'fixture',
      status: 'integrating' as const,
    };
    const target = await h.manager.integrate(
      workflow,
      results,
      checks,
      new AbortController().signal,
    );
    expect(() => h.manager.verifyIntegrated(workflow)).not.toThrow();
    writeFileSync(join(h.project, 'external.txt'), 'external change');
    expect(() => h.manager.verifyIntegrated(workflow)).toThrow();
    unlinkSync(join(h.project, 'external.txt'));
    expect(existsSync(join(target.path, 'b.mjs'))).toBe(false);
    expect(existsSync(join(target.path, 'added.mjs'))).toBe(true);
    writeFileSync(join(a.path, 'added.mjs'), 'changed');
    await expect(
      h.manager.integrate(workflow, results, checks, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'workspace_result_stale' });
  });
  it('blocks dirty sources, changed bases and unowned local-check paths', async () => {
    const h = fixture();
    writeFileSync(join(h.project, 'new.txt'), 'user change');
    await expect(h.manager.prepare(h.project, 'dirty', 'a')).rejects.toMatchObject({
      code: 'ao_dirty_project',
    });
    expect(readFileSync(join(h.project, 'new.txt'), 'utf8')).toBe('user change');
    unlinkSync(join(h.project, 'new.txt'));
    await expect(h.manager.prepare(h.project, 'base', 'a', '0'.repeat(40))).rejects.toMatchObject({
      code: 'workspace_changed_base',
    });
    await expect(h.checks.run(['a'], h.dir, new AbortController().signal)).rejects.toThrow();
  });
  it('runs two distinct developers together and accepts only the third, integrated workspace', async () => {
    const h = fixture();
    await prepare(h);
    await h.team.start();
    await finish(h);
    const state = h.team.snapshot(),
      w = state.workflows![0];
    expect(w.status).toBe('accepted');
    expect(h.peak()).toBe(2);
    expect(state.runsUsed).toBe(2);
    expect(new Set(state.tasks.map((t) => t.workerId)).size).toBe(2);
    expect(new Set(h.calls.map((c) => c.executionSessionKey)).size).toBe(2);
    expect(new Set([...state.tasks.map((t) => t.executionProject), w.candidateProject]).size).toBe(
      3,
    );
    expect(w.localChecks?.every((c) => c.passed)).toBe(true);
    expect(readFileSync(join(h.project, 'a.mjs'), 'utf8')).toContain('=0');
    expect(readFileSync(join(w.candidateProject!, 'b.mjs'), 'utf8')).toContain('=2');
    expect(state.tokensUsed).toBe(220);
    expect(state.usageKnown).toBe(true);
  });
  it('rejects combined defects even when each part passed, retaining all results', async () => {
    const h = fixture({ jointFails: true });
    await prepare(h);
    await h.team.start();
    await finish(h);
    const s = h.team.snapshot();
    expect(s.tasks.every((t) => t.localChecks?.every((c) => c.passed))).toBe(true);
    expect(s.workflows![0].status).toBe('paused');
    expect(s.budgetReason).toBe('integration_checks_failed');
    expect(s.workflows![0].candidateProject).toBeTruthy();
    expect(h.calls).toHaveLength(2);
    expect(() => h.team.resume()).toThrow();
  });
  it('requires integration estimates before dispatching any model', async () => {
    const h = fixture();
    await prepare(h, false);
    await expect(h.team.start()).rejects.toMatchObject({ code: 'workflow_budget_review_required' });
    expect(h.calls).toHaveLength(0);
  });
  it('preserves unknown aggregate usage and cancels the workflow without retry', async () => {
    const h = fixture({ unknown: true });
    await prepare(h);
    await h.team.start();
    await finish(h);
    await h.team.shutdown();
    expect(h.team.snapshot().usageKnown).toBe(false);
    expect(h.team.snapshot().workflows![0].status).toBe('paused');
    expect(h.calls.length).toBeLessThanOrEqual(2);
  });
  it('rejects files outside ownership', async () => {
    const h = fixture({ scopeViolation: true });
    await prepare(h);
    await h.team.start();
    await finish(h);
    expect(h.team.snapshot().workflows![0].status).toBe('paused');
    expect(h.team.snapshot().budgetReason).toBe('workspace_scope_changed');
  });
  it('restores checkpoints paused without recreating workspace capabilities or resetting usage', async () => {
    const h = fixture();
    await prepare(h);
    await h.team.start();
    await finish(h);
    const restored = new TeamCoordinator(
      { codex: h.executor, claude: h.executor },
      undefined,
      undefined,
      h.checks,
      undefined,
      h.checkpoint,
      h.runtime,
    );
    expect(restored.snapshot().tokensUsed).toBe(220);
    expect(restored.snapshot().workflows![0].status).toBe('paused');
    expect(restored.snapshot().workflows![0].reasonCode).toBe('workflow_recovery_required');
    expect(restored.snapshot().running).toBe(false);
    expect(restored.snapshot().tasks.map((t) => t.choice)).toEqual(
      h.team.snapshot().tasks.map((t) => t.choice),
    );
    const raw = JSON.parse(readFileSync(h.checkpoint, 'utf8'));
    raw.tasks[0].status = 'running';
    raw.workflows[0].status = 'working';
    writeFileSync(h.checkpoint, JSON.stringify(raw));
    const interrupted = new TeamCoordinator(
      { codex: h.executor, claude: h.executor },
      undefined,
      undefined,
      h.checks,
      undefined,
      h.checkpoint,
      h.runtime,
    );
    expect(interrupted.snapshot().workflows![0].status).toBe('paused');
    expect(interrupted.snapshot().usageKnown).toBe(false);
    expect(interrupted.snapshot().runsUsed).toBe(2);
    await expect(interrupted.start()).rejects.toMatchObject({ code: 'workflow_recovery_required' });
  });
  it.each(['modified', 'deleted'] as const)(
    'does not restore acceptance of a %s integrated worktree',
    async (change) => {
      const h = fixture();
      await prepare(h);
      await h.team.start();
      await finish(h);
      const before = h.team.snapshot();
      const candidate = before.workflows![0];
      expect(candidate.status).toBe('accepted');
      if (change === 'modified')
        writeFileSync(join(candidate.candidateProject!, 'a.mjs'), 'export const a=999;\n');
      else rmSync(candidate.candidateProject!, { recursive: true });

      // A process restart loses the manager's in-memory workspace capabilities.
      // Checkpoint paths and past hashes must never recreate that authority.
      const create = vi.fn(async () => {
        throw new Error('Recovery must not create or execute anything');
      });
      const freshManager = new WorkflowWorkspaceManager(
        join(h.dir, 'spaces'),
        join(h.dir, 'evidence'),
        create,
      );
      const freshExecutor = { ...h.executor, workspaceManager: freshManager };
      const restored = new TeamCoordinator(
        { codex: freshExecutor, claude: freshExecutor },
        undefined,
        undefined,
        h.checks,
        undefined,
        h.checkpoint,
        h.runtime,
      );
      const state = restored.snapshot();
      expect(state.workflows![0]).toMatchObject({
        ...candidate,
        budgetReview: undefined,
        status: 'paused',
        reasonCode: 'workflow_recovery_required',
      });
      expect(state.tokensUsed).toBe(before.tokensUsed);
      expect(state.runsUsed).toBe(before.runsUsed);
      expect(state.timeUsedMs).toBe(before.timeUsedMs);
      expect(state.usageKnown).toBe(before.usageKnown);
      expect(state.tasks).toHaveLength(before.tasks.length);
      expect(state.running).toBe(false);
      expect(() => restored.resume()).toThrow();
      await expect(restored.start()).rejects.toMatchObject({ code: 'workflow_recovery_required' });
      expect(create).not.toHaveBeenCalled();
      expect(h.calls).toHaveLength(2);
      const persisted = JSON.parse(readFileSync(h.checkpoint, 'utf8'));
      expect(persisted.workflows[0].status).toBe('paused');
      expect(persisted.workflows[0].candidateHash).toBe(candidate.candidateHash);
      if (change === 'modified')
        expect(readFileSync(join(candidate.candidateProject!, 'a.mjs'), 'utf8')).toContain('999');
      else expect(existsSync(candidate.candidateProject!)).toBe(false);
    },
  );
  it('serializes without a predicted benefit and rejects altered decisions', () => {
    const base = {
      isolated: true,
      maxParallel: 2,
      overlap: false,
      risky: false,
      workersMs: [30, 20],
      preparationMs: 10,
      integrationMs: 10,
      sequentialMs: 100,
    };
    expect(chooseWorkflowSchedule(base).mode).toBe('parallel');
    expect(ownershipOverlaps('module/A.ts', 'module/a.ts')).toBe(true);
    expect(ownershipOverlaps('module', 'module/a.ts')).toBe(true);
    expect(ownershipOverlaps('module/a.ts', 'module/b.ts')).toBe(false);
    for (const delta of [
      { overlap: true },
      { risky: true },
      { isolated: false },
      { integrationMs: null },
      { sequentialMs: 40 },
      { maxParallel: 1 },
    ])
      expect(chooseWorkflowSchedule({ ...base, ...delta }).mode).toBe('serial');
    expect(() =>
      validateDecomposition({ ...decomposition, sharedFiles: ['a.mjs'] }, context),
    ).toThrow();
    const h = fixture();
    const parts = structuredClone(decomposition.parts);
    parts[1].dependsOn = [0];
    const tasks = h.team.addScopedWorkflow(
      h.project,
      context,
      { ...assessment, acceptanceCoverage: 'complete' },
      true,
      { parts, sharedFiles: [] },
    );
    expect(tasks.filter((t) => t.role === 'developer')).toHaveLength(1);
    expect(h.team.snapshot().workflows).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
  });
  it('grants two global owned writer slots and excludes a third, ordinary writers and forged handles', async () => {
    const h = fixture();
    const a = await h.manager.prepare(h.project, 'flow', 'a'),
      b = await h.manager.prepare(h.project, 'flow', 'b'),
      c = await h.manager.prepare(h.project, 'flow', 'c');
    const locks = join(h.dir, 'leases');
    const releaseA = acquireCodexLease(locks, 'a', false, a),
      releaseB = acquireCodexLease(locks, 'b', false, b);
    try {
      expect(() => acquireCodexLease(locks, 'c', false, c)).toThrow();
      expect(() => acquireCodexLease(locks, 'ordinary', false)).toThrow();
      expect(() => acquireCodexLease(locks, 'reader', true)).toThrow();
      expect(() => acquireCodexLease(join(h.dir, 'forged'), 'forged', false, { ...a })).toThrow();
    } finally {
      releaseA();
      releaseB();
    }
    const abandoned = join(h.dir, 'abandoned');
    mkdirSync(abandoned);
    writeFileSync(
      join(abandoned, 'executor-write-0.lock'),
      JSON.stringify({
        pid: process.pid,
        mode: 'isolated-write',
        workflowId: 'flow',
        workspaceId: 'other',
        project: h.project,
        runId: 'lost',
      }),
    );
    expect(() => acquireCodexLease(abandoned, 'new', false, a)).toThrow();
  });
});
