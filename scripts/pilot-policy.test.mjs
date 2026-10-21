import test from 'node:test';
import assert from 'node:assert/strict';
import { PILOT_LIMITS, pilotGate, acceptAnalysis, compareMeasured } from './pilot-policy.mjs';
test('conservative limits never auto-expand and reserve before each attempt', () => {
  const ledger = { startedAt: 0, attempts: 0, tokens: 0 };
  assert.equal(pilotGate(ledger, 1), null);
  assert.equal(pilotGate({ ...ledger, attempts: 2 }, 1), 'run_budget');
  assert.equal(pilotGate({ ...ledger, tokens: 30001 }, 1), 'token_budget');
  assert.equal(pilotGate(ledger, PILOT_LIMITS.maxMs), 'time_budget');
  assert.equal(pilotGate({ ...ledger, paused: true }, 1), 'paused');
  assert.equal(pilotGate({ ...ledger, tokens: null }, 1), 'usage_unknown');
  assert.ok(Object.isFrozen(PILOT_LIMITS));
});
test('quality requires independent expected outcomes and unchanged files', () => {
  const good =
    '{"defectCode":"BOUND_ORDER","patch":"B","results":[0,5,10,-2,1,4]}\nOFFICE_RESULT {"status":"completed"}';
  assert.ok(acceptAnalysis(good).passed);
  assert.equal(acceptAnalysis(good, false).passed, false);
  for (const bad of [
    good.replace('"B"', '"A"'),
    good.replace('0,5,10', '0,0,0'),
    good.replace('completed', 'blocked'),
    'not json',
  ])
    assert.equal(acceptAnalysis(bad).passed, false);
});
test('cheap failures, missing usage and slower/more expensive candidates never win', () => {
  const a = {
    status: 'completed',
    inputTokens: 20,
    outputTokens: 5,
    durationMs: 10,
    quality: { passed: true },
    requestedModel: 'fixed-model',
    effort: 'low',
    cliVersion: 'fixed-cli',
    initialFilesHash: 'same-files',
    sessionMode: 'new',
    sessionHash: 'first',
  };
  const b = { ...a, sessionHash: 'second' };
  assert.equal(
    compareMeasured(a, { ...b, quality: { passed: false }, inputTokens: 1 }).accepted,
    false,
  );
  assert.equal(compareMeasured(a, { ...b, inputTokens: null }).accepted, false);
  assert.equal(compareMeasured(a, { ...b, inputTokens: 10, durationMs: 11 }).accepted, false);
  assert.equal(compareMeasured(a, { ...b, inputTokens: 10 }).accepted, true);
  assert.equal(compareMeasured(a, { ...b, inputTokens: 10 }).stableImprovementProven, false);
  assert.equal(
    compareMeasured(a, { ...b, inputTokens: 10, effort: 'high' }).reason,
    'controls_mismatch',
  );
  assert.equal(compareMeasured(a, { ...a, inputTokens: 10 }).reason, 'controls_mismatch');
});
