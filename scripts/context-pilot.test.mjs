import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  LIMITS,
  ARMS,
  verifyAuthorization,
  prepareContextPilot,
  executeContextPilot,
} from './context-pilot.mjs';
import { digest } from './context-experiment.mjs';
import { root } from './optimization-tools.mjs';

async function fixture(mode = 'success', approved = true) {
  const local = path.join(root, '.local-office', 'ct-' + randomUUID().slice(0, 8));
  const privateDir = path.join(local, 'private'),
    reports = path.join(local, 'reports');
  const plan = await prepareContextPilot({ privateDir, reports });
  const authorization = {
    protocol: plan.protocol,
    approved,
    planHash: digest(JSON.stringify(plan)),
    limits: LIMITS,
    authorizationNote: 'Fixture offline. Solo adaptador en memoria; no autoriza modelos reales.',
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
  fs.writeFileSync(path.join(privateDir, 'authorization.json'), JSON.stringify(authorization));
  let calls = 0,
    factories = 0;
  const evidence = {
    checkedAt: Date.now(),
    plan: 'plus',
    quota: [],
    models: [{ id: 'gpt-6.1-sol', efforts: ['low'] }],
  };
  const executorFactory = ({ item, arm }) => {
    factories++;
    return {
      provider: 'codex',
      engine: 'codex-cli',
      diagnose: async () => evidence,
      execute: async (options) => {
        calls++;
        assert.equal(options.model, 'gpt-6.1-sol');
        assert.equal(options.effort, 'low');
        assert.equal(options.maxReportedTokens, LIMITS.perRunTokens);
        assert(options.timeoutMs <= LIMITS.perRunMs);
        if (mode !== 'defect')
          for (const [file, text] of Object.entries(item.reference))
            fs.writeFileSync(path.join(options.project, file), text);
        if (mode === 'lost') throw new Error('private provider details');
        options.onOutput?.('OFFICE_RESULT {"status":"completed"}');
        return {
          version: 1,
          id: randomUUID(),
          provider: 'codex',
          billing: 'subscription-only',
          status: 'completed',
          project: options.project,
          requestedModel: options.model,
          requestedEffort: options.effort,
          confirmedModel: null,
          sessionId: 'fixture',
          sessionMode: 'new',
          cliVersion: 'fixture-only',
          startedAt: Date.now(),
          updatedAt: Date.now(),
          reasonCode: null,
          inputTokens: mode === 'unknown' ? null : mode === 'excess' ? LIMITS.perRunTokens : 100,
          outputTokens: 10,
          cachedInputTokens: 40,
          subscriptionCheckedAt: mode === 'subscription' ? undefined : evidence.checkedAt,
          metrics: { source: 'fixture-only', promptCharacters: options.prompt.length },
          arm,
        };
      },
    };
  };
  return {
    plan,
    authorization,
    privateDir,
    reports,
    executorFactory,
    calls: () => calls,
    factories: () => factories,
  };
}

test('exact plan and aggregate bounds are required before constructing any provider', async () => {
  const h = await fixture('success', false);
  await assert.rejects(executeContextPilot(h));
  assert.equal(h.factories(), 0);
  assert.equal(h.calls(), 0);
  assert(!fs.existsSync(path.join(h.privateDir, 'ledger.json')));
  for (const changed of [
    { ...h.authorization, approved: true, planHash: 'old' },
    { ...h.authorization, approved: true, limits: { ...LIMITS, maxTokens: LIMITS.maxTokens + 1 } },
    { ...h.authorization, approved: true, expiresAt: '2000-01-01' },
  ])
    assert.throws(() => verifyAuthorization(changed, h.plan));
});
test('the four real-run paths pass locally with a fake provider and identical paired prompts', async () => {
  const h = await fixture();
  const r = await executeContextPilot(h);
  assert.equal(r.mode, 'offline-fixture');
  assert.equal(r.inferenceObserved, false);
  assert.equal(r.status, 'completed-exploratory', JSON.stringify(r.failure));
  assert.equal(r.arms.length, 4);
  assert.equal(h.calls(), 4);
  assert.deepEqual(
    r.arms.map(({ method, variant }) => ({ method, variant })),
    ARMS,
  );
  for (const arm of r.arms) {
    assert.equal(arm.status, 'accepted');
    assert.equal(arm.quality.tests.length, 36);
    assert(arm.mechanical.every((c) => c.passed));
    assert(arm.gitUnchanged);
  }
  for (const variant of ['standard', 'canonical']) {
    const pair = r.runs.filter((a) => a.variant === variant);
    assert.equal(pair[0].submittedPromptHash, pair[1].submittedPromptHash);
  }
  await assert.rejects(executeContextPilot(h));
  await assert.rejects(prepareContextPilot(h));
  assert.equal(h.calls(), 4);
});
for (const mode of ['defect', 'unknown', 'excess', 'lost', 'subscription'])
  test(`pauses the entire pilot on ${mode}, preserves the attempt and never retries`, async () => {
    const h = await fixture(mode),
      r = await executeContextPilot(h);
    assert.equal(r.status, 'paused');
    assert.equal(h.calls(), 1);
    const ledger = JSON.parse(fs.readFileSync(path.join(h.privateDir, 'ledger.json')));
    assert.equal(ledger.closed, true);
    assert.equal(ledger.paused, true);
    assert.equal(ledger.attempts, 1);
    if (['unknown', 'lost'].includes(mode)) assert.equal(ledger.tokens, null);
    const saved = fs.readFileSync(path.join(h.reports, 'RESULTADO.json'), 'utf8');
    assert(!saved.includes('private provider details'));
    await assert.rejects(executeContextPilot(h));
    assert.equal(h.calls(), 1);
  });
