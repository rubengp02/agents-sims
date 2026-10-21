// All providers below are fixtures; real Git/worktrees/checks/coordinator, no inference.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { prepare, execute } from './parallel-real-pilot.mjs';
import { references } from './parallel-pilot-case.mjs';
import { loadTools, root } from './optimization-tools.mjs';

async function fixtures({ unknown = false, overBudget = false } = {}) {
  const tools = await loadTools();
  let dispatches = 0;
  const testRoot = path.join(root, '.local-office/parallel-real-fixtures', randomUUID());
  fs.mkdirSync(testRoot, { recursive: true });
  class Provider {
    constructor() {
      const managed = path.join(testRoot, randomUUID());
      fs.mkdirSync(managed);
      this.workspaceManager = new tools.WorkflowWorkspaceManager(
        managed,
        path.join(testRoot, 'evidence'),
        async (project, id, base) => {
          const dest = path.join(managed, id);
          execFileSync('git', ['-C', project, 'worktree', 'add', '--detach', dest, base], {
            stdio: 'pipe',
            windowsHide: true,
          });
          return dest;
        },
      );
    }
    async diagnose() {
      return {
        checkedAt: Date.now(),
        plan: 'plus',
        quota: [],
        models: [{ id: 'gpt-6.1-sol', efforts: ['low'] }],
      };
    }
    async execute(options) {
      dispatches++;
      const target = options.ownedWorkspace?.path ?? options.project;
      const startedAt = Date.now(),
        id = randomUUID();
      const r = {
        version: 1,
        id,
        provider: 'codex',
        billing: 'subscription-only',
        status: 'running',
        project: options.project,
        executionProject: target,
        requestedModel: options.model,
        requestedEffort: options.effort,
        confirmedModel: options.model,
        sessionId: id,
        sessionMode: 'new',
        startedAt,
        updatedAt: startedAt,
        reasonCode: null,
        inputTokens: 100,
        outputTokens: 10,
        cachedInputTokens: 20,
        subscriptionCheckedAt: Date.now(),
      };
      options.onState?.(r);
      await new Promise((resolve) => setTimeout(resolve, 100));
      for (const [file, content] of Object.entries(references))
        if (!options.ownedWorkspace || options.prompt.includes('únicamente ' + file))
          fs.writeFileSync(path.join(target, file), content);
      r.status = 'completed';
      r.updatedAt = Date.now();
      if (overBudget) r.inputTokens = 80001;
      if (unknown && options.ownedWorkspace?.workerId) {
        r.inputTokens = null;
        r.outputTokens = null;
      }
      options.onOutput?.('OFFICE_RESULT {"status":"completed"}');
      options.onState?.(r);
      return r;
    }
  }
  return {
    tools: { ...tools, CodexExecutor: Provider, OrchestratorExecutor: Provider },
    count: () => dispatches,
  };
}
function authorizeFixture(plan) {
  const dir = path.join(root, '.local-office/parallel-real', plan.attempt);
  fs.writeFileSync(
    path.join(dir, 'authorization.json'),
    JSON.stringify({
      approved: true,
      planHash: createHash('sha256').update(JSON.stringify(plan)).digest('hex'),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    }),
  );
}
test('missing authorization blocks before any fixture dispatch', async () => {
  const f = await fixtures(),
    plan = await prepare(f.tools);
  await assert.rejects(execute(plan.attempt, f.tools));
  assert.equal(f.count(), 0);
});
test('paired complete circuit: two real worktrees, joint acceptance, all costs and receipts', async () => {
  const f = await fixtures(),
    plan = await prepare(f.tools);
  authorizeFixture(plan);
  const result = await execute(plan.attempt, f.tools);
  const report = JSON.parse(
    fs.readFileSync(
      path.join(
        root,
        '.local-office/parallel-real',
        plan.attempt,
        'fixture-report',
        'RESULTADO.json',
      ),
    ),
  );
  assert.equal(result.complete, true, JSON.stringify(report));
  assert.equal(f.count(), 3);
  assert.equal(report.methods[1].peakConcurrent, 2);
  assert.equal(report.methods[1].operations.mode, 'parallel');
  assert.equal(report.methods[1].quality.tests, 50);
  assert(report.methods.every((m) => m.protectedFiles));
  assert.equal(report.mode, 'injected-protocol-fixture');
  assert.equal(report.inferenceObserved, false);
  assert(report.runs.every((r) => r.runId && r.subscriptionVerified && r.sessionMode === 'new'));
  await assert.rejects(execute(plan.attempt, f.tools));
  assert.equal(f.count(), 3);
});
test('lost usage stays unknown when the second writer settles', async () => {
  const f = await fixtures({ unknown: true }),
    plan = await prepare(f.tools);
  authorizeFixture(plan);
  const result = await execute(plan.attempt, f.tools);
  const ledger = JSON.parse(
    fs.readFileSync(path.join(root, '.local-office/parallel-real', plan.attempt, 'ledger.json')),
  );
  assert.equal(result.complete, false);
  assert.equal(ledger.tokens, null);
  assert(ledger.paused && ledger.closed);
  assert(f.count() <= 3);
});
test('reported budget overrun stops before starting another arm', async () => {
  const f = await fixtures({ overBudget: true }),
    plan = await prepare(f.tools);
  authorizeFixture(plan);
  const result = await execute(plan.attempt, f.tools);
  assert.equal(result.complete, false);
  assert.equal(result.reason, 'token_budget');
  assert.equal(f.count(), 1);
});
