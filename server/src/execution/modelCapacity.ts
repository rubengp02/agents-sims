import type { TeamChoice, TeamTask } from '../../../core/src/team.js';
import { object } from './subscriptionPolicy.js';
import { assessTask } from './taskAssessment.js';
import type { SubscriptionEvidence } from './types.js';

export interface ProviderWait {
  kind: 'capacity' | 'rate-limit' | 'retry';
  retryAfterMs?: number;
}

/** Only provider error fields, never model output, can confirm capacity. */
export function providerError(error: unknown): ProviderWait | undefined {
  const value = object(error);
  const info = value.codexErrorInfo;
  if (
    ['usageLimitExceeded', 'unauthorized', 'cyberPolicy', 'misalignmentPolicyViolation'].includes(
      String(info),
    )
  )
    return undefined;
  if (
    info === 'serverOverloaded' ||
    value.code === 'server_is_overloaded' ||
    /^Selected model is at capacity\. Please try a different model\.?$/.test(
      String(value.message ?? ''),
    ) ||
    /^Codex is at capacity, please try again later\.?$/.test(String(value.message ?? ''))
  )
    return { kind: 'capacity' };
  const http = object(info);
  if (
    info === 'rateLimitExceeded' ||
    value.code === 'turn_rate_limit_exceeded' ||
    [
      'httpConnectionFailed',
      'responseTooManyFailedAttempts',
      'responseStreamDisconnected',
      'responseStreamConnectionFailed',
    ].some((key) => object(http[key]).httpStatusCode === 429) ||
    /\b429 Too Many Requests\b/.test(String(value.message ?? ''))
  )
    return { kind: 'rate-limit' };
  return undefined;
}

/** Extract fixed categories from native diagnostic lines, never retain raw stderr. */
export function nativeRetry(line: string): ProviderWait | undefined {
  if (!line.includes('codex_core::responses_retry') || !/retrying|waiting to retry/.test(line))
    return undefined;
  const seconds = line.match(/\bin ([0-9]+(?:\.[0-9]+)?)s\)/)?.[1];
  const retryAfterMs = seconds === undefined ? undefined : Math.ceil(Number(seconds) * 1000);
  return {
    kind: /\b429 Too Many Requests\b/.test(line) ? 'rate-limit' : 'retry',
    ...(retryAfterMs !== undefined &&
    Number.isSafeInteger(retryAfterMs) &&
    retryAfterMs <= 86_400_000
      ? { retryAfterMs }
      : {}),
  };
}

// Office preference order, not a claim that model quality is universally ordered.
export const CAPACITY_MODEL_ORDER = [
  'gpt-6-astra',
  'gpt-6.1-sol',
  'gpt-6-sol',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-6-luna',
  'gpt-5.6-luna',
] as const;

export function lowerCapacityModel(
  task: Pick<TeamTask, 'role' | 'prompt' | 'assessment' | 'context' | 'reviewMode'>,
  choice: TeamChoice,
  evidence: SubscriptionEvidence,
  needsImages: boolean,
): TeamChoice | undefined {
  if (choice.provider !== 'codex' || !['plus', 'pro'].includes(evidence.plan)) return undefined;
  const index = CAPACITY_MODEL_ORDER.indexOf(choice.model as (typeof CAPACITY_MODEL_ORDER)[number]);
  if (index < 0) return undefined;
  const next = CAPACITY_MODEL_ORDER.slice(index + 1).find((id) =>
    evidence.models.some((m) => m.id === id),
  );
  if (!next) return undefined;
  const model = evidence.models.find((m) => m.id === next)!;
  // Do not skip an unsuitable adjacent model or silently lower its reasoning.
  if (
    !model.efforts.includes(choice.effort) ||
    (needsImages && !model.inputModalities?.includes('image'))
  )
    return undefined;
  const informational =
    assessTask(task.context?.objective ?? task.prompt, task.assessment).difficulty === 'simple';
  if (
    next.includes('luna') &&
    (!informational || task.role === 'tester' || task.reviewMode === 'deep')
  )
    return undefined;
  return { provider: 'codex', model: next, effort: choice.effort };
}
