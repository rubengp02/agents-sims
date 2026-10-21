import { createHash } from 'node:crypto';
import { CASES, fixtureFiles } from './cases.mjs';

export const PROTOCOL_ID = 'codex-direct-vs-office-v1';
export const MODEL = 'gpt-6.1-sol';
export function plan() {
  return {
    id: PROTOCOL_ID,
    status: 'prepared-not-authorized',
    model: MODEL,
    provider: 'codex',
    claudeEnabled: false,
    antigravityConnected: false,
    maxRepairRuns: 0,
    repetitionsPerMethod: 1,
    stages: CASES.map((item) => ({
      id: item.id,
      label: item.label,
      effort: item.effort,
      order: item.order,
      officeRoles: item.expectedOfficeRoles,
      limits: item.limits,
      initialFilesHash: hash(fixtureFiles(item)),
      allowedFiles: item.files,
      assessment: item.assessment,
    })),
    controls: [
      'identical-initial-files',
      'same-full-contract-and-public-tests',
      'same-model-and-effort-within-case',
      'same-writer-sandbox',
      'reviewers-read-only',
      'official-subscription-check-per-CLI-run',
      'fresh-session-per-role',
      'external-identical-acceptance',
      'count-all-calls-including-failures',
      'no-automatic-repairs-or-budget-increases',
    ],
    limitations: [
      'one observation per method and difficulty is exploratory',
      'cache observed; not forced cold',
      'order alternates across cases, not repeated within a case',
      'no subscription-quota conversion from tokens',
      'synthetic code fixtures; no claim about all real projects',
      'external tests are not a secrecy boundary',
    ],
  };
}
export function hash(value) {
  return createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');
}
export function protocolFingerprint() {
  return hash({ plan: plan(), fixtures: CASES.map((item) => fixtureFiles(item)) });
}
export function gate(ledger, limits, now = Date.now()) {
  if (ledger.paused) return 'paused';
  if (
    !Number.isSafeInteger(ledger.attempts) ||
    ledger.attempts < 0 ||
    !Number.isSafeInteger(ledger.tokens) ||
    ledger.tokens < 0
  )
    return 'usage_unknown';
  if (ledger.attempts >= limits.maxRuns) return 'run_budget';
  if (now - ledger.startedAt >= limits.maxMs) return 'time_budget';
  if (ledger.tokens + limits.reservePerRun > limits.maxTokens) return 'token_budget';
  return null;
}
export function verifyAuthorization(approval, caseId, sourceFingerprint, now = Date.now()) {
  const item = CASES.find((item) => item.id === caseId);
  if (
    !item ||
    approval?.approved !== true ||
    approval.protocol !== PROTOCOL_ID ||
    approval.caseId !== caseId ||
    approval.protocolFingerprint !== protocolFingerprint() ||
    approval.sourceFingerprint !== sourceFingerprint ||
    JSON.stringify(approval.limits) !== JSON.stringify(item.limits) ||
    typeof approval.authorizationNote !== 'string' ||
    !approval.authorizationNote.trim() ||
    !Number.isFinite(Date.parse(approval.expiresAt)) ||
    Date.parse(approval.expiresAt) <= now ||
    Date.parse(approval.expiresAt) > now + 24 * 60 * 60_000
  )
    throw Object.assign(
      new Error('Falta autorización explícita vigente para esta etapa y sus límites exactos.'),
      { code: 'authorization_required' },
    );
  return item;
}
export function usageTotal(records, key) {
  return records.length &&
    records.every((record) => Number.isSafeInteger(record[key]) && record[key] >= 0)
    ? records.reduce((sum, record) => sum + record[key], 0)
    : null;
}
export function comparePair(trials) {
  const direct = trials.find((trial) => trial.method === 'direct'),
    office = trials.find((trial) => trial.method === 'office');
  if (!direct || !office) return { verdict: 'incomplete', generalImprovementProven: false };
  if (!direct.quality.passed || !office.quality.passed)
    return {
      verdict:
        direct.quality.passed !== office.quality.passed
          ? 'quality_difference_observed'
          : 'both_failed',
      generalImprovementProven: false,
    };
  if (
    direct.inputTokens === null ||
    direct.outputTokens === null ||
    office.inputTokens === null ||
    office.outputTokens === null
  )
    return { verdict: 'usage_unknown', generalImprovementProven: false };
  const tokenDelta =
      office.inputTokens + office.outputTokens - (direct.inputTokens + direct.outputTokens),
    timeDelta = office.totalDurationMs - direct.totalDurationMs;
  return {
    verdict:
      tokenDelta <= 0 && timeDelta <= 0 && (tokenDelta < 0 || timeDelta < 0)
        ? 'office_candidate'
        : tokenDelta >= 0 && timeDelta >= 0 && (tokenDelta > 0 || timeDelta > 0)
          ? 'direct_candidate'
          : 'tradeoff_or_tie',
    tokenDelta,
    timeDeltaMs: timeDelta,
    generalImprovementProven: false,
  };
}
