import { describe, expect, it, vi } from 'vitest';

import { ClaudeExecutor } from '../src/execution/claudeExecutor.js';
import { buildClaudeArguments } from '../src/execution/officialCliArguments.js';

describe('Claude subscription gate (no real inference)', () => {
  it('does not probe when disabled', async () => {
    const status = vi.fn();
    const executor = new ClaudeExecutor(() => false, { status });
    await expect(executor.diagnose()).rejects.toMatchObject({ code: 'claude_disabled' });
    expect(status).not.toHaveBeenCalled();
  });
  it.each(['none', 'oauth_token', 'api_key', 'api_key_helper', 'third_party', undefined])(
    'rejects unverified auth method %s',
    async (authMethod) => {
      const executor = new ClaudeExecutor(() => true, {
        status: async () => ({ loggedIn: true, authMethod }),
      });
      await expect(
        executor.execute({ project: '.', prompt: 'must not run' }),
      ).rejects.toMatchObject({ code: 'claude_subscription_unverified' });
    },
  );
  it('does not mistake personal OAuth for proof that extra usage is disabled', async () => {
    const executor = new ClaudeExecutor(() => true, {
      status: async () => ({
        loggedIn: true,
        authMethod: 'claude.ai',
        apiProvider: 'firstParty',
        subscriptionType: 'pro',
        email: 'private@example.invalid',
        extraUsage: false,
      }),
    });
    await expect(executor.execute({ project: '.', prompt: 'must not run' })).rejects.toMatchObject({
      code: 'claude_additional_usage_unverified',
    });
  });
  it('constructs the adapted CLI invocation without bypass, API or prompt in argv', () => {
    const args = buildClaudeArguments(
      { project: '.', prompt: 'private prompt' },
      'claude-model-fixture',
      'low',
    );
    expect(args).toContain('--safe-mode');
    expect(args).toContain('--strict-mcp-config');
    expect(args).toContain('Read,Glob,Grep');
    expect(args).toContain('--effort');
    expect(args).toContain('low');
    expect(args).not.toContain('--bare');
    expect(args).not.toContain('--dangerously-skip-permissions');
    expect(args).not.toContain('private prompt');
  });
  it.each([null, 'free', 'team'])(
    'does not infer a personal paid plan from a login: %s',
    async (subscriptionType) => {
      const executor = new ClaudeExecutor(() => true, {
        status: async () => ({
          loggedIn: true,
          authMethod: 'claude.ai',
          apiProvider: 'firstParty',
          subscriptionType,
        }),
      });
      await expect(executor.diagnose()).rejects.toMatchObject({
        code: 'claude_subscription_unverified',
      });
    },
  );
});
