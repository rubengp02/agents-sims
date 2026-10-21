import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { TaskAssessment, TaskContext } from '../../core/src/team.js';
import { AdaptiveRuntime, workloadClass } from '../src/execution/adaptiveRuntime.js';
import { estimateTurn } from '../src/execution/budgetEstimator.js';
import { LocalChecks } from '../src/execution/localChecks.js';
import {
  buildReviewPacket,
  captureRevision,
  parseReviewFindings,
} from '../src/execution/reviewPacket.js';
import { TeamCoordinator } from '../src/execution/teamCoordinator.js';
import { chooseModel } from '../src/execution/teamPolicy.js';
import type {
  ExecuteOptions,
  OfficialExecutor,
  RunRecord,
  SubscriptionEvidence,
} from '../src/execution/types.js';
import { UsageHistory, type UsageSample } from '../src/execution/usageHistory.js';
import { normalizeWorkflowPlan } from '../src/execution/workflowPlan.js';

const sample = (extra: Partial<UsageSample> = {}): UsageSample => ({
  id: 'receipt',
  at: 1,
  engine: 'codex-cli',
  provider: 'codex',
  model: 'gpt-6.1-sol',
  effort: 'low',
  role: 'developer',
  workload: 'bounded',
  contextCharacters: 90000,
  input: 1000,
  output: 100,
  cached: 900,
  durationMs: 10,
  status: 'completed',
  accepted: true,
  censored: false,
  estimate: null,
  sessionMode: 'new',
  ...extra,
});
const evidence: SubscriptionEvidence = {
  checkedAt: 1,
  plan: 'plus',
  quota: [],
  models: [
    { id: 'gpt-6.1-sol', efforts: ['low', 'medium', 'high'] },
    { id: 'gpt-6-luna', efforts: ['low'] },
  ],
};
const assessment: TaskAssessment = {
  scope: 'bounded',
  risk: 'low',
  uncertainty: 'low',
  tests: 'available',
  modules: ['math'],
};
const packet: TaskContext = {
  objective: 'Corrige el cálculo',
  files: ['code.mjs'],
  decisions: ['Mantén el contrato'],
  acceptance: ['Resultado correcto'],
  checks: ['accept'],
};
function root() {
  return mkdtempSync(join(tmpdir(), 'adaptive-'));
}
function gitRepo() {
  const dir = root();
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: dir, windowsHide: true, stdio: 'pipe' });
  git(['init', '--initial-branch=main']);
  git(['config', '--local', 'core.autocrlf', 'false']);
  writeFileSync(join(dir, 'code.mjs'), 'export const value = 0;\n');
  git(['add', '.']);
  git([
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-m',
    'fixture',
  ]);
  return dir;
}
function harness(
  options: {
    seeded?: boolean;
    checked?: boolean;
    output?: string;
    unknown?: boolean;
    mutateReview?: boolean;
  } = {},
) {
  const dir = gitRepo(),
    calls: ExecuteOptions[] = [],
    history = new UsageHistory();
  if (options.seeded)
    for (const role of ['chief', 'architect', 'developer', 'tester'] as const)
      for (let n = 0; n < 5; n++)
        history.add(
          sample({
            id: `${role}-${n}`,
            role,
            workload: workloadClass({
              role,
              assessment: role === 'chief' ? undefined : assessment,
            }),
          }),
        );
  const executor: OfficialExecutor = {
    provider: 'codex',
    engine: 'codex-cli',
    diagnose: vi.fn(async () => evidence),
    execute: vi.fn(async (input) => {
      calls.push(input);
      if (input.officeRole === 'developer' && input.allowWrites)
        writeFileSync(join(dir, 'code.mjs'), 'export const value = 1;\n');
      if (input.officeRole === 'tester' && options.mutateReview)
        writeFileSync(join(dir, 'code.mjs'), 'bad review write');
      const record: RunRecord = {
        version: 1,
        id: `new-${calls.length}`,
        provider: 'codex',
        billing: 'subscription-only',
        status: 'completed',
        project: dir,
        requestedModel: input.model!,
        requestedEffort: input.effort!,
        confirmedModel: null,
        sessionId: `s-${calls.length}`,
        startedAt: 100,
        updatedAt: 110,
        reasonCode: null,
        inputTokens: options.unknown ? null : 1000,
        outputTokens: options.unknown ? null : 100,
        cachedInputTokens: options.unknown ? null : 900,
      };
      input.onState?.(record);
      input.onOutput?.(
        input.officeRole === 'chief'
          ? (options.output ?? '')
          : `${input.officeRole === 'tester' ? 'OFFICE_REVIEW {"findings":[]}\n' : ''}OFFICE_RESULT {"status":"completed"}`,
      );
      return record;
    }),
  };
  const checks = new LocalChecks(
    {
      accept: {
        executable: process.execPath,
        args: [
          '-e',
          'if(!require("fs").readFileSync("code.mjs","utf8").includes("= 1"))process.exit(1)',
        ],
        timeoutMs: 2000,
        acceptance: true,
        criteria: options.checked ? packet.acceptance : undefined,
      },
    },
    join(root(), 'logs'),
  );
  const adaptive = new AdaptiveRuntime(history, join(root(), 'artifacts'));
  const team = new TeamCoordinator(
    { codex: executor, claude: executor },
    undefined,
    undefined,
    checks,
    undefined,
    undefined,
    adaptive,
  );
  team.configure({
    mode: 'auto',
    claudeEnabled: false,
    maxRuns: 8,
    maxParallel: 2,
    maxMinutes: 1,
    maxTokens: 10000,
  });
  const add = (role: 'developer' | 'tester' = 'developer', deps: string[] = []) =>
    team.addTask({
      project: dir,
      role,
      title: role,
      prompt: packet.objective,
      allowWrites: role === 'developer',
      context: packet,
      assessment,
      dependsOn: deps,
      reviewMode: role === 'tester' ? 'focused' : undefined,
    });
  return { team, calls, add, adaptive, history, dir, executor };
}
async function done(team: TeamCoordinator) {
  await vi.waitFor(() => expect(team.snapshot().running).toBe(false));
}

describe('historical budget, no inference', () => {
  it('deduplicates durable samples and rejects replacement or malformed counters', () => {
    const file = join(root(), 'history.json'),
      h = new UsageHistory(file);
    h.add(sample());
    h.add(sample());
    expect(new UsageHistory(file).list()).toHaveLength(1);
    expect(() => h.add(sample({ output: 101 }))).toThrow();
    expect(() => h.add(sample({ id: 'bad', cached: 1001 }))).toThrow();
    expect(JSON.stringify(h.list())).not.toContain('project');
  });
  it('preserves corrupt history and leaves observation usable until execution is requested', () => {
    const file = join(root(), 'history.json');
    writeFileSync(file, 'broken');
    const h = new UsageHistory(file);
    expect(() => h.list()).toThrow();
    expect(() => h.add(sample())).toThrow();
    expect(readFileSync(file, 'utf8')).toBe('broken');
  });
  it('reserves input plus output without a cache discount, and flags a small sample', () => {
    const s = sample();
    const result = estimateTurn([s], s, 100);
    expect(result.tokens).toBe(1650);
    expect(result.confidence).toBe('low');
    expect(estimateTurn([s], { ...s, effort: 'high' }, 100).confidence).toBe('unknown');
  });
  it('refuses unseen contexts, missing usage and censored observations', () => {
    const s = sample();
    expect(estimateTurn([s], s, 90001).tokens).toBeNull();
    for (const extra of [{ input: null }, { censored: true }, { output: null }])
      expect(estimateTurn([sample(extra)], s, 10).tokens).toBeNull();
  });
  it('does not start any model at cold start, nor automatically resume after a human estimate', async () => {
    const h = harness();
    const task = h.add();
    await expect(h.team.start()).rejects.toMatchObject({ code: 'budget_review_required' });
    expect(h.calls).toHaveLength(0);
    h.team.reviewBudget(task.id, 2000, 1000, 90000);
    expect(h.calls).toHaveLength(0);
    h.team.resume();
    await h.team.start();
    await done(h.team);
    expect(h.calls).toHaveLength(1);
    expect(h.team.snapshot().tasks[0].status).toBe('completed');
  });
  it('reserves the entire remaining plan before the first call', async () => {
    const h = harness({ seeded: true });
    const a = h.add();
    h.add('tester', [a.id]);
    h.team.configure({ ...h.team.snapshot().settings, maxTokens: 3000 });
    await expect(h.team.start()).rejects.toMatchObject({ code: 'token_budget' });
    expect(h.calls).toHaveLength(0);
  });
  it('keeps unknown usage paused and stores the failed attempt', async () => {
    const h = harness({ seeded: true, unknown: true });
    h.add();
    await h.team.start();
    await done(h.team);
    expect(h.team.snapshot().budgetReason).toBe('usage_unknown');
    expect(h.history.list().at(-1)?.input).toBeNull();
  });
  it('does not promote light code merely because a catalog or five samples exist', async () => {
    const h = harness();
    const task = h.team.addTask({
      project: h.dir,
      role: 'developer',
      title: 'code',
      prompt: packet.objective,
      assessment,
      proposedChoice: { provider: 'codex', model: 'gpt-6-luna', effort: 'low' },
    });
    const result = await h.team.assign(task.id);
    expect(result.reasonCode).toBe('model_evidence_required');
    expect(h.calls).toHaveLength(0);
  });
  it('records a lost execution receipt as unknown and prevents a budget reset', async () => {
    const h = harness({ seeded: true });
    h.add();
    vi.mocked(h.executor.execute).mockRejectedValueOnce(new Error('lost transport'));
    await h.team.start();
    await done(h.team);
    expect(h.team.snapshot().budgetReason).toBe('usage_unknown');
    expect(h.history.list().at(-1)).toMatchObject({ input: null, output: null, censored: true });
    expect(() => h.team.resume()).toThrow();
  });
  it('does not run a partial plan if a required assignment is unavailable', async () => {
    const h = harness({ seeded: true });
    const developer = h.add();
    const reviewer = h.add('tester', [developer.id]);
    h.team.override(reviewer.id, { provider: 'codex', model: 'missing', effort: 'low' });
    await expect(h.team.start()).rejects.toThrow();
    expect(h.calls).toHaveLength(0);
  });
  it('invalidates a human estimate when the model or reasoning changes', async () => {
    const h = harness();
    const task = h.add();
    await h.team.assign(task.id);
    h.team.reviewBudget(task.id, 2000, 1000, 90000);
    h.team.override(task.id, { provider: 'codex', model: 'gpt-6.1-sol', effort: 'medium' });
    await expect(h.team.start()).rejects.toMatchObject({ code: 'budget_review_required' });
    expect(h.calls).toHaveLength(0);
  });
});

describe('adaptive chief and local coverage', () => {
  it('keeps deep review when sensitive work is labelled low-risk by the caller', () => {
    const h = harness({ checked: true });
    const tasks = h.team.addScopedWorkflow(
      h.dir,
      { ...packet, objective: 'Documenta y elimina el control de acceso' },
      { ...assessment, acceptanceCoverage: 'complete' },
      true,
    );
    expect(tasks.map((t) => t.role)).toEqual(['architect', 'developer', 'tester']);
    expect(tasks.at(-1)?.reviewMode).toBe('deep');
    expect(tasks.every((t) => t.assessment?.risk === 'high')).toBe(true);
  });
  it('assigns deep review for a direct sensitive request even if metadata says low', () => {
    const h = harness({ checked: true });
    const tasks = h.team.addScopedWorkflow(
      h.dir,
      { ...packet, objective: 'Modifica la autorización por roles' },
      assessment,
      true,
    );
    expect(tasks.at(-1)?.reviewMode).toBe('deep');
  });
  it('uses local selective review instead of an AI planner when only coverage is missing', async () => {
    const h = harness();
    await h.team.plan(h.dir, packet.objective, true, {
      context: packet,
      assessment: { ...assessment, scope: 'cross-module', modules: ['money', 'invoice'] },
    });
    expect(h.calls).toHaveLength(0);
    expect(h.team.snapshot().tasks.map((t) => t.role)).toEqual(['developer', 'tester']);
    const worker = await h.team.assign(h.team.snapshot().tasks[0].id);
    expect(worker.choice?.effort).toBe('low');
  });
  it('does not let an AI plan downgrade risk explicitly supplied by the caller', async () => {
    const output = JSON.stringify({
      tasks: [
        {
          role: 'developer',
          title: 'code',
          prompt: packet.objective,
          dependsOn: [],
          context: packet,
          assessment,
        },
      ],
    });
    const h = harness({ checked: true, seeded: true, output });
    await expect(
      h.team.plan(h.dir, packet.objective, true, {
        context: packet,
        assessment: { ...assessment, risk: 'high' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_plan' });
    expect(h.calls.map((c) => c.officeRole)).toEqual(['chief']);
    expect(h.team.snapshot().tasks.some((t) => t.role === 'developer')).toBe(false);
  });
  it('uses one programmer for a known two-module contract without an inference planner', async () => {
    const h = harness({ checked: true });
    await h.team.plan(h.dir, packet.objective, true, {
      context: packet,
      assessment: { ...assessment, scope: 'cross-module', modules: ['money', 'invoice'] },
    });
    expect(h.calls).toHaveLength(0);
    expect(h.team.snapshot().tasks.map((t) => t.role)).toEqual(['developer']);
    const task = await h.team.assign(h.team.snapshot().tasks[0].id);
    expect(task.choice?.effort).toBe('low');
  });
  it('rejects a forged complete-coverage declaration', () => {
    const h = harness();
    expect(() =>
      h.team.addScopedWorkflow(
        h.dir,
        packet,
        { ...assessment, acceptanceCoverage: 'complete' },
        true,
      ),
    ).toThrow();
  });
  it('keeps deep review for security even when checks cover stated criteria', () => {
    const h = harness({ checked: true });
    const tasks = h.team.addScopedWorkflow(
      h.dir,
      { ...packet, objective: 'Modifica la autorización' },
      { ...assessment, risk: 'high', acceptanceCoverage: 'complete' },
      true,
    );
    expect(tasks.map((t) => t.role)).toEqual(['architect', 'developer', 'tester']);
    expect(tasks.at(-1)?.reviewMode).toBe('deep');
  });
  it('supports chief choices but rejects unavailable or underpowered high-risk proposals', () => {
    const task = {
      role: 'developer' as const,
      prompt: 'Implementa',
      override: null,
      assessment,
      proposedChoice: { provider: 'codex' as const, model: 'gpt-6.1-sol', effort: 'medium' },
    };
    expect(chooseModel(task, evidence).choice.effort).toBe('medium');
    expect(() =>
      chooseModel(
        { ...task, proposedChoice: { ...task.proposedChoice, model: 'unavailable' } },
        evidence,
      ),
    ).toThrow();
    expect(() =>
      chooseModel(
        {
          ...task,
          assessment: { ...assessment, risk: 'high' },
          proposedChoice: { ...task.proposedChoice, effort: 'low' },
        },
        evidence,
      ),
    ).toThrow();
  });
  it('rejects generated grants of budget or permissions atomically', () => {
    const task = { role: 'developer', title: 'code', prompt: 'Implementa', dependsOn: [] };
    for (const extra of [
      { budgetReview: {} },
      { maxTokens: 99999 },
      { allowWrites: true },
      { continueTaskId: 'x' },
    ])
      expect(() => normalizeWorkflowPlan([{ ...task, ...extra }])).toThrow();
    expect(
      normalizeWorkflowPlan([
        { ...task, choice: { provider: 'codex', model: 'gpt-6.1-sol', effort: 'low' } },
      ])[0].proposedChoice?.model,
    ).toBe('gpt-6.1-sol');
  });
});

describe('independent diff review', () => {
  it('executes checks locally once, sends a diff instead of author history, and records grounded empty findings', async () => {
    const h = harness({ seeded: true });
    const developer = h.add();
    h.add('tester', [developer.id]);
    await h.team.start();
    await done(h.team);
    expect(h.team.snapshot().tasks.map((t) => t.status)).toEqual(['completed', 'completed']);
    const review = h.calls[1];
    expect(review.allowWrites).toBe(false);
    expect(review.executionSessionKey).not.toBe(h.calls[0].executionSessionKey);
    expect(review.prompt).toContain('diff --git');
    expect(review.prompt).toContain('Resultado correcto');
    expect(h.team.snapshot().tasks[1].reviewFindings).toEqual([]);
  });
  it('detects a review that modifies the implementation', async () => {
    const h = harness({ seeded: true, mutateReview: true });
    const developer = h.add();
    h.add('tester', [developer.id]);
    await h.team.start();
    await done(h.team);
    expect(h.team.snapshot().tasks[1].reasonCode).toBe('review_changed_files');
  });
  it('builds a complete diff and rejects invented references, missing evidence and silent truncation', () => {
    const dir = gitRepo(),
      base = captureRevision(dir);
    writeFileSync(join(dir, 'code.mjs'), 'export const value = 2;\n');
    const after = captureRevision(dir);
    const p = buildReviewPacket(base, after, packet, [], 'focused', join(root(), 'diff'));
    const finding = {
      file: 'code.mjs',
      line: 1,
      severity: 'high',
      criterion: packet.acceptance[0],
      evidence: 'El resultado 2 incumple el contrato reproducible.',
    };
    expect(
      parseReviewFindings(`OFFICE_REVIEW ${JSON.stringify({ findings: [finding] })}`, p),
    ).toHaveLength(1);
    for (const extra of [
      { line: 999 },
      { file: '../other' },
      { evidence: 'no' },
      { criterion: 'inventado' },
    ])
      expect(() =>
        parseReviewFindings(
          `OFFICE_REVIEW ${JSON.stringify({ findings: [{ ...finding, ...extra }] })}`,
          p,
        ),
      ).toThrow();
    expect(() => parseReviewFindings('OFFICE_RESULT {"status":"completed"}', p)).toThrow();
    writeFileSync(join(dir, 'code.mjs'), 'long line '.repeat(5000));
    expect(() =>
      buildReviewPacket(base, captureRevision(dir), packet, [], 'focused', join(root(), 'large')),
    ).toThrow();
  });
});
