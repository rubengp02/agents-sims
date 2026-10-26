import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AntigravityExecutor } from '../src/execution/antigravityExecutor.js';
import {
  discoverAntigravity,
  LocalAntigravityProbe,
  parseAntigravityConfig,
  parseAntigravityQuota,
  parseAvailableModels,
  runAntigravityMetadata,
} from '../src/execution/antigravityProbe.js';
import type { ExecuteOptions } from '../src/execution/types.js';

let root: string, env: NodeJS.ProcessEnv;
const catalog = 'Fetching available models...\ngemini-fixture-low\tGemini Fixture (Low)\n';
const config =
  'modelProvider\t\nuseG1Credits\tfalse\ntoolPermission\trequest-review\nallowNonWorkspaceAccess\tfalse\n';
const quota = () =>
  ['Gemini Models', 'Claude and GPT models']
    .flatMap((group) =>
      ['Weekly', 'Five Hour'].map(
        (label) =>
          group +
          '\t' +
          label +
          ' Limit Remaining\t79%\t' +
          new Date(Date.now() + 86400000).toISOString(),
      ),
    )
    .join('\n');
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agy-executor-'));
  env = { HOME: root, USERPROFILE: root, PATH: '' };
  mkdirSync(join(root, '.local', 'bin'), { recursive: true });
  writeFileSync(join(root, '.local', 'bin', process.platform === 'win32' ? 'agy.exe' : 'agy'), '');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
function metadata() {
  const runner = vi.fn(async (_exe: string, args: readonly string[]) =>
    args[0] === '--version'
      ? '1.4.7'
      : args[0] === 'models'
        ? catalog
        : args[1] === '/config'
          ? config
          : quota(),
  );
  return { runner, probe: new LocalAntigravityProbe(env, runner) };
}
async function fixtureInspection() {
  return metadata().probe.inspect();
}
type Scenario = {
  exit?: number | null;
  missing?: boolean;
  status?: string;
  usage?: Record<string, unknown>;
  hang?: boolean;
  initModel?: boolean | string;
  tool?: boolean;
  guard?: boolean;
  image?: boolean;
};
function runtime(scenarios: Scenario[] = [{}]) {
  const calls: Array<{ args: string[]; cwd: string }> = [];
  const launch = vi.fn((_runtime: unknown, args: string[], _env: unknown, cwd: string) => {
    calls.push({ args, cwd });
    const scenario = scenarios[calls.length - 1] ?? {};
    const stdout = new Readable({ read() {} }),
      stderr = new Readable({ read() {} });
    const child = Object.assign(new EventEmitter(), {
      stdout,
      stderr,
      exitCode: null as number | null,
      signalCode: null,
      pid: undefined,
    });
    const stdin = new Writable({
      write(_chunk, _enc, cb) {
        cb();
      },
      final(cb) {
        queueMicrotask(() => {
          const id = args.includes('--conversation')
            ? args[args.indexOf('--conversation') + 1]
            : 'fixture-session';
          const emit = (event: unknown) => stdout.push(JSON.stringify(event) + '\n');
          emit({
            event: 'init',
            conversation_id: id,
            init: {
              cwd,
              permission_mode: 'request-review',
              ...(scenario.initModel === false
                ? {}
                : {
                    model:
                      typeof scenario.initModel === 'string'
                        ? scenario.initModel
                        : 'gemini-fixture-low',
                  }),
            },
          });
          if (scenario.hang) {
            cb();
            return;
          }
          if (scenario.tool) {
            if (scenario.guard) {
              const f = join(cwd, 'guard-receipt.json'),
                r = JSON.parse(readFileSync(f, 'utf8'));
              writeFileSync(f, JSON.stringify({ ...r, seen: true, allowed: 1 }));
            }
            emit({
              event: 'step_update',
              step_update: {
                step_type: 'tool',
                step_index: 2,
                state: 'DONE',
                tool_name: 'call_mcp_tool',
                tool_info: scenario.image
                  ? { parameters: { ToolName: JSON.stringify('attachment_read') } }
                  : {},
              },
            });
          }
          if (!scenario.missing)
            emit({
              event: 'result',
              result: {
                conversation_id: id,
                status: scenario.status ?? 'SUCCESS',
                response: 'FIXTURE_OK',
                usage: scenario.usage ?? {
                  input_tokens: 100,
                  output_tokens: 20,
                  cache_read_tokens: 0,
                },
              },
            });
          stdout.push(null);
          cb();
          setImmediate(() => {
            child.exitCode = scenario.exit ?? 0;
            child.emit('close', scenario.exit === null ? null : child.exitCode, null);
          });
        });
      },
    });
    return Object.assign(child, {
      stdin,
      kill: () => true,
    }) as unknown as ChildProcessWithoutNullStreams;
  });
  const stop = vi.fn(async (child: ChildProcessWithoutNullStreams) => {
    child.stdout.push(null);
    child.emit('close', 1, null);
  });
  return {
    calls,
    launch,
    stop,
    discover: async () => ({ executable: 'fixture-only', version: '1.4.7' }),
    env,
  };
}
const options = (): ExecuteOptions => ({
  project: root,
  prompt: 'PRIVATE_PROMPT',
  model: 'gemini-fixture-low',
  effort: 'default',
  toolServer: { url: 'http://127.0.0.1:12345/mcp', token: 'PRIVATE_BEARER' },
});
describe('official Antigravity metadata', () => {
  it('keeps native catalog IDs and does not make up missing models', () => {
    expect(parseAvailableModels(catalog)).toEqual([
      { id: 'gemini-fixture-low', label: 'Gemini Fixture (Low)' },
    ]);
    for (const text of ['', 'auth required', '{"error":"no models"}', 'x\tX\nx\tX'])
      expect(() => parseAvailableModels(text)).toThrow();
  });
  it('checks credits and provider instead of inferring a subscription plan', async () => {
    const p = metadata(),
      inspection = await p.probe.inspect();
    expect(inspection.includedUsage).toMatchObject({ verified: true, creditsEnabled: false });
    expect(inspection).not.toHaveProperty('plan');
    expect(p.runner.mock.calls.map((c) => c[1][0])).toEqual([
      '--version',
      'models',
      '--print',
      '--print',
    ]);
    const executor = new AntigravityExecutor(root, () => true, p.probe);
    expect(await executor.diagnose()).toMatchObject({
      plan: 'google-included',
      quota: expect.any(Array),
    });
  });
  it.each([
    'useG1Credits\ttrue\nmodelProvider\t',
    config.replace('useG1Credits\tfalse', 'useG1Credits\t'),
    config.replace('modelProvider\t', 'modelProvider\tgemini'),
    config.replace('request-review', 'always-proceed'),
    config.replace('allowNonWorkspaceAccess\tfalse', 'allowNonWorkspaceAccess\ttrue'),
  ])('blocks unknown or paid configuration', (text) => {
    expect(() => parseAntigravityConfig(text)).toThrow();
  });
  it('parses remaining percentage into used percentage and preserves seconds', () => {
    const windows = parseAntigravityQuota(quota());
    expect(windows).toHaveLength(4);
    expect(windows[0].usedPercent).toBe(21);
    expect(windows[0].resetsAt).toBeLessThan(100000000000);
  });
  it.each([
    '',
    'Gemini Models\tWeekly Limit Remaining\t79%\t2099-01-01T00:00:00Z',
    'Gemini Models\tWeekly Limit Remaining\t101%\t2099-01-01T00:00:00Z',
    'Gemini Models\tWeekly Limit Remaining\t79%\t2000-01-01T00:00:00Z',
  ])('rejects incomplete or invalid quota', (text) => {
    expect(() => parseAntigravityQuota(text)).toThrow();
  });
  it('blocks API environment, missing CLI and invalid versions without real discovery', async () => {
    const p = metadata();
    await expect(
      new LocalAntigravityProbe({ ...env, GEMINI_API_KEY: 'fixture' }, p.runner).inspect(),
    ).rejects.toMatchObject({ code: 'payment_environment' });
    expect(p.runner).not.toHaveBeenCalled();
    await expect(
      discoverAntigravity(
        { ...env, HOME: join(root, 'missing'), USERPROFILE: join(root, 'missing') },
        p.runner,
      ),
    ).rejects.toMatchObject({ code: 'antigravity_missing' });
    await expect(discoverAntigravity(env, async () => '')).rejects.toMatchObject({
      code: 'antigravity_version_unverified',
    });
  });
  it('does not permit prompts through the metadata runner', async () => {
    await expect(
      runAntigravityMetadata('unused', ['--print', 'send anything'], env),
    ).rejects.toMatchObject({ code: 'antigravity_metadata_forbidden' });
  });
  it('never substitutes default models on command failure', async () => {
    const p = metadata();
    const failed = await new LocalAntigravityProbe(env, async (exe, args) => {
      if (args[0] === 'models') throw new Error('PRIVATE_ERROR');
      return p.runner(exe, args);
    }).inspect();
    expect(failed.models).toEqual([]);
    expect(JSON.stringify(failed)).not.toContain('PRIVATE_ERROR');
  });
});
describe('guarded Antigravity execution', () => {
  it('rejects an explicitly acknowledged model different from the verified selection', async () => {
    const executor = new AntigravityExecutor(
      root,
      () => true,
      metadata().probe,
      runtime([{ initModel: 'unexpected-model' }]),
    );
    expect(await executor.execute(options())).toMatchObject({
      status: 'failed',
      reasonCode: 'antigravity_protocol_invalid',
      confirmedModel: null,
    });
  });
  it('checks workspace-scoped billing before launching and revokes its private bearer on refusal', async () => {
    const inspection = await fixtureInspection(),
      changed = structuredClone(inspection);
    changed.includedUsage!.verified = false;
    const inspect = vi.fn().mockResolvedValueOnce(inspection).mockResolvedValueOnce(changed);
    const r = runtime(),
      executor = new AntigravityExecutor(root, () => true, { inspect }, r);
    await expect(executor.execute(options())).rejects.toMatchObject({
      code: 'antigravity_billing_unverified',
    });
    expect(r.launch).not.toHaveBeenCalled();
    const cwd = inspect.mock.calls[1][0];
    expect(cwd).not.toBe(root);
    expect(readFileSync(join(cwd, '.agents', 'mcp_config.json'), 'utf8')).not.toContain(
      'PRIVATE_BEARER',
    );
    // A refused preflight must not retain the global writer lease.
    expect(
      (await new AntigravityExecutor(root, () => true, metadata().probe, r).execute(options()))
        .status,
    ).toBe('completed');
  });
  it('blocks a CLI replacement between diagnosis and launch', async () => {
    const r = runtime();
    r.discover = async () => ({ executable: 'fixture-only', version: '9.9.9' });
    const executor = new AntigravityExecutor(root, () => true, metadata().probe, r);
    await expect(executor.execute(options())).rejects.toMatchObject({
      code: 'antigravity_version_changed',
    });
    expect(r.launch).not.toHaveBeenCalled();
  });
  it('keeps final billed usage on failed delivery without reporting success', async () => {
    const executor = new AntigravityExecutor(
      root,
      () => true,
      metadata().probe,
      runtime([{ status: 'ERROR' }]),
    );
    expect(await executor.execute(options())).toMatchObject({
      status: 'failed',
      inputTokens: 100,
      outputTokens: 20,
    });
  });
  it('requires image inspection and decodes the real nested MCP tool name', async () => {
    const inspected = vi.fn();
    const good = new AntigravityExecutor(
      root,
      () => true,
      metadata().probe,
      runtime([{ tool: true, guard: true, image: true }]),
    );
    expect(
      (
        await good.execute({
          ...options(),
          imagePaths: ['bound-image'],
          onCapabilityVerified: inspected,
        })
      ).status,
    ).toBe('completed');
    expect(inspected).toHaveBeenCalledWith('images');
    const bad = new AntigravityExecutor(root, () => true, metadata().probe, runtime());
    expect(await bad.execute({ ...options(), imagePaths: ['bound-image'] })).toMatchObject({
      status: 'blocked',
      reasonCode: 'antigravity_image_not_inspected',
    });
  });
  it('stops on timeout and on a subsequent quota failure', async () => {
    const r = runtime([{ hang: true }]);
    const executor = new AntigravityExecutor(root, () => true, metadata().probe, r);
    expect(await executor.execute({ ...options(), timeoutMs: 10 })).toMatchObject({
      status: 'paused',
      reasonCode: 'time_limit',
      inputTokens: null,
    });
    const inspection = await fixtureInspection();
    const inspect = vi
      .fn()
      .mockResolvedValueOnce(inspection)
      .mockResolvedValueOnce(inspection)
      .mockImplementation(async () => {
        const changed = structuredClone(inspection);
        changed.includedUsage!.creditsEnabled = true;
        return changed;
      });
    const polling = runtime([{ hang: true }]);
    const second = new AntigravityExecutor(
      root,
      () => true,
      { inspect },
      { ...polling, pollMs: 5 },
    );
    expect(await second.execute(options())).toMatchObject({
      status: 'paused',
      reasonCode: 'antigravity_billing_unverified',
      inputTokens: null,
    });
    expect(polling.stop).toHaveBeenCalledOnce();
  });
  it('launches from its private directory, sends no prompt or permission bypass through argv and leaves a truthful private receipt', async () => {
    const r = runtime([{}]),
      executor = new AntigravityExecutor(root, () => true, metadata().probe, r);
    const record = await executor.execute(options());
    expect(record).toMatchObject({
      status: 'completed',
      inputTokens: 100,
      outputTokens: 20,
      confirmedModel: 'gemini-fixture-low',
    });
    expect(executor.executionEvidence).toBe('simulated');
    expect(r.calls[0].cwd).not.toBe(root);
    expect(r.calls[0].args.join(' ')).not.toContain('PRIVATE_PROMPT');
    expect(r.calls[0].args).not.toContain('--dangerously-skip-permissions');
    const receipt = readFileSync(join(root, record.id + '.json'), 'utf8');
    expect(receipt).not.toContain('PRIVATE_BEARER');
    expect(receipt).not.toContain('PRIVATE_PROMPT');
  });
  it.each([{ missing: true }, { exit: 1 }, { exit: null }, { status: 'ERROR' }])(
    'never treats process exit as a successful final delivery: %j',
    async (scenario) => {
      const executor = new AntigravityExecutor(
        root,
        () => true,
        metadata().probe,
        runtime([scenario]),
      );
      expect((await executor.execute(options())).status).toBe('failed');
    },
  );
  it('preserves unknown usage and unacknowledged models', async () => {
    const executor = new AntigravityExecutor(
      root,
      () => true,
      metadata().probe,
      runtime([{ usage: {}, initModel: false }]),
    );
    expect(await executor.execute(options())).toMatchObject({
      status: 'paused',
      reasonCode: 'usage_unknown',
      inputTokens: null,
      confirmedModel: null,
    });
  });
  it('rejects tools when the native permission hook was not evidenced', async () => {
    const bad = new AntigravityExecutor(
      root,
      () => true,
      metadata().probe,
      runtime([{ tool: true }]),
    );
    expect(await bad.execute(options())).toMatchObject({
      status: 'failed',
      reasonCode: 'antigravity_guard_unverified',
    });
    const good = new AntigravityExecutor(
      root,
      () => true,
      metadata().probe,
      runtime([{ tool: true, guard: true }]),
    );
    expect((await good.execute(options())).status).toBe('completed');
  });
  it('resumes only the Chief of the same objective and accounts for per-turn consumption', async () => {
    const r = runtime([
      {},
      { usage: { input_tokens: 160, output_tokens: 28, cache_read_tokens: 0 } },
      {},
    ]);
    const executor = new AntigravityExecutor(root, () => true, metadata().probe, r);
    const first = await executor.execute({
      ...options(),
      officeRole: 'chief',
      objectiveSessionKey: 'same',
    });
    const second = await executor.execute({
      ...options(),
      officeRole: 'chief',
      objectiveSessionKey: 'same',
    });
    expect(second).toMatchObject({
      sessionMode: 'resume',
      sessionId: first.sessionId,
      inputTokens: 60,
      outputTokens: 8,
    });
    await executor.execute({ ...options(), officeRole: 'tester', objectiveSessionKey: 'same' });
    expect(r.calls[2].args).not.toContain('--conversation');
    executor.releaseObjectiveSession('same');
  });
  it('does not reuse context across objectives or after release', async () => {
    const r = runtime([{}, {}, {}]),
      executor = new AntigravityExecutor(root, () => true, metadata().probe, r);
    await executor.execute({ ...options(), officeRole: 'chief', objectiveSessionKey: 'a' });
    await executor.execute({ ...options(), officeRole: 'chief', objectiveSessionKey: 'b' });
    executor.releaseObjectiveSession('a');
    await executor.execute({ ...options(), officeRole: 'chief', objectiveSessionKey: 'a' });
    expect(r.calls.every((call) => !call.args.includes('--conversation'))).toBe(true);
  });
  it('honors token budgets and cancellation without killing real PIDs', async () => {
    const r = runtime([{}]),
      executor = new AntigravityExecutor(root, () => true, metadata().probe, r);
    expect(await executor.execute({ ...options(), maxReportedTokens: 110 })).toMatchObject({
      status: 'paused',
      reasonCode: 'token_budget',
    });
    const waiting = runtime([{ hang: true }]),
      second = new AntigravityExecutor(root, () => true, metadata().probe, waiting);
    const abort = new AbortController();
    const pending = second.execute({ ...options(), signal: abort.signal });
    while (!waiting.calls.length) await new Promise((resolve) => setTimeout(resolve, 1));
    abort.abort();
    expect(await pending).toMatchObject({ status: 'cancelled' });
    expect(waiting.stop).toHaveBeenCalledOnce();
  });
  it('does not launch cancelled, disabled, out-of-quota or missing-tool requests', async () => {
    const p = metadata(),
      r = runtime();
    const disabled = new AntigravityExecutor(root, () => false, p.probe, r);
    await expect(disabled.execute(options())).rejects.toMatchObject({
      code: 'antigravity_disabled',
    });
    const abort = new AbortController();
    abort.abort();
    await expect(
      new AntigravityExecutor(root, () => true, p.probe, r).execute({
        ...options(),
        signal: abort.signal,
      }),
    ).rejects.toMatchObject({ code: 'user_cancelled' });
    const inspection = await fixtureInspection();
    inspection.includedUsage!.windows[0].usedPercent = 91;
    const executor = new AntigravityExecutor(
      root,
      () => true,
      { inspect: async () => inspection },
      r,
    );
    await expect(executor.execute(options())).rejects.toMatchObject({ code: 'quota_reserve' });
    await expect(executor.execute({ ...options(), toolServer: undefined })).rejects.toMatchObject({
      code: 'antigravity_tools_required',
    });
    expect(r.launch).not.toHaveBeenCalled();
  });
});
