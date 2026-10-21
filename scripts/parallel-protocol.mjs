import { createHash } from 'node:crypto';
import { cases } from './parallel-evaluation-cases.mjs';

export const futureProtocols = ['controlled-fixed-v1', 'adaptive-complete-v1'].map((id) => ({
  id,
  status: 'not-authorized',
  limits: null,
  realProviderEnabled: false,
  cases: cases.map((c) => c.id),
  repetitions: null,
  order: 'counterbalanced',
  baseline: {
    id: 'codex-individual-strict',
    nativeDelegation: false,
    delegatingBaseline: 'separate-if-ever-authorized',
  },
  controls: [
    'same-base-commit',
    'same-objective',
    'same-acceptance',
    'same-permissions',
    'same-CLI-version',
    'same-subscription-guards',
    'immutable-acceptance',
    'fresh-isolated-workspaces',
    'count-failures-and-repairs',
    'unknown-usage-is-not-zero',
    'no-paid-API-or-additional-credits',
  ],
  fixed:
    id === 'controlled-fixed-v1' ? ['model', 'reasoning', 'context-variant', 'session-mode'] : [],
  adaptive:
    id === 'adaptive-complete-v1'
      ? ['chief', 'models', 'reasoning', 'specialists', 'parallelism']
      : [],
  costs: ['planning', 'preparation', 'workers', 'local-checks', 'integration', 'review', 'repairs'],
  metrics: [
    'quality',
    'policy-compliance',
    'circuit-completion',
    'defects',
    'repairs',
    'wall-ms',
    'sum-agent-ms',
    'input',
    'output',
    'cached-input',
    'uncached-input',
    'tools',
    'reads',
    'turns',
    'peak-concurrency',
  ],
  stop: [
    'unverified-subscription',
    'additional-billing',
    'unknown-usage',
    'budget-exhausted',
    'integration-conflict',
    'unverified-cleanup',
  ],
  decision:
    'No promotion without equal required quality and repeated comparable measurements. Cache is included in input, not added twice; character reuse is not session continuation.',
}));
export function verifyFutureTrial(plan, authorization, currentFingerprint, now = Date.now()) {
  const fail = () => {
    throw Object.assign(
      new Error('Se requieren un protocolo cerrado y una autorización nueva de sus límites.'),
      { code: 'new_trial_authorization_required' },
    );
  };
  if (
    !plan ||
    plan.realProviderEnabled !== true ||
    !plan.limits ||
    !futureProtocols.some((p) => p.id === plan.id)
  )
    fail();
  const { maxRuns, maxTokens, totalMs, maxParallel } = plan.limits;
  if (
    ![maxRuns, maxTokens, totalMs, maxParallel].every((n) => Number.isSafeInteger(n) && n > 0) ||
    maxRuns > 20 ||
    maxTokens > 200000 ||
    totalMs > 900000 ||
    maxParallel > 2
  )
    fail();
  if (
    plan.sourceFingerprint !== currentFingerprint ||
    !authorization ||
    authorization.approved !== true ||
    authorization.planHash !== createHash('sha256').update(JSON.stringify(plan)).digest('hex') ||
    !Number.isFinite(Date.parse(authorization.expiresAt)) ||
    Date.parse(authorization.expiresAt) <= now
  )
    fail();
  return true;
}
