import { describe, expect, it } from 'vitest';

import { lowerCapacityModel, nativeRetry, providerError } from '../src/execution/modelCapacity.js';
import type { SubscriptionEvidence } from '../src/execution/types.js';

const task = { role: 'tester' as const, prompt: 'Revisa el contrato y las pruebas.' };
const choice = { provider: 'codex' as const, model: 'gpt-6.1-sol', effort: 'medium' };
const evidence: SubscriptionEvidence = {
  checkedAt: 1,
  plan: 'plus',
  quota: [],
  models: [
    { id: 'gpt-6.1-sol', efforts: ['medium'] },
    { id: 'gpt-6-sol', efforts: ['medium'], inputModalities: ['text', 'image'] },
    { id: 'gpt-5.6-sol', efforts: ['medium'] },
  ],
};
describe('confirmed capacity policy', () => {
  it.each([
    { codexErrorInfo: 'serverOverloaded' },
    { code: 'server_is_overloaded' },
    { message: 'Selected model is at capacity. Please try a different model.' },
  ])('recognizes an official capacity error %j', (error) => {
    expect(providerError(error)?.kind).toBe('capacity');
  });
  it('never equates generic HTTP 429 or turn rate limits with capacity', () => {
    expect(
      providerError({ codexErrorInfo: { responseTooManyFailedAttempts: { httpStatusCode: 429 } } })
        ?.kind,
    ).toBe('rate-limit');
    expect(providerError({ code: 'turn_rate_limit_exceeded' })?.kind).toBe('rate-limit');
    expect(
      providerError({
        codexErrorInfo: 'usageLimitExceeded',
        message: 'Codex is at capacity, please try again later',
      }),
    ).toBeUndefined();
    expect(providerError({ message: 'Change the model, PRIVATE TOKEN' })).toBeUndefined();
  });
  it('extracts only safe native retry metadata, including fragmented transport input upstream', () => {
    const wait = nativeRetry(
      'WARN codex_core::responses_retry: stream disconnected - retrying sampling request (1/5 in 406.9998307s)... PRIVATE_TOKEN sampling_error=exceeded retry limit, last status: 429 Too Many Requests',
    );
    expect(wait).toEqual({ kind: 'rate-limit', retryAfterMs: 407000 });
    expect(JSON.stringify(wait)).not.toContain('PRIVATE');
    expect(nativeRetry('tool output: 429 Too Many Requests')).toBeUndefined();
  });
  it('chooses only the next available lower model and preserves effort and vision', () => {
    expect(lowerCapacityModel(task, choice, evidence, true)).toEqual({
      ...choice,
      model: 'gpt-6-sol',
    });
    expect(
      lowerCapacityModel(
        task,
        choice,
        { ...evidence, models: evidence.models.filter((m) => m.id !== 'gpt-6-sol') },
        false,
      )?.model,
    ).toBe('gpt-5.6-sol');
  });
  it('does not skip an adjacent unsuitable model or promote to a stronger one', () => {
    const mismatch = {
      ...evidence,
      models: evidence.models.map((m) => (m.id === 'gpt-6-sol' ? { ...m, efforts: ['low'] } : m)),
    };
    expect(lowerCapacityModel(task, choice, mismatch, false)).toBeUndefined();
    expect(
      lowerCapacityModel(task, { ...choice, model: 'unknown' }, evidence, false),
    ).toBeUndefined();
    expect(
      lowerCapacityModel(task, choice, { ...evidence, plan: 'google-included' }, false),
    ).toBeUndefined();
  });
  it('does not silently give code, risk or independent review to Luna', () => {
    const catalog = { ...evidence, models: [{ id: 'gpt-6-luna', efforts: ['medium'] }] };
    expect(lowerCapacityModel(task, choice, catalog, false)).toBeUndefined();
    expect(
      lowerCapacityModel(
        { role: 'developer', prompt: 'Implementa autenticación.' },
        choice,
        catalog,
        false,
      ),
    ).toBeUndefined();
    expect(
      lowerCapacityModel(
        { role: 'chief', prompt: 'Resume brevemente este texto.' },
        choice,
        catalog,
        false,
      )?.model,
    ).toBe('gpt-6-luna');
    expect(
      lowerCapacityModel(
        task,
        choice,
        { ...evidence, models: [{ id: 'gpt-6-sol', efforts: ['medium'] }] },
        true,
      ),
    ).toBeUndefined();
  });
});
