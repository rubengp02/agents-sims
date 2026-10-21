import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { LIMITS, verifyPilotAuthorization } from './chief-pilot.mjs';

const plan = {
  protocol: 'adaptive-chief-single-worker-v1',
  limits: LIMITS,
  effort: 'low',
  sourceFingerprint: 'fixture',
};
const now = 1792590000000;
function approval() {
  return {
    protocol: plan.protocol,
    limits: LIMITS,
    approved: true,
    planHash: createHash('sha256').update(JSON.stringify(plan)).digest('hex'),
    authorizationNote: 'Fixture offline: no autoriza un modelo real.',
    expiresAt: new Date(now + 60000).toISOString(),
  };
}
test('a fixture authorization binds the exact plan and limits without starting a model', () => {
  assert.doesNotThrow(() => verifyPilotAuthorization(approval(), plan, now));
  assert.equal(LIMITS.maxRuns, 1);
  assert.equal(LIMITS.maxTokens, 120000);
  assert.equal(LIMITS.maxRepairs, 0);
});
test('missing, pending, expired and stale approvals never authorize this pilot', () => {
  for (const bad of [
    null,
    {},
    { ...approval(), approved: false },
    { ...approval(), authorizationNote: '' },
    { ...approval(), expiresAt: new Date(now).toISOString() },
    { ...approval(), expiresAt: new Date(now + 86400001).toISOString() },
    { ...approval(), planHash: 'old' },
    { ...approval(), limits: { ...LIMITS, maxTokens: 120001 } },
  ])
    assert.throws(() => verifyPilotAuthorization(bad, plan, now));
});
test('authorization of medium reasoning or a different source cannot authorize the low pilot', () => {
  assert.throws(() => verifyPilotAuthorization(approval(), { ...plan, effort: 'medium' }, now));
  assert.throws(() =>
    verifyPilotAuthorization(approval(), { ...plan, sourceFingerprint: 'different' }, now),
  );
});
