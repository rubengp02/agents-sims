import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';
import test, { after } from 'node:test';
import {
  CASES,
  MODEL,
  plan,
  protocolFingerprint,
  verifyAuthorization,
  verifySuiteAuthorization,
  sequenceStages,
} from './benchmark-v2/protocol.mjs';
import { fairPolicy } from './benchmark-v2/policy.mjs';
import { referenceExecutor, runStage } from './benchmark/runner.mjs';
import { loadTools, root } from './optimization-tools.mjs';
const tools = await loadTools(),
  roots = [];
const temp = () => {
  const path = mkdtempSync(join(tmpdir(), 'pixel-fair-comparison-'));
  roots.push(path);
  return path;
};
after(() => {
  for (const path of roots) {
    const absolute = resolve(path);
    assert.ok(
      absolute.startsWith(resolve(tmpdir()) + sep) &&
        basename(absolute).startsWith('pixel-fair-comparison-'),
    );
    rmSync(absolute, { recursive: true, force: true });
  }
});
function profileExecutor(item, profile) {
  const base = referenceExecutor(item),
    calls = [];
  return {
    ...base,
    calls,
    async execute(options) {
      calls.push(options);
      const record = await base.execute(options);
      const tokens = profile[options.officeRole];
      return {
        ...record,
        inputTokens: tokens,
        outputTokens: 732,
        cachedInputTokens: Math.max(0, tokens - 15000),
      };
    },
  };
}
for (const item of CASES)
  test(`${item.id}: complete fair pair with realistic cumulative usage, no inference`, async () => {
    const root = temp(),
      ledger = { startedAt: Date.now(), attempts: 0, tokens: 0, paused: false };
    const profile =
      item.id === 'hard'
        ? { architect: 15000, developer: 110000, tester: 15000 }
        : { architect: 15000, developer: 56141, tester: 15000 };
    const executor = profileExecutor(item, profile);
    const result = await runStage({
      item,
      tools,
      executor,
      workspace: join(root, 'stage'),
      ledger,
      policy: fairPolicy(),
    });
    assert.equal(result.status, 'completed', result.reasonCode);
    assert.equal(result.controlsPassed, true);
    assert.equal(result.trials.length, 2);
    assert.ok(
      result.trials.every(
        (trial) => trial.quality.passed && trial.functionalQuality.passed && !trial.budget.exceeded,
      ),
      JSON.stringify(result.trials),
    );
    assert.equal(result.runs.length, item.limits.maxRuns);
    assert.equal(result.realInference, false);
    assert.ok(executor.calls.every((call) => call.maxReportedTokens > 30000));
    assert.ok(
      result.trials.every(
        (trial) =>
          trial.budget.tokenLimit === item.limits.maxMethodTokens &&
          trial.budget.timeLimitMs === item.limits.maxMethodMs,
      ),
    );
    const office = result.trials.find((trial) => trial.method === 'office');
    assert.deepEqual(
      office.tasks.map((task) => task.role),
      item.expectedOfficeRoles,
    );
    assert.equal(ledger.closed, true);
    assert.equal(ledger.paused, true);
  });
test('the measured 56873-token attempt fits the new allowance without increasing it at runtime', async () => {
  const item = CASES[0],
    executor = profileExecutor(item, { developer: 56141 }),
    ledger = { startedAt: Date.now(), attempts: 0, tokens: 0, paused: false };
  const result = await runStage({
    item,
    tools,
    executor,
    workspace: join(temp(), 'stage'),
    ledger,
    policy: fairPolicy(),
  });
  assert.deepEqual(
    result.trials.map((trial) => trial.inputTokens + trial.outputTokens),
    [56873, 56873],
  );
  assert.equal(result.reportedTokens, 113746);
  assert.equal(result.limits.maxTokens, 180000);
  assert.equal(result.status, 'completed');
  assert.deepEqual(
    executor.calls.map((call) => call.maxReportedTokens),
    [90000, 90000],
  );
});
test('an office specialist consumes the remaining shared allowance, not a fresh grant', async () => {
  const item = CASES[1],
    executor = profileExecutor(item, { architect: 15000, developer: 56141, tester: 15000 }),
    ledger = { startedAt: Date.now(), attempts: 0, tokens: 0, paused: false };
  await runStage({
    item,
    tools,
    executor,
    workspace: join(temp(), 'stage'),
    ledger,
    policy: fairPolicy(),
  });
  const ceilings = executor.calls.map((call) => call.maxReportedTokens);
  assert.deepEqual(ceilings, [150000, 134268, 77395, 150000]);
  assert.ok(ledger.methods.office.tokens < 150000);
  assert.ok(ledger.methods.direct.tokens < 150000);
});
test('an overrun remains a budget violation even when code passes; the other envelope is protected', async () => {
  const item = CASES[0],
    executor = profileExecutor(item, { developer: 100000 }),
    ledger = { startedAt: Date.now(), attempts: 0, tokens: 0, paused: false };
  const result = await runStage({
    item,
    tools,
    executor,
    workspace: join(temp(), 'stage'),
    ledger,
    policy: fairPolicy(),
  });
  assert.equal(executor.calls.length, 1);
  assert.equal(result.trials[0].functionalQuality.passed, true);
  assert.equal(result.trials[0].status, 'budget-exceeded');
  assert.equal(result.trials[0].quality.passed, false);
  assert.equal(ledger.reason, 'equal_budget_unavailable');
  assert.equal(ledger.methods.direct.tokens, 100732);
  assert.equal(result.limits.maxMethodTokens, 90000);
  assert.equal(result.limits.maxTokens, 180000);
});
test('unknown usage and verification failures stop all new attempts', async () => {
  const item = CASES[0],
    ledger = { startedAt: Date.now(), attempts: 0, tokens: 0, paused: false },
    report = { runs: [] },
    policy = fairPolicy();
  let calls = 0;
  const adapter = policy.executor(
    {
      execute: async () => {
        calls++;
        return {
          status: 'failed',
          reasonCode: 'cli_failed',
          inputTokens: null,
          outputTokens: null,
        };
      },
    },
    ledger,
    report,
    item,
    () => {},
  );
  const stage = new AbortController();
  policy.beginMethod('direct', stage.signal, Date.now());
  try {
    await adapter.execute({
      model: MODEL,
      effort: item.effort,
      officeRole: 'developer',
      allowWrites: true,
      prompt: 'fixture',
    });
    await assert.rejects(adapter.execute({}));
    assert.equal(calls, 1);
    assert.equal(ledger.reason, 'usage_unknown');
    assert.equal(report.runs.length, 1);
    assert.equal(ledger.methods.direct.usageUnknown, true);
  } finally {
    policy.close();
  }
});
test('equal time allocation and closed methods cannot be reset through the gate', () => {
  let clock = 0;
  const item = CASES[0],
    ledger = { startedAt: 0, attempts: 0, tokens: 0, paused: false },
    policy = fairPolicy(() => clock);
  policy.executor({}, ledger, { runs: [] }, item, () => {});
  assert.equal(policy.gateMethod('direct'), null);
  policy.beginMethod('direct', new AbortController().signal, 0);
  try {
    assert.equal(policy.gateMethod('direct'), 'method_already_attempted');
    clock = item.limits.maxMs - item.limits.maxMethodMs + 1;
    assert.equal(policy.gateMethod('office'), 'equal_time_unavailable');
    ledger.paused = true;
    assert.equal(policy.gateMethod('office'), 'paused');
  } finally {
    policy.close();
  }
});
test('v1 authorization and stale/larger bounds cannot authorize v2', () => {
  const item = CASES[0],
    now = Date.now(),
    approval = {
      approved: true,
      protocol: plan().id,
      caseId: 'easy',
      sourceFingerprint: 'current',
      protocolFingerprint: protocolFingerprint(),
      limits: item.limits,
      authorizationNote: 'Local test fixture',
      expiresAt: new Date(now + 60000).toISOString(),
    };
  assert.equal(verifyAuthorization(approval, 'easy', 'current', now).id, 'easy');
  for (const override of [
    { approved: false },
    { protocol: 'codex-direct-vs-office-v1' },
    { sourceFingerprint: 'old' },
    { limits: { ...item.limits, maxMethodTokens: 100000 } },
    { expiresAt: new Date(now).toISOString() },
  ])
    assert.throws(() => verifyAuthorization({ ...approval, ...override }, 'easy', 'current', now));
  assert.equal(plan().status, 'prepared-not-authorized');
  assert.equal(
    plan().stages.reduce((sum, stage) => sum + stage.limits.maxTokens, 0),
    880000,
  );
});
test('benchmark reservation cannot be invalid and never increases the real team cap', () => {
  const executors = {
    codex: referenceExecutor(CASES[0]),
    claude: new tools.DisabledExecutor('claude'),
  };
  for (const estimate of [0, -1, NaN, 200001])
    assert.throws(
      () => new tools.TeamCoordinator(executors, undefined, undefined, undefined, estimate),
    );
  const team = new tools.TeamCoordinator(executors, undefined, undefined, undefined, 20000);
  team.configure({
    mode: 'auto',
    claudeEnabled: false,
    maxRuns: 2,
    maxParallel: 1,
    maxMinutes: 1,
    maxTokens: 30000,
  });
  assert.equal(team.snapshot().settings.maxTokens, 30000);
});
test('v1 budget and failed attempt remain immutable calibration data', () => {
  const report = JSON.parse(
    readFileSync(join(root, 'reports/comparacion-codex/easy-real.json'), 'utf8'),
  );
  assert.equal(report.reportedTokens, 56873);
  assert.equal(report.status, 'paused');
  assert.equal(report.runs.length, 1);
  assert.equal(report.limits.maxTokens, 60000);
});

test('one fixed suite allocation completes all three cases using the real coordinator offline', async () => {
  const parent = temp(),
    suite = { startedAt: Date.now(), attempts: 0, tokens: 0, paused: false };
  let stages = 0;
  await sequenceStages({
    ledger: suite,
    run: async (item) => {
      stages++;
      return runStage({
        item,
        tools,
        executor: profileExecutor(item, {
          architect: 15000,
          developer: item.id === 'hard' ? 110000 : 56141,
          tester: 15000,
        }),
        workspace: join(parent, item.id),
        ledger: { startedAt: Date.now(), attempts: 0, tokens: 0, paused: false },
        policy: fairPolicy(),
      });
    },
  });
  assert.equal(stages, 3);
  assert.equal(suite.status, 'completed');
  assert.equal(suite.attempts, 10);
  assert.ok(suite.tokens < plan().suiteLimits.maxTokens);
  assert.equal(suite.closed, true);
  assert.equal(suite.paused, true);
  assert.deepEqual(
    suite.stages.map((stage) => stage.caseId),
    ['easy', 'medium', 'hard'],
  );
});
test('a stopped stage or unknown usage never silently starts the next case', async () => {
  for (const unknown of [false, true]) {
    let calls = 0;
    const suite = { startedAt: Date.now(), attempts: 0, tokens: 0, paused: false };
    await sequenceStages({
      ledger: suite,
      run: async (item) => {
        calls++;
        return {
          status: 'paused',
          runs: [{}],
          reportedTokens: unknown ? null : 56873,
          controlsPassed: false,
          comparison: { verdict: 'incomplete' },
        };
      },
    });
    assert.equal(calls, 1);
    assert.equal(suite.status, 'paused');
    assert.equal(suite.closed, true);
    if (unknown) assert.equal(suite.usageUnknown, true);
  }
});
test('full-suite authorization covers exact total bounds and cannot be inferred from one case', () => {
  const now = Date.now(),
    approval = {
      approved: true,
      scope: 'all',
      protocol: plan().id,
      sourceFingerprint: 'current',
      protocolFingerprint: protocolFingerprint(),
      limits: plan().suiteLimits,
      authorizationNote: 'Unit test authorization',
      expiresAt: new Date(now + 60000).toISOString(),
    };
  assert.equal(verifySuiteAuthorization(approval, 'current', now).scope, 'all');
  for (const change of [
    { approved: false },
    { scope: 'easy' },
    { limits: { ...approval.limits, maxTokens: 880001 } },
    { sourceFingerprint: 'old' },
  ])
    assert.throws(() => verifySuiteAuthorization({ ...approval, ...change }, 'current', now));
  assert.deepEqual(plan().suiteLimits, { maxRuns: 10, maxTokens: 880000, maxMs: 1380000 });
});
