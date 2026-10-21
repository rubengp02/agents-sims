import { describe, expect, it } from 'vitest';

import { parseExecutionArgs } from '../src/execution/cli.js';
import { compatibleVersion } from '../src/execution/cliProcess.js';
import { DisabledExecutor } from '../src/execution/optionalExecutors.js';
import {
  assertNoPaymentEnvironment,
  safeCliEnvironment,
  verifyChoice,
  verifySubscription,
} from '../src/execution/subscriptionPolicy.js';
import { accountFixture, limitsFixture, modelsFixture } from './executionFixtures.js';

describe('subscription-only policy (offline)', () => {
  it('admits a verified personal subscription and preserves supported choices', () => {
    const evidence = verifySubscription(accountFixture(), limitsFixture(), modelsFixture());
    expect(evidence.plan).toBe('plus');
    expect(evidence).not.toHaveProperty('email');
    expect(() => verifyChoice(evidence, 'gpt-6.1-sol', 'low')).not.toThrow();
    expect(() => verifyChoice(evidence, 'unavailable', 'low')).toThrow();
    expect(() => verifyChoice(evidence, 'gpt-6.1-sol', 'ultra')).toThrow();
  });

  it.each(['apiKey', 'amazonBedrock', null, 'agentIdentity'])('rejects auth %s', (type) => {
    expect(() =>
      verifySubscription(
        { account: { type, planType: 'plus' }, requiresOpenaiAuth: true },
        limitsFixture(),
        modelsFixture(),
      ),
    ).toThrow();
  });
  it.each(['business', 'enterprise', 'free', 'unknown', null])(
    'rejects plan %s without proving included usage',
    (planType) => {
      expect(() =>
        verifySubscription(
          { ...accountFixture(), account: { type: 'chatgpt', planType } },
          limitsFixture(),
          modelsFixture(),
        ),
      ).toThrow();
    },
  );
  it('rejects a provider that does not require OpenAI authentication', () => {
    expect(() =>
      verifySubscription(
        { ...accountFixture(), requiresOpenaiAuth: false },
        limitsFixture(),
        modelsFixture(),
      ),
    ).toThrow();
  });
  it.each([
    {},
    { hasCredits: false, unlimited: false },
    { hasCredits: true, unlimited: false, balance: '1' },
    { hasCredits: false, unlimited: true, balance: '0' },
    { hasCredits: false, unlimited: false, balance: null },
    { hasCredits: false, unlimited: false, balance: false },
    { hasCredits: false, unlimited: false, balance: '' },
  ])('rejects additional usage or unknown credit data %j', (credits) => {
    const limits = limitsFixture();
    Object.assign(limits.rateLimitsByLimitId.codex, { credits });
    expect(() => verifySubscription(accountFixture(), limits, modelsFixture())).toThrow();
  });
  it.each([90, 100, -1, NaN, Infinity, '20', null])(
    'rejects unsafe or unknown quota %s',
    (usedPercent) => {
      const limits = limitsFixture();
      Object.assign(limits.rateLimitsByLimitId.codex.primary, { usedPercent });
      expect(() => verifySubscription(accountFixture(), limits, modelsFixture())).toThrow();
    },
  );
  it('rejects expired quota, reached limits, absent windows and mismatching plans', () => {
    for (const mutate of [
      (value: ReturnType<typeof limitsFixture>) => {
        value.rateLimitsByLimitId.codex.primary.resetsAt = 1;
      },
      (value: ReturnType<typeof limitsFixture>) => {
        Object.assign(value.rateLimitsByLimitId.codex, { rateLimitReachedType: 'limit' });
      },
      (value: ReturnType<typeof limitsFixture>) => {
        Object.assign(value.rateLimitsByLimitId.codex, { primary: null });
      },
      (value: ReturnType<typeof limitsFixture>) => {
        value.rateLimitsByLimitId.codex.planType = 'pro';
      },
    ]) {
      const limits = limitsFixture();
      mutate(limits);
      expect(() => verifySubscription(accountFixture(), limits, modelsFixture())).toThrow();
    }
  });
  it('rejects partially fetched or empty catalogs and missing quota', () => {
    expect(() => verifySubscription(accountFixture(), {}, modelsFixture())).toThrow();
    expect(() =>
      verifySubscription(accountFixture(), limitsFixture(), {
        ...modelsFixture(),
        nextCursor: 'more',
      }),
    ).toThrow();
    expect(() => verifySubscription(accountFixture(), limitsFixture(), {})).toThrow();
  });
  it.each([
    'OPENAI_API_KEY',
    'CODEX_API_KEY',
    'OPENAI_BASE_URL',
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CODE_USE_VERTEX',
    'GEMINI_API_KEY',
    'AWS_ACCESS_KEY_ID',
    'ACCESS_TOKEN',
  ])('blocks payment environment %s without disclosing its value', (key) => {
    expect(() => assertNoPaymentEnvironment({ [key]: 'private-value' })).toThrow();
    try {
      assertNoPaymentEnvironment({ [key]: 'private-value' });
    } catch (error) {
      expect(String(error)).not.toContain('private-value');
    }
  });
  it('forwards only essential environment names and no arbitrary secrets', () => {
    expect(
      safeCliEnvironment({
        PATH: '/bin',
        USERPROFILE: '/user',
        NODE_OPTIONS: 'danger',
        SECRET: 'private',
      }),
    ).toEqual({ PATH: '/bin', USERPROFILE: '/user' });
    const env: NodeJS.ProcessEnv = { PATH: '/bin' };
    Object.defineProperty(env, 'PRIVATE_TOKEN', {
      enumerable: true,
      get() {
        throw new Error('A secret must never even be read');
      },
    });
    expect(safeCliEnvironment(env)).toEqual({ PATH: '/bin' });
  });
  it('requires a CLI version supporting isolated execution', () => {
    expect(compatibleVersion('0.154.0')).toBe(false);
    expect(compatibleVersion('0.163.0-alpha.10.2')).toBe(true);
    expect(compatibleVersion('not-codex')).toBe(false);
  });
  it('validates CLI arguments without shell parsing or undocumented overrides', () => {
    expect(parseExecutionArgs(['run', '--task-file', 'a file.txt', '--write']).flags).toEqual({
      '--task-file': 'a file.txt',
      '--write': true,
    });
    for (const args of [
      ['bad'],
      ['run', '--api-key', 'private'],
      ['run', '--model'],
      ['run', '--write', '--write'],
    ])
      expect(() => parseExecutionArgs(args)).toThrow();
  });
  it.each(['claude', 'antigravity'] as const)('never executes disabled %s', async (provider) => {
    await expect(new DisabledExecutor(provider).diagnose()).rejects.toThrow();
    await expect(
      new DisabledExecutor(provider).execute({ project: '.', prompt: 'hello' }),
    ).rejects.toThrow();
  });
});
