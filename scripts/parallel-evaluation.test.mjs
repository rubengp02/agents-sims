import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { cases } from './parallel-evaluation-cases.mjs';
import { futureProtocols, verifyFutureTrial } from './parallel-protocol.mjs';

test('twelve distinct structural tasks cover six families twice and two isolated decompositions', () => {
  assert.equal(new Set(cases.map((c) => c.id)).size, 12);
  for (const family of new Set(cases.map((c) => c.family)))
    assert.equal(cases.filter((c) => c.family === family).length, 2);
  assert.equal(new Set(cases.map((c) => c.family)).size, 6);
  assert.equal(cases.filter((c) => c.split).length, 2);
  assert.equal(new Set(cases.map((c) => c.assertion)).size, 12);
});
test('neither future protocol reuses authorizations or permits unbounded inference', () => {
  for (const plan of futureProtocols)
    for (const approval of [null, {}, { approved: true, planHash: 'old', expiresAt: '2099-01-01' }])
      assert.throws(() => verifyFutureTrial(plan, approval, 'fixture'), {
        code: 'new_trial_authorization_required',
      });
  const bounded = {
    ...futureProtocols[0],
    realProviderEnabled: true,
    sourceFingerprint: 'fixture',
    limits: { maxRuns: 1, maxTokens: 1000, totalMs: 60000, maxParallel: 1 },
  };
  assert.throws(() => verifyFutureTrial(bounded, null, 'fixture'), {
    code: 'new_trial_authorization_required',
  });
  assert.throws(() =>
    verifyFutureTrial(
      { ...bounded, limits: { ...bounded.limits, maxParallel: 3 } },
      { approved: true },
      'fixture',
    ),
  );
});
test('offline matrix rejects a real execution request before loading providers', () => {
  const result = spawnSync(process.execPath, ['scripts/parallel-evaluation.mjs', '--real'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /solo admite ejecución local/);
});
