import { CASES as ORIGINAL_CASES, fixtureFiles } from '../benchmark/cases.mjs';
import { MODEL, hash, usageTotal, comparePair } from '../benchmark/protocol.mjs';
export { MODEL, hash, usageTotal };
export const PROTOCOL_ID = 'codex-direct-vs-office-v2';
const budgets = {
  easy: [90000, 120000, 300000],
  medium: [150000, 180000, 420000],
  hard: [200000, 270000, 600000],
};
export const CASES = ORIGINAL_CASES.map((item) => {
  const [maxMethodTokens, maxMethodMs, maxMs] = budgets[item.id];
  return {
    ...item,
    limits: {
      maxRuns: item.expectedOfficeRoles.length + 1,
      maxMethodRuns: { direct: 1, office: item.expectedOfficeRoles.length },
      maxMethodTokens,
      maxMethodMs,
      maxTokens: 2 * maxMethodTokens,
      maxMs,
      minRunReserve: 20000,
    },
  };
});
export function plan() {
  return {
    id: PROTOCOL_ID,
    status: 'prepared-not-authorized',
    model: MODEL,
    claudeEnabled: false,
    antigravityConnected: false,
    maxRepairRuns: 0,
    repetitionsPerMethod: 1,
    suiteLimits: {
      maxRuns: CASES.reduce((sum, item) => sum + item.limits.maxRuns, 0),
      maxTokens: CASES.reduce((sum, item) => sum + item.limits.maxTokens, 0),
      maxMs: CASES.reduce((sum, item) => sum + item.limits.maxMs, 0) + 60000,
    },
    calibration: {
      reportedTokens: 56873,
      methodDurationMs: 28752,
      source: 'reports/comparacion-codex/easy-real.json',
      includedAsNewTrial: false,
    },
    stages: CASES.map((item) => ({
      id: item.id,
      label: item.label,
      effort: item.effort,
      order: item.order,
      officeRoles: item.expectedOfficeRoles,
      limits: item.limits,
      initialFilesHash: hash(fixtureFiles(item)),
      allowedFiles: item.files,
    })),
    fairness: [
      'equal-token-and-time-budget-per-method',
      'specialists-share-office-budget',
      'no-borrowing-from-other-method',
      'same-contract-model-effort-and-initial-files',
      'same-writer-permissions',
      'external-acceptance',
      'fresh-sessions',
      'cache-observed-not-reset',
      'no-automatic-repairs-or-increases',
    ],
    limitations: [
      'one exploratory pair per case',
      'reported tokens include cached input',
      'turn usage threshold may overshoot before reporting',
      'capacity is not a guarantee of completion',
      'calibration retained and study cost reported separately',
    ],
  };
}
export function protocolFingerprint() {
  return hash({ plan: plan(), fixtures: CASES.map((item) => fixtureFiles(item)) });
}
export function verifyAuthorization(approval, caseId, sourceFingerprint, now = Date.now()) {
  const item = CASES.find((item) => item.id === caseId);
  if (
    !item ||
    approval?.approved !== true ||
    approval.protocol !== PROTOCOL_ID ||
    approval.caseId !== caseId ||
    approval.sourceFingerprint !== sourceFingerprint ||
    approval.protocolFingerprint !== protocolFingerprint() ||
    JSON.stringify(approval.limits) !== JSON.stringify(item.limits) ||
    !approval.authorizationNote?.trim() ||
    !Number.isFinite(Date.parse(approval.expiresAt)) ||
    Date.parse(approval.expiresAt) <= now ||
    Date.parse(approval.expiresAt) > now + 86400000
  )
    throw Object.assign(new Error('Autorización vigente requerida para v2.'), {
      code: 'authorization_required',
    });
  return item;
}
export function compare(trials) {
  if (trials.some((trial) => trial.budget?.exceeded))
    return { verdict: 'budget_limited', generalImprovementProven: false };
  return comparePair(trials);
}
export function verifySuiteAuthorization(approval, sourceFingerprint, now = Date.now()) {
  if (
    approval?.approved !== true ||
    approval.protocol !== PROTOCOL_ID ||
    approval.scope !== 'all' ||
    approval.sourceFingerprint !== sourceFingerprint ||
    approval.protocolFingerprint !== protocolFingerprint() ||
    JSON.stringify(approval.limits) !== JSON.stringify(plan().suiteLimits) ||
    typeof approval.authorizationNote !== 'string' ||
    !approval.authorizationNote.trim() ||
    !Number.isFinite(Date.parse(approval.expiresAt)) ||
    Date.parse(approval.expiresAt) <= now ||
    Date.parse(approval.expiresAt) > now + 86400000
  )
    throw Object.assign(new Error('Autorización conjunta vigente requerida.'), {
      code: 'authorization_required',
    });
  return approval;
}
export async function sequenceStages({ run, ledger, save = () => {}, now = Date.now }) {
  const limits = plan().suiteLimits;
  ledger.stages ??= [];
  for (const item of CASES) {
    if (ledger.paused || ledger.closed) break;
    if (limits.maxMs - (now() - ledger.startedAt) < item.limits.maxMs) {
      ledger.paused = true;
      ledger.reason = 'suite_time_budget';
      break;
    }
    if (
      ledger.tokens + item.limits.maxTokens > limits.maxTokens ||
      ledger.attempts + item.limits.maxRuns > limits.maxRuns
    ) {
      ledger.paused = true;
      ledger.reason = 'suite_budget';
      break;
    }
    const report = await run(item);
    const known = Number.isSafeInteger(report.reportedTokens) && report.reportedTokens >= 0;
    ledger.stages.push({
      caseId: item.id,
      status: report.status,
      attempts: report.runs.length,
      reportedTokens: known ? report.reportedTokens : null,
      controlsPassed: report.controlsPassed,
      comparison: report.comparison,
    });
    ledger.attempts += report.runs.length;
    delete ledger.inFlightStage;
    if (known) ledger.tokens += report.reportedTokens;
    else {
      ledger.paused = true;
      ledger.usageUnknown = true;
      ledger.reason = 'usage_unknown';
    }
    if (report.status !== 'completed' || !report.controlsPassed) {
      ledger.paused = true;
      ledger.reason ??= report.reasonCode ?? 'stage_incomplete';
    }
    if (ledger.tokens > limits.maxTokens || ledger.attempts > limits.maxRuns) {
      ledger.paused = true;
      ledger.reason = 'suite_budget';
    }
    save();
  }
  ledger.closed = true;
  ledger.status =
    !ledger.paused &&
    ledger.stages.length === CASES.length &&
    ledger.stages.every((stage) => stage.status === 'completed' && stage.controlsPassed)
      ? 'completed'
      : 'paused';
  ledger.paused = true;
  ledger.reason ??= ledger.status === 'completed' ? 'suite_closed' : 'suite_incomplete';
  save();
  return ledger;
}
