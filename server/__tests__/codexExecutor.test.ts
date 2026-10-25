import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MetadataClient } from '../src/execution/cliProcess.js';
import { buildCodexArguments, CodexExecutor } from '../src/execution/codexExecutor.js';
import { ExecutionBlocked } from '../src/execution/types.js';
import { accountFixture, limitsFixture, modelsFixture } from './executionFixtures.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function harness(mode = 'success', changed?: (method: string, count: number) => unknown) {
  const root = mkdtempSync(join(tmpdir(), 'pixel-official-cli-'));
  roots.push(root);
  let requests = 0;
  let invalidate: (() => void) | undefined;
  const client: MetadataClient = {
    request: vi.fn(async (method) => {
      const replacement = changed?.(method, ++requests);
      if (replacement !== undefined) return replacement;
      if (method === 'account/read') return accountFixture();
      if (method === 'account/rateLimits/read') return limitsFixture();
      if (method === 'model/list') return modelsFixture();
      throw new Error('unexpected RPC');
    }),
    onInvalidated: (callback) => {
      invalidate = callback;
      return () => {
        invalidate = undefined;
      };
    },
    close: vi.fn(async () => {}),
  };
  const launch = vi.fn(() =>
    spawn(process.execPath, [join(__dirname, 'fixtures', 'official-codex.cjs'), mode], {
      stdio: 'pipe',
      windowsHide: true,
    }),
  );
  const executor = new CodexExecutor(root, {
    env: {},
    discover: async () => ({ executable: '/official/codex', version: '0.163.0' }),
    metadata: async () => client,
    launch,
    pollMs: 20,
  });
  return { root, executor, launch, client, invalidate: () => invalidate?.() };
}

describe('official Codex executor (fake CLI, no inference)', () => {
  it('allows the selected project folder without Git while retaining workspace permissions', () => {
    const args = buildCodexArguments(
      { project: 'C:/project', prompt: 'work', allowWrites: true },
      'gpt-6.1-sol',
      'low',
      'win32',
    );
    expect(args).toContain('--skip-git-repo-check');
    expect(args).toContain('default_permissions=":workspace"');
    expect(args).toContain('approval_policy="never"');
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
  });
  it.each([
    ['cache', 12],
    ['bad-cache', null],
    ['success', null],
  ])('records cache honestly for %s', async (mode, expected) => {
    const h = harness(mode as string);
    const result = await h.executor.execute({ project: h.root, prompt: 'test' });
    expect(result.cachedInputTokens).toBe(expected);
    expect(result.sessionMode).toBe('new');
    expect(result.cliVersion).toBe('0.163.0');
    expect(result.subscriptionCheckedAt).toBeGreaterThan(0);
  });
  it('pauses at the observed token limit without a retry', async () => {
    const h = harness();
    const result = await h.executor.execute({
      project: h.root,
      prompt: 'test',
      maxReportedTokens: 24,
    });
    expect(result.status).toBe('paused');
    expect(result.reasonCode).toBe('token_budget');
    expect(h.launch).toHaveBeenCalledTimes(1);
  });
  it('executes once with explicit provider/model/effort and persists only safe metadata', async () => {
    const h = harness();
    const output: string[] = [];
    const result = await h.executor.execute({
      project: h.root,
      prompt: 'private prompt',
      model: 'gpt-6.1-sol',
      effort: 'medium',
      officeRole: 'developer',
      onOutput: (text) => output.push(text),
    });
    expect(result.status).toBe('completed');
    expect(result.sessionId).toBe('fixture-session');
    expect(result.confirmedModel).toBeNull();
    expect(result.inputTokens).toBe(20);
    expect(result.metrics).toMatchObject({
      source: 'codex-json',
      completedToolEvents: 1,
      completedTurns: 1,
      fileReads: null,
    });
    expect(result.metrics!.submittedCharacters).toBeGreaterThan(result.metrics!.promptCharacters);
    expect(h.launch).toHaveBeenCalledTimes(1);
    expect(output).toEqual(['fixture answer']);
    const args = h.launch.mock.calls[0] as unknown[];
    expect(args[1]).toContain('forced_login_method="chatgpt"');
    expect(args[1]).toContain('model_reasoning_effort="medium"');
    const saved = readFileSync(join(h.root, result.id + '.json'), 'utf8');
    expect(JSON.parse(saved).officeRole).toBe('developer');
    for (const privateText of [
      'private prompt',
      'private tool content',
      'private diagnostic',
      'private@example.invalid',
      'fixture answer',
    ])
      expect(saved).not.toContain(privateText);
    expect(h.client.close).toHaveBeenCalledTimes(1);
  });
  it('pins isolated config, standard default speed, sandbox and no implicit multi-agent tools', () => {
    const args = buildCodexArguments(
      { project: 'a path; $(danger)', prompt: 'never in argv' },
      'gpt-6.1-sol',
      'low',
    );
    expect(args).toContain('--ignore-user-config');
    expect(args).toContain('default_permissions=":read-only"');
    expect(args).not.toContain('--sandbox');
    expect(args).toContain('model_provider="openai"');
    expect(args).toContain('mcp_servers={}');
    expect(args).toContain('features.multi_agent=false');
    expect(args).toContain('skills.max_context_tokens=1000');
    expect(args).not.toContain('never in argv');
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(
      buildCodexArguments({ project: '.', prompt: 'hi', allowWrites: true }, 'gpt-6.1-sol', 'low'),
    ).toContain('default_permissions=":workspace"');
  });
  it('enables the existing elevated Windows sandbox without disabling isolation or managed rules', () => {
    for (const allowWrites of [false, true]) {
      const args = buildCodexArguments(
        { project: '.', prompt: 'test', allowWrites },
        'gpt-6.1-sol',
        'low',
        'win32',
      );
      expect(args).toContain('windows.sandbox="elevated"');
      expect(args).toContain('shell_environment_policy.inherit="core"');
      expect(args).toContain('shell_environment_policy.ignore_default_excludes=false');
      expect(args).toContain('approval_policy="never"');
      expect(args).not.toContain('--sandbox');
      expect(args).not.toContain('--ignore-rules');
      expect(args.join(' ')).not.toContain('danger-full-access');
      expect(args.join(' ')).not.toContain('unelevated');
    }
  });
  it.each(['linux', 'darwin'] as const)(
    'does not configure a Windows sandbox on %s',
    (platform) => {
      expect(
        buildCodexArguments({ project: '.', prompt: 'test' }, 'gpt-6.1-sol', 'low', platform).join(
          ' ',
        ),
      ).not.toContain('windows.sandbox');
    },
  );
  it('blocks before launching on an API account', async () => {
    const h = harness('success', (method) =>
      method === 'account/read'
        ? { account: { type: 'apiKey' }, requiresOpenaiAuth: true }
        : undefined,
    );
    const record = await h.executor.execute({ project: h.root, prompt: 'test' });
    expect(record.status).toBe('blocked');
    expect(record.reasonCode).toBe('subscription_unverified');
    expect(h.launch).not.toHaveBeenCalled();
  });
  it('blocks unavailable models or efforts without a fallback', async () => {
    const h = harness();
    const record = await h.executor.execute({
      project: h.root,
      prompt: 'test',
      model: 'gpt-6-astra',
    });
    expect(record.reasonCode).toBe('choice_unavailable');
    expect(h.launch).not.toHaveBeenCalled();
  });
  it('pauses before launching when quota reserve is reached', async () => {
    const h = harness('success', (method) => {
      if (method !== 'account/rateLimits/read') return;
      const limits = limitsFixture();
      limits.rateLimitsByLimitId.codex.primary.usedPercent = 100;
      return limits;
    });
    const record = await h.executor.execute({ project: h.root, prompt: 'test' });
    expect(record.status).toBe('paused');
    expect(h.launch).not.toHaveBeenCalled();
  });
  it('pauses a running process if verification becomes unavailable', async () => {
    const h = harness('hang', (_method, count) => {
      if (count > 3) throw new ExecutionBlocked('quota_unknown', 'unverified');
    });
    const record = await h.executor.execute({ project: h.root, prompt: 'test' });
    expect(record.status).toBe('paused');
    expect(record.reasonCode).toBe('quota_unknown');
    expect(h.launch).toHaveBeenCalledTimes(1);
  });
  it.each(['limit', 'failed', 'bad'])('does not report success or retry on %s', async (mode) => {
    const h = harness(mode);
    const record = await h.executor.execute({ project: h.root, prompt: 'test' });
    expect(record.status).not.toBe('completed');
    expect(h.launch).toHaveBeenCalledTimes(1);
    expect(readFileSync(join(h.root, record.id + '.json'), 'utf8')).not.toContain('private');
  });
  it('cancels and kills its owned process tree', async () => {
    const h = harness('hang');
    const controller = new AbortController();
    const task = h.executor.execute({ project: h.root, prompt: 'test', signal: controller.signal });
    await vi.waitFor(() => expect(h.launch).toHaveBeenCalled());
    controller.abort();
    expect((await task).status).toBe('cancelled');
  });
  it('keeps native long work cancellable and verifies quota without installing a wall-clock cutoff', async () => {
    const h = harness('hang');
    const controller = new AbortController();
    const timer = vi.spyOn(globalThis, 'setTimeout');
    const task = h.executor.execute({
      project: h.root,
      prompt: 'long work',
      timeoutMs: null,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(h.launch).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(vi.mocked(h.client.request).mock.calls.length).toBeGreaterThan(3),
    );
    expect(timer.mock.calls.some((call) => call[1] === 900000)).toBe(false);
    controller.abort();
    expect((await task).status).toBe('cancelled');
    timer.mockRestore();
  });
  it('pauses on account change and enforces the time limit', async () => {
    const h = harness('hang');
    const task = h.executor.execute({ project: h.root, prompt: 'test' });
    await vi.waitFor(() => expect(h.launch).toHaveBeenCalled());
    h.invalidate();
    expect((await task).reasonCode).toBe('account_changed');
    expect(
      (await h.executor.execute({ project: h.root, prompt: 'test', timeoutMs: 30 })).reasonCode,
    ).toBe('time_limit');
  });
  it('rejects concurrent executions before launching a second CLI', async () => {
    const h = harness('hang');
    const first = h.executor.execute({ project: h.root, prompt: 'test', timeoutMs: 200 });
    await vi.waitFor(() => expect(h.launch).toHaveBeenCalled());
    await expect(h.executor.execute({ project: h.root, prompt: 'second' })).rejects.toThrow(
      'Ya hay una ejecución',
    );
    await first;
  });
  it('does not remove a preexisting lock or execute through it', async () => {
    const h = harness();
    writeFileSync(join(h.root, 'executor.lock'), 'existing');
    await expect(h.executor.execute({ project: h.root, prompt: 'test' })).rejects.toThrow();
    expect(h.launch).not.toHaveBeenCalled();
    expect(readFileSync(join(h.root, 'executor.lock'), 'utf8')).toBe('existing');
  });
  it('runs two isolated read-only CLI processes simultaneously and rejects a third', async () => {
    const h = harness('hang');
    const firstStop = new AbortController(),
      secondStop = new AbortController();
    const first = h.executor.execute({
      project: h.root,
      prompt: 'reader a',
      parallelReadOnly: true,
      signal: firstStop.signal,
    });
    const second = h.executor.execute({
      project: h.root,
      prompt: 'reader b',
      parallelReadOnly: true,
      signal: secondStop.signal,
    });
    try {
      await vi.waitFor(() => expect(h.launch).toHaveBeenCalledTimes(2));
      expect(h.launch.mock.results[0].value.pid).not.toBe(h.launch.mock.results[1].value.pid);
      await expect(
        h.executor.execute({ project: h.root, prompt: 'third', parallelReadOnly: true }),
      ).rejects.toMatchObject({ code: 'executor_busy' });
      await expect(
        h.executor.execute({ project: h.root, prompt: 'exclusive writer', allowWrites: true }),
      ).rejects.toMatchObject({ code: 'executor_busy' });
    } finally {
      firstStop.abort();
      secondStop.abort();
    }
    expect((await Promise.all([first, second])).map((run) => run.status)).toEqual([
      'cancelled',
      'cancelled',
    ]);
  });
  it('never allows write capability to enter a shared read slot', async () => {
    const h = harness();
    await expect(
      h.executor.execute({
        project: h.root,
        prompt: 'unsafe',
        allowWrites: true,
        parallelReadOnly: true,
      }),
    ).rejects.toMatchObject({ code: 'parallel_write_forbidden' });
    expect(h.launch).not.toHaveBeenCalled();
  });
});
