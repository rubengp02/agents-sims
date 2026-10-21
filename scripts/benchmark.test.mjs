import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, sep, basename } from 'node:path';
import test, { after } from 'node:test';
import { CASES, fixtureFiles } from './benchmark/cases.mjs';
import { materialize, snapshot, inspectChanges, acceptance } from './benchmark/kit.mjs';
import {
  plan,
  protocolFingerprint,
  verifyAuthorization,
  gate,
  comparePair,
  usageTotal,
} from './benchmark/protocol.mjs';
import { runStage, referenceExecutor, budgetExecutor } from './benchmark/runner.mjs';
import { loadTools } from './optimization-tools.mjs';

const tools = await loadTools(),
  roots = [];
function temp() {
  const root = mkdtempSync(join(tmpdir(), 'pixel-comparison-'));
  roots.push(root);
  return root;
}
after(() => {
  for (const root of roots) {
    const absolute = resolve(root);
    assert.ok(
      absolute.startsWith(resolve(tmpdir()) + sep) &&
        basename(absolute).startsWith('pixel-comparison-'),
    );
    rmSync(absolute, { recursive: true, force: true });
  }
});

for (const item of CASES) {
  test(`${item.id}: independent acceptance rejects initial code and accepts reference`, async () => {
    const root = temp(),
      bad = join(root, 'initial'),
      good = join(root, 'reference');
    materialize(bad, item);
    materialize(good, item, true);
    const failed = await acceptance(item, bad, tools.stopProcess);
    const passed = await acceptance(item, good, tools.stopProcess);
    assert.equal(failed.passed, false);
    assert.equal(passed.passed, true, JSON.stringify(passed.failedChecks));
    assert.ok(passed.tests.length >= 10);
  });
  test(`${item.id}: same initial files and actual coordinator, simulated execution only`, async () => {
    const root = temp(),
      ledger = { startedAt: Date.now(), attempts: 0, tokens: 0, paused: false };
    const result = await runStage({
      item,
      tools,
      executor: referenceExecutor(item),
      workspace: join(root, 'stage'),
      ledger,
    });
    assert.equal(result.realInference, false);
    assert.equal(result.status, 'completed', result.reasonCode);
    assert.ok(result.controlsPassed);
    assert.ok(
      result.trials.every((trial) => trial.quality.passed),
      JSON.stringify(result.trials.map((trial) => trial.quality)),
    );
    assert.equal(result.runs.length, item.limits.maxRuns);
    assert.equal(ledger.paused, true);
    assert.equal(ledger.closed, true);
    const office = result.trials.find((trial) => trial.method === 'office');
    assert.deepEqual(
      office.tasks.map((task) => task.role),
      item.expectedOfficeRoles,
    );
    assert.equal(result.trials[0].initialFilesHash, result.trials[1].initialFilesHash);
  });
}
test('external acceptance catches regressions that public smoke tests do not cover', async () => {
  const item = CASES[0],
    root = temp(),
    project = join(root, 'mutation');
  materialize(project, item, true);
  writeFileSync(
    join(project, 'label.mjs'),
    fixtureFiles(item, true)['label.mjs'].replace('/\\s+/gu', '/ +/g'),
  );
  const result = await acceptance(item, project, tools.stopProcess);
  assert.equal(result.passed, false);
  assert.ok(result.failedChecks.includes('value-2'));
});
test('protected tests, instructions, new files and deletions fail scope acceptance', () => {
  const root = temp(),
    project = join(root, 'project');
  materialize(project, CASES[0]);
  const before = snapshot(project);
  writeFileSync(join(project, 'contract.test.mjs'), '// bypass');
  writeFileSync(join(project, 'extra.mjs'), '');
  const changes = inspectChanges(before, snapshot(project), CASES[0].files);
  assert.equal(changes.passed, false);
  assert.deepEqual(changes.unexpected, ['contract.test.mjs', 'extra.mjs']);
  const after = { ...before };
  delete after['label.mjs'];
  assert.equal(inspectChanges(before, after, CASES[0].files).passed, false);
});
test('authorization is separate, per stage, current, exact and never generated approved', () => {
  const item = CASES[0],
    now = Date.now();
  const approved = {
    approved: true,
    protocol: plan().id,
    caseId: item.id,
    sourceFingerprint: 'code',
    protocolFingerprint: protocolFingerprint(),
    limits: item.limits,
    authorizationNote: 'Human-approved test fixture',
    expiresAt: new Date(now + 60000).toISOString(),
  };
  assert.equal(verifyAuthorization(approved, 'easy', 'code', now).id, 'easy');
  for (const changed of [
    { approved: false },
    { caseId: 'hard' },
    { sourceFingerprint: 'old' },
    { protocolFingerprint: 'old' },
    { limits: { ...item.limits, maxRuns: 3 } },
    { expiresAt: new Date(now).toISOString() },
    { authorizationNote: '' },
  ])
    assert.throws(() => verifyAuthorization({ ...approved, ...changed }, 'easy', 'code', now));
  assert.equal(plan().status, 'prepared-not-authorized');
  assert.equal(
    plan().stages.reduce((sum, stage) => sum + stage.limits.maxRuns, 0),
    10,
  );
});
test('budget records blocked/unknown attempts and refuses retries after pause', async () => {
  const item = CASES[0],
    ledger = { startedAt: Date.now(), attempts: 0, tokens: 0, paused: false },
    report = { runs: [] };
  let calls = 0;
  const executor = {
    execute: async () => {
      calls++;
      return { status: 'failed', reasonCode: 'cli_failed', inputTokens: null, outputTokens: null };
    },
  };
  const guarded = budgetExecutor(executor, ledger, report, item, () => {});
  const options = {
    prompt: 'fixture',
    model: plan().model,
    effort: item.effort,
    officeRole: 'developer',
    allowWrites: true,
  };
  await guarded.execute(options);
  assert.equal(ledger.attempts, 1);
  assert.equal(report.runs.length, 1);
  assert.equal(ledger.paused, true);
  await assert.rejects(guarded.execute(options));
  assert.equal(calls, 1);
  assert.equal(gate({ startedAt: 0, attempts: 2, tokens: 0 }, item.limits, 1), 'run_budget');
  assert.equal(gate({ startedAt: 0, attempts: 0, tokens: 30001 }, item.limits, 1), 'token_budget');
  assert.equal(
    gate({ startedAt: 0, attempts: 0, tokens: 0 }, item.limits, item.limits.maxMs),
    'time_budget',
  );
  assert.equal(usageTotal([{ inputTokens: null }], 'inputTokens'), null);
});
test('account/catalog failures prevent every model invocation', async () => {
  const item = CASES[0],
    root = temp(),
    ledger = { startedAt: Date.now(), attempts: 0, tokens: 0, paused: false };
  let calls = 0;
  const result = await runStage({
    item,
    tools,
    workspace: join(root, 'stage'),
    ledger,
    executor: {
      diagnose: async () => {
        throw Object.assign(new Error('blocked'), { code: 'subscription_unverified' });
      },
      execute: async () => {
        calls++;
      },
    },
  });
  assert.equal(calls, 0);
  assert.equal(ledger.attempts, 0);
  assert.equal(result.status, 'blocked');
  assert.equal(ledger.paused, true);
});
test('a cheaper failed task cannot beat an accepted direct task', () => {
  const direct = {
    method: 'direct',
    quality: { passed: true },
    inputTokens: 10,
    outputTokens: 1,
    totalDurationMs: 10,
  };
  const office = {
    method: 'office',
    quality: { passed: false },
    inputTokens: 1,
    outputTokens: 1,
    totalDurationMs: 1,
  };
  assert.equal(comparePair([direct, office]).verdict, 'quality_difference_observed');
  assert.equal(comparePair([direct, office]).generalImprovementProven, false);
  assert.equal(comparePair([direct]).verdict, 'incomplete');
});
