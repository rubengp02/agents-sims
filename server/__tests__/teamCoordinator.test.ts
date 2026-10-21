import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CheckRunner } from '../src/execution/localChecks.js';
import { TeamCoordinator } from '../src/execution/teamCoordinator.js';
import {
  chooseModel,
  DEFAULT_TEAM_SETTINGS,
  validateSettings,
} from '../src/execution/teamPolicy.js';
import {
  type ExecuteOptions,
  ExecutionBlocked,
  type OfficialExecutor,
  type RunRecord,
  type SubscriptionEvidence,
} from '../src/execution/types.js';

const roots: string[] = [];
afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

function evidence(): SubscriptionEvidence {
  return {
    checkedAt: Date.now(),
    plan: 'pro',
    quota: [{ id: 'included', usedPercent: 10, resetsAt: 4e9 }],
    models: [
      { id: 'gpt-6-luna', efforts: ['low'] },
      { id: 'gpt-6.1-sol', efforts: ['low', 'medium', 'high'] },
      { id: 'gpt-6-astra', efforts: ['high'] },
      { id: 'claude-fixture', efforts: ['low'] },
    ],
  };
}

function harness(
  options: {
    output?: string;
    status?: RunRecord['status'];
    reason?: string;
    hang?: boolean;
    unknownUsage?: boolean;
    manualCompletion?: boolean;
    inputTokens?: number;
    concurrentReaders?: 1 | 2;
    outcome?: 'completed' | 'blocked' | 'failed' | 'missing';
    checks?: CheckRunner;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'pixel-team-'));
  roots.push(root);
  const calls: ExecuteOptions[] = [];
  const completions: Array<() => void> = [];
  const makeExecutor = (provider: 'codex' | 'claude'): OfficialExecutor => ({
    provider,
    maxConcurrentReadOnly: provider === 'codex' ? (options.concurrentReaders ?? 1) : 1,
    diagnose: vi.fn(async () => evidence()),
    execute: vi.fn(async (input) => {
      calls.push(input);
      const record: RunRecord = {
        version: 1,
        id: `run-${calls.length}`,
        provider,
        billing: 'subscription-only',
        status: 'running',
        project: input.project,
        requestedModel: input.model!,
        requestedEffort: input.effort!,
        confirmedModel: null,
        sessionId: `session-${calls.length}`,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        reasonCode: null,
        inputTokens: options.unknownUsage ? null : (options.inputTokens ?? 20),
        outputTokens: options.unknownUsage ? null : 4,
      };
      input.onState?.(record);
      input.onActivity?.('reading');
      if (options.manualCompletion)
        await new Promise<void>((resolve) => {
          completions.push(resolve);
          input.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
      if (options.hang)
        await new Promise<void>((resolve) => {
          if (input.signal?.aborted) resolve();
          else input.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
      input.onOutput?.(options.output ?? 'RESULTADO DE PRUEBA');
      if (!input.prompt.includes('Divide el objetivo') && options.outcome !== 'missing')
        input.onOutput?.(
          `\nOFFICE_RESULT ${JSON.stringify({ status: options.outcome ?? 'completed' })}`,
        );
      record.status = input.signal?.aborted ? 'cancelled' : (options.status ?? 'completed');
      record.reasonCode = options.reason ?? null;
      input.onState?.(record);
      return record;
    }),
  });
  const codex = makeExecutor('codex'),
    claude = makeExecutor('claude');
  const team = new TeamCoordinator(
    { codex, claude },
    join(root, 'settings.json'),
    undefined,
    options.checks,
  );
  const add = (extra: Partial<Parameters<TeamCoordinator['addTask']>[0]> = {}) =>
    team.addTask({
      role: 'developer',
      title: 'Tarea de prueba',
      prompt: 'Implementa una función pequeña',
      project: root,
      ...extra,
    });
  return { root, team, calls, codex, claude, add, finish: (index: number) => completions[index]() };
}

async function done(team: TeamCoordinator) {
  await vi.waitFor(() => {
    const state = team.snapshot();
    expect(state.running).toBe(false);
    expect(state.tasks.some((task) => ['checking', 'running'].includes(task.status))).toBe(false);
  });
}

describe('bounded routing', () => {
  it.each([
    ['Lista tres elementos', 'gpt-6-luna', 'low'],
    ['Implementa un endpoint', 'gpt-6.1-sol', 'low'],
    ['Revisa seguridad y concurrencia', 'gpt-6.1-sol', 'high'],
  ])('chooses from the available efficient set for %s', (prompt, model, effort) => {
    expect(chooseModel({ prompt, role: 'developer', override: null }, evidence()).choice).toEqual({
      provider: 'codex',
      model,
      effort,
    });
  });
  it('never expands auto selection to Astra or deprecated models', () => {
    expect(() =>
      chooseModel(
        { prompt: 'Implementa', role: 'developer', override: null },
        { ...evidence(), models: [{ id: 'gpt-6-astra', efforts: ['low'] }] },
      ),
    ).toThrow(ExecutionBlocked);
  });
  it('allows an explicit available override but rejects unsupported effort', () => {
    const task = {
      prompt: 'Lista',
      role: 'tester' as const,
      override: { provider: 'codex' as const, model: 'gpt-6-astra', effort: 'high' },
    };
    expect(chooseModel(task, evidence()).choice.model).toBe('gpt-6-astra');
    expect(() =>
      chooseModel({ ...task, override: { ...task.override, effort: 'ultra' } }, evidence()),
    ).toThrow();
  });
});

describe('local team with subscription adapters (offline fixtures)', () => {
  it('does not mistake lint for acceptance or allow writes on an explanation', () => {
    const h = harness({
      checks: { has: () => true, hasAcceptance: () => false, run: async () => [] },
    });
    const packet = {
      objective: 'Corrige la función',
      files: [],
      decisions: [],
      acceptance: ['Correcta'],
      checks: ['lint'],
    };
    const assessment = {
      scope: 'bounded' as const,
      risk: 'low' as const,
      uncertainty: 'low' as const,
      modules: ['math'],
      tests: 'available' as const,
    };
    expect(() => h.team.addScopedWorkflow(h.root, packet, assessment, true)).toThrow();
    expect(() =>
      h.team.addScopedWorkflow(h.root, packet, { ...assessment, scope: 'explanation' }, true),
    ).toThrow();
    expect(h.team.snapshot().tasks).toHaveLength(0);
  });
  it.each(['pause', 'cancel'] as const)(
    'waits for local acceptance and respects %s during it',
    async (action) => {
      let release!: () => void;
      const run = vi.fn(async (_ids: string[], _project: string, signal: AbortSignal) => {
        await new Promise<void>((resolve) => {
          release = resolve;
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
        return [{ id: 'unit', exitCode: 0, durationMs: 1, passed: !signal.aborted }];
      });
      const h = harness({
        checks: { has: () => true, hasAcceptance: () => true, run },
        concurrentReaders: 2,
      });
      const first = h.add({
        context: {
          objective: 'Revisa',
          files: [],
          decisions: [],
          acceptance: ['Correcta'],
          checks: ['unit'],
        },
        parallelSafe: true,
      });
      h.add({ role: 'tester', dependsOn: [first.id], parallelSafe: true });
      await h.team.start();
      await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
      expect(h.calls).toHaveLength(1);
      expect(h.team.snapshot().tasks[0].status).toBe('running');
      if (action === 'pause') h.team.pause();
      else h.team.cancel(first.id);
      release();
      await done(h.team);
      expect(h.team.snapshot().tasks[0].status).toBe(action === 'pause' ? 'paused' : 'cancelled');
      expect(h.calls).toHaveLength(1);
    },
  );
  it('requires configured mechanical acceptance before removing QA', () => {
    const h = harness();
    expect(() =>
      h.team.addScopedWorkflow(
        h.root,
        {
          objective: 'Arregla la función',
          files: [],
          decisions: [],
          acceptance: ['Correcta'],
          checks: ['unit'],
        },
        {
          scope: 'bounded',
          risk: 'low',
          uncertainty: 'low',
          modules: ['math'],
          tests: 'available',
        },
        true,
      ),
    ).toThrow();
    expect(h.team.snapshot().tasks).toHaveLength(0);
  });
  it('runs local acceptance directly and blocks dependents when it fails', async () => {
    const run = vi.fn(async () => [{ id: 'unit', exitCode: 1, durationMs: 2, passed: false }]);
    const h = harness({
      checks: { has: (id) => id === 'unit', hasAcceptance: (ids) => ids.includes('unit'), run },
    });
    const tasks = h.team.addScopedWorkflow(
      h.root,
      {
        objective: 'Arregla la función',
        files: ['math.ts'],
        decisions: [],
        acceptance: ['Correcta'],
        checks: ['unit'],
      },
      { scope: 'bounded', risk: 'low', uncertainty: 'low', modules: ['math'], tests: 'available' },
      true,
    );
    expect(tasks.map((task) => task.role)).toEqual(['developer']);
    h.add({ role: 'tester', dependsOn: [tasks[0].id] });
    await h.team.start();
    await done(h.team);
    expect(h.calls).toHaveLength(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(h.calls[0].prompt).toContain('"acceptance":["Correcta"]');
    expect(h.team.snapshot().tasks[0].status).toBe('blocked');
    expect(h.team.snapshot().budgetReason).toBe('local_checks_failed');
  });
  it('completes the bounded circuit only after local acceptance passes', async () => {
    const h = harness({
      checks: {
        has: () => true,
        hasAcceptance: (ids) => ids.includes('unit'),
        run: async () => [{ id: 'unit', exitCode: 0, durationMs: 2, passed: true }],
      },
    });
    h.team.addScopedWorkflow(
      h.root,
      {
        objective: 'Arregla',
        files: [],
        decisions: [],
        acceptance: ['Correcta'],
        checks: ['unit'],
      },
      { scope: 'bounded', risk: 'low', uncertainty: 'low', modules: ['math'], tests: 'available' },
      true,
    );
    await h.team.start();
    await done(h.team);
    expect(h.team.snapshot().tasks[0].status).toBe('completed');
    expect(h.team.snapshot().tasks[0].localChecks?.[0].passed).toBe(true);
  });
  it.each(['blocked', 'failed', 'missing'] as const)(
    'does not run dependent QA after a successful CLI turn with task outcome %s',
    async (outcome) => {
      const h = harness({ outcome });
      const first = h.add({ allowWrites: true });
      h.add({ role: 'tester', dependsOn: [first.id] });
      await h.team.start();
      await done(h.team);
      const state = h.team.snapshot();
      expect(h.calls).toHaveLength(1);
      expect(state.tasks[0].status).toBe(outcome === 'failed' ? 'failed' : 'blocked');
      expect(state.tasks[0].reasonCode).toBe(
        outcome === 'missing' ? 'task_result_unverified' : `task_reported_${outcome}`,
      );
      expect(state.tasks[1].status).toBe('paused');
      expect(state.budgetReason).toBe(state.tasks[0].reasonCode);
      expect(state.tokensUsed).toBe(24);
    },
  );
  it('finishes cleanly when the last task uses the final permitted call', async () => {
    const h = harness();
    h.team.configure({ ...DEFAULT_TEAM_SETTINGS, maxRuns: 1 });
    h.add();
    await h.team.start();
    await done(h.team);
    expect(h.team.snapshot().tasks[0].status).toBe('completed');
    expect(h.team.snapshot().budgetReason).toBeNull();
  });
  it('defaults to auto and keeps Claude off; settings persist without prompts/results', () => {
    const h = harness();
    h.add({ prompt: 'PRIVATE TASK' });
    expect(h.team.snapshot().settings).toEqual(DEFAULT_TEAM_SETTINGS);
    expect(h.team.snapshot().settings.experimentalParallelWriters).toBe(false);
    h.team.configure({ ...DEFAULT_TEAM_SETTINGS, maxRuns: 3 });
    const saved = readFileSync(join(h.root, 'settings.json'), 'utf8');
    expect(saved).not.toContain('PRIVATE TASK');
    expect(saved).not.toContain('RESULTADO');
    expect(
      new TeamCoordinator(
        { codex: h.codex, claude: h.claude },
        join(h.root, 'settings.json'),
      ).snapshot().settings.maxRuns,
    ).toBe(3);
  });
  it('requires a boolean experimental opt-in, separately from the two global slots', () => {
    expect(
      validateSettings({ ...DEFAULT_TEAM_SETTINGS, experimentalParallelWriters: true })
        .experimentalParallelWriters,
    ).toBe(true);
    expect(() =>
      validateSettings({
        ...DEFAULT_TEAM_SETTINGS,
        experimentalParallelWriters: 'true' as unknown as boolean,
      }),
    ).toThrow();
    expect(DEFAULT_TEAM_SETTINGS.maxParallel).toBe(2);
  });
  it('runs dependencies in order through real adapter contract, with bounded handoff', async () => {
    const h = harness({ output: 'x'.repeat(22000) });
    const first = h.add();
    h.add({ role: 'tester', dependsOn: [first.id] });
    await h.team.start();
    await done(h.team);
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1].prompt).toContain('Resultados anteriores');
    expect(h.calls[1].prompt.length).toBeLessThan(5000);
    expect(h.team.snapshot().tasks.every((task) => task.status === 'completed')).toBe(true);
    expect(h.team.snapshot().tokensUsed).toBe(48);
  });
  it('supports both providers in one queue without implicit provider switching', async () => {
    const h = harness();
    h.team.configure({ ...DEFAULT_TEAM_SETTINGS, claudeEnabled: true });
    const first = h.add(),
      second = h.add({ role: 'tester', dependsOn: [first.id] });
    h.team.override(second.id, { provider: 'claude', model: 'claude-fixture', effort: 'low' });
    await h.team.start();
    await done(h.team);
    expect(h.codex.execute).toHaveBeenCalledTimes(1);
    expect(h.claude.execute).toHaveBeenCalledTimes(1);
    expect(h.calls.map((call) => call.model)).toEqual(['gpt-6.1-sol', 'claude-fixture']);
  });
  it('requires a manual choice in manual mode', async () => {
    const h = harness();
    const task = h.add();
    h.team.configure({ ...DEFAULT_TEAM_SETTINGS, mode: 'manual' });
    await h.team.start();
    await done(h.team);
    expect(h.calls).toHaveLength(0);
    expect(h.team.snapshot().tasks[0].reasonCode).toBe('manual_choice_required');
    h.team.override(task.id, { provider: 'codex', model: 'gpt-6-luna', effort: 'low' });
    await h.team.assign(task.id);
    h.team.approve(task.id);
    await h.team.start();
    await done(h.team);
    expect(h.calls).toHaveLength(1);
  });
  it('mixed mode waits for explicit approval and invalidates it on override', async () => {
    const h = harness();
    h.team.configure({ ...DEFAULT_TEAM_SETTINGS, mode: 'mixed' });
    const task = h.add();
    await h.team.start();
    await done(h.team);
    expect(h.calls).toHaveLength(0);
    h.team.approve(task.id);
    h.team.override(task.id, { provider: 'codex', model: 'gpt-6-luna', effort: 'low' });
    expect(h.team.snapshot().tasks[0].approved).toBe(false);
    await h.team.assign(task.id);
    h.team.approve(task.id);
    await h.team.start();
    await done(h.team);
    expect(h.calls[0].model).toBe('gpt-6-luna');
  });
  it('does not diagnose or run disabled Claude tasks', async () => {
    const h = harness();
    const task = h.add();
    h.team.override(task.id, { provider: 'claude', model: 'claude-fixture', effort: 'low' });
    await h.team.start();
    await done(h.team);
    expect(h.claude.diagnose).not.toHaveBeenCalled();
    expect(h.claude.execute).not.toHaveBeenCalled();
    expect(h.codex.execute).not.toHaveBeenCalled();
  });
  it('never runs before subscription verification and never falls back after a quota error', async () => {
    const h = harness();
    h.add();
    vi.mocked(h.codex.diagnose).mockRejectedValue(
      new ExecutionBlocked('quota_reserve', 'En pausa'),
    );
    await h.team.start();
    await done(h.team);
    expect(h.calls).toHaveLength(0);
    expect(h.claude.execute).not.toHaveBeenCalled();
    expect(h.team.snapshot().tasks[0].reasonCode).toBe('quota_reserve');
  });
  it('honours the last permitted run and leaves subsequent dependencies paused', async () => {
    const h = harness();
    h.team.configure({ ...DEFAULT_TEAM_SETTINGS, maxRuns: 1 });
    const task = h.add();
    h.add({ dependsOn: [task.id] });
    await h.team.start();
    await done(h.team);
    expect(h.calls).toHaveLength(1);
    expect(h.team.snapshot().tasks[0].status).toBe('completed');
    expect(h.team.snapshot().tasks[1].status).toBe('paused');
    expect(h.team.snapshot().budgetReason).toBe('run_budget');
  });
  it('blocks duplicate starts and pauses/cancels the owned running process', async () => {
    const h = harness({ hang: true });
    const task = h.add();
    await h.team.start();
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));
    await expect(h.team.start()).rejects.toMatchObject({ code: 'team_busy' });
    expect(() => h.team.override(task.id, null)).toThrow();
    h.team.pause();
    await done(h.team);
    expect(h.team.snapshot().tasks[0].status).toBe('paused');
    h.team.resume();
    expect(h.team.snapshot().tasks[0].status).toBe('planned');
    expect(h.calls).toHaveLength(1);
  });
  it('stops the queue when usage becomes unknown', async () => {
    const h = harness({ unknownUsage: true });
    const task = h.add();
    h.add({ dependsOn: [task.id] });
    await h.team.start();
    await done(h.team);
    expect(h.calls).toHaveLength(1);
    expect(h.team.snapshot().budgetReason).toBe('usage_unknown');
  });
  it('keeps a failed dependency from running its downstream task', async () => {
    const h = harness({ status: 'paused', reason: 'provider_limit' });
    const first = h.add();
    h.add({ dependsOn: [first.id] });
    await h.team.start();
    await done(h.team);
    expect(h.calls).toHaveLength(1);
    expect(h.team.snapshot().budgetReason).toBe('provider_limit');
  });
  it('validates dependency graph, project paths and limits before work', () => {
    const h = harness();
    expect(() => h.add({ dependsOn: ['missing'] })).toThrow();
    expect(() => h.add({ project: join(h.root, 'missing') })).toThrow();
    expect(() => h.team.configure({ ...DEFAULT_TEAM_SETTINGS, maxParallel: 99 })).toThrow();
    expect(() =>
      h.team.override(h.add().id, {
        provider: 'antigravity' as 'codex',
        model: 'x',
        effort: 'low',
      }),
    ).toThrow();
    expect(h.calls).toHaveLength(0);
  });
  it('uses one planning call, validates the plan and creates read-only tasks for review', async () => {
    const h = harness({
      output: JSON.stringify({
        tasks: [
          { role: 'developer', title: 'Implementar', prompt: 'Añade una función', dependsOn: [] },
          { role: 'tester', title: 'Verificar', prompt: 'Comprueba la función', dependsOn: [0] },
        ],
      }),
    });
    await h.team.plan(h.root, 'Objetivo privado', true);
    const tasks = h.team.snapshot().tasks;
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].allowWrites).toBe(false);
    expect(h.calls[0].effort).toBe('low');
    expect(tasks).toHaveLength(3);
    expect(tasks[1].allowWrites).toBe(true);
    expect(tasks[2].allowWrites).toBe(false);
    expect(tasks[2].dependsOn).toEqual([tasks[1].id]);
    expect(tasks[1].status).toBe('planned');
  });
  it('does not let an AI planner enable multiple programmers in default mode', async () => {
    const h = harness({
      output: JSON.stringify({
        experimentalParallelWriters: true,
        tasks: [0, 1].map((i) => ({
          role: 'developer',
          title: 'Parte ' + i,
          prompt: 'Implementa ' + i,
          dependsOn: [],
        })),
      }),
    });
    await expect(h.team.plan(h.root, 'Implementa el encargo', true)).rejects.toMatchObject({
      code: 'experimental_parallel_writers_disabled',
    });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].allowWrites).toBe(false);
    expect(h.team.snapshot().settings.experimentalParallelWriters).toBe(false);
    expect(h.team.snapshot().tasks.filter((t) => t.role === 'developer')).toHaveLength(0);
  });
  it.each([
    'not JSON',
    '{"tasks":[{"role":"tester","title":"x","prompt":"x","dependsOn":[0]}]}',
    '{"tasks":[{"role":"unknown","title":"x","prompt":"x","dependsOn":[]}]}',
  ])('rejects invalid model plans atomically: %s', async (output) => {
    const h = harness({ output });
    await expect(h.team.plan(h.root, 'Revisar proyecto')).rejects.toMatchObject({
      code: 'invalid_plan',
    });
    expect(h.team.snapshot().tasks).toHaveLength(1);
    expect(h.calls).toHaveLength(1);
  });
  it('never returns mutable internal state to callers', () => {
    const h = harness();
    h.add();
    const snapshot = h.team.snapshot();
    snapshot.tasks[0].status = 'completed';
    snapshot.settings.claudeEnabled = true;
    expect(h.team.snapshot().tasks[0].status).toBe('planned');
    expect(h.team.snapshot().settings.claudeEnabled).toBe(false);
  });
  it('reserves the last call before concurrent provider checks can overspend it', async () => {
    const h = harness();
    h.team.configure({ ...DEFAULT_TEAM_SETTINGS, maxRuns: 1, claudeEnabled: true });
    h.add();
    const task = h.add({ role: 'tester' });
    h.team.override(task.id, { provider: 'claude', model: 'claude-fixture', effort: 'low' });
    await h.team.start();
    await done(h.team);
    expect(h.calls).toHaveLength(1);
    expect(h.claude.execute).not.toHaveBeenCalled();
  });
  it('a pause while assignment is checking cannot subsequently start a task', async () => {
    const h = harness();
    h.add();
    let release!: (value: SubscriptionEvidence) => void;
    vi.mocked(h.codex.diagnose).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const start = h.team.start();
    h.team.pause();
    release(evidence());
    await start;
    expect(h.calls).toHaveLength(0);
    expect(h.team.snapshot().running).toBe(false);
  });
  it('cancelling an assignment during its diagnostic does not resurrect the task', async () => {
    const h = harness();
    const task = h.add();
    let release!: (value: SubscriptionEvidence) => void;
    vi.mocked(h.codex.diagnose).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const assignment = h.team.assign(task.id);
    h.team.cancel(task.id);
    release(evidence());
    await assignment;
    expect(h.team.snapshot().tasks[0].status).toBe('cancelled');
    expect(h.calls).toHaveLength(0);
  });
  it('closing the server waits for the running owned task to stop', async () => {
    const h = harness({ hang: true });
    h.add();
    await h.team.start();
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));
    await h.team.shutdown();
    expect(h.team.snapshot().tasks[0].status).toBe('paused');
    expect(h.team.snapshot().budgetReason).toBe('server_stopped');
  });
  it('a changed model catalogue blocks execution even after an assignment was approved', async () => {
    const h = harness();
    h.team.configure({ ...DEFAULT_TEAM_SETTINGS, mode: 'mixed' });
    const task = h.add();
    await h.team.assign(task.id);
    h.team.approve(task.id);
    vi.mocked(h.codex.diagnose).mockResolvedValue({ ...evidence(), models: [] });
    await h.team.start();
    await done(h.team);
    expect(h.calls).toHaveLength(0);
    expect(h.team.snapshot().budgetReason).toBe('choice_unavailable');
  });
  it('runs independent analyses together, then development, then QA', async () => {
    const h = harness({ manualCompletion: true, concurrentReaders: 2 });
    const architect = h.add({ role: 'architect', parallelSafe: true });
    const designer = h.add({ role: 'designer', parallelSafe: true });
    const developer = h.add({
      role: 'developer',
      allowWrites: true,
      dependsOn: [architect.id, designer.id],
    });
    h.add({ role: 'tester', parallelSafe: true, dependsOn: [developer.id] });
    await h.team.start();
    await vi.waitFor(() => expect(h.calls).toHaveLength(2));
    expect(h.calls.every((call) => call.parallelReadOnly && !call.allowWrites)).toBe(true);
    expect(h.team.snapshot().tasks.filter((task) => task.status === 'running')).toHaveLength(2);
    expect(h.team.snapshot().tasks[2].scheduleReason).toContain('Espera a:');
    h.finish(0);
    await vi.waitFor(() => expect(h.team.snapshot().tasks[0].status).toBe('completed'));
    expect(h.calls).toHaveLength(2);
    h.finish(1);
    await vi.waitFor(() => expect(h.calls).toHaveLength(3));
    expect(h.calls[2].allowWrites).toBe(true);
    expect(h.calls[2].parallelReadOnly).toBe(false);
    expect(h.team.snapshot().tasks[3].status).toBe('queued');
    h.finish(2);
    await vi.waitFor(() => expect(h.calls).toHaveLength(4));
    h.finish(3);
    await done(h.team);
    expect(h.team.snapshot().tasks.every((task) => task.status === 'completed')).toBe(true);
  });
  it('serializes read-only tasks unless independence was explicitly established', async () => {
    const h = harness({ manualCompletion: true, concurrentReaders: 2 });
    h.add({ role: 'architect' });
    h.add({ role: 'designer', parallelSafe: true });
    await h.team.start();
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));
    expect(h.team.snapshot().tasks[1].scheduleReason).toContain(
      'no se ha confirmado independencia',
    );
    h.finish(0);
    await vi.waitFor(() => expect(h.calls).toHaveLength(2));
    h.finish(1);
    await done(h.team);
  });
  it('respects a declared dependency even if both tasks are marked parallel-safe', async () => {
    const h = harness({ manualCompletion: true, concurrentReaders: 2 });
    const first = h.add({ role: 'architect', parallelSafe: true });
    h.add({ role: 'designer', parallelSafe: true, dependsOn: [first.id] });
    await h.team.start();
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));
    expect(h.team.snapshot().tasks[1].status).toBe('queued');
    h.finish(0);
    await vi.waitFor(() => expect(h.calls).toHaveLength(2));
    h.finish(1);
    await done(h.team);
  });
  it('never shares write permissions even if a task was declared independent', async () => {
    const h = harness({ manualCompletion: true, concurrentReaders: 2 });
    h.add({ role: 'developer', allowWrites: true, parallelSafe: true });
    h.add({ role: 'designer', parallelSafe: true });
    await h.team.start();
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));
    expect(h.team.snapshot().tasks[0].parallelSafe).toBe(false);
    expect(h.calls[0].parallelReadOnly).toBe(false);
    h.finish(0);
    await vi.waitFor(() => expect(h.calls).toHaveLength(2));
    h.finish(1);
    await done(h.team);
  });
  it('keeps the operator limit of one even when two safe reader slots exist', async () => {
    const h = harness({ manualCompletion: true, concurrentReaders: 2 });
    h.team.configure({ ...DEFAULT_TEAM_SETTINGS, maxParallel: 1 });
    h.add({ role: 'architect', parallelSafe: true });
    h.add({ role: 'designer', parallelSafe: true });
    await h.team.start();
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));
    h.finish(0);
    await vi.waitFor(() => expect(h.calls).toHaveLength(2));
    h.finish(1);
    await done(h.team);
  });
  it('reserves observed input for running readers instead of spending it twice', async () => {
    const h = harness({ manualCompletion: true, concurrentReaders: 2, inputTokens: 400 });
    h.add({ role: 'chief' });
    await h.team.start();
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));
    h.finish(0);
    await done(h.team);
    h.team.configure({ ...DEFAULT_TEAM_SETTINGS, maxTokens: 1000 });
    h.add({ role: 'architect', parallelSafe: true });
    h.add({ role: 'designer', parallelSafe: true });
    await h.team.start();
    await vi.waitFor(() => expect(h.calls).toHaveLength(2));
    expect(h.team.snapshot().tasks[2].status).toBe('queued');
    h.finish(1);
    await done(h.team);
    expect(h.calls).toHaveLength(2);
    expect(h.team.snapshot().budgetReason).toBe('token_budget');
  });
});
