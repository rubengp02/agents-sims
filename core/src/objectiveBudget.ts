/** Recorded consumption for one objective, including all delegated attempts. */
export interface ObjectiveUsageSummary {
  attempts: number;
  activeAttempts: number;
  unknownAttempts: number;
  /** Includes valid lower bounds from incomplete attempts; not necessarily the total. */
  knownTokens: number;
  knownDurationMs: number;
  /** Legacy totals cannot be attributed to this objective without receipts. */
  historicalUnknown: boolean;
  complete: boolean;
}

export interface ObjectiveBudgetView {
  mode: 'codex' | 'manual';
  usage: ObjectiveUsageSummary;
  pauseReason: string | null;
}

export const CODEX_QUOTA_RESERVE_PERCENT = 10;
export interface IncludedQuotaView {
  provider: 'codex' | 'claude';
  checkedAt: number | null;
  verified: boolean;
  reservePercent: number;
  windows: Array<{ id: string; usedPercent: number; resetsAt: number }>;
  reasonCode: string | null;
}

export function validObjectiveBudget(value: unknown): value is ObjectiveBudgetView {
  if (!value || typeof value !== 'object') return false;
  const budget = value as ObjectiveBudgetView;
  const usage = budget.usage;
  if (
    !['codex', 'manual'].includes(budget.mode) ||
    !usage ||
    ![
      usage.attempts,
      usage.activeAttempts,
      usage.unknownAttempts,
      usage.knownTokens,
      usage.knownDurationMs,
    ].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    usage.activeAttempts + usage.unknownAttempts > usage.attempts ||
    typeof usage.historicalUnknown !== 'boolean' ||
    usage.complete !== (!usage.activeAttempts && !usage.unknownAttempts && !usage.historicalUnknown)
  )
    return false;
  return (
    budget.pauseReason === null ||
    (typeof budget.pauseReason === 'string' && /^[\w-]{1,100}$/.test(budget.pauseReason))
  );
}
