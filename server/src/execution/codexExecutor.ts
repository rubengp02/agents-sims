import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import {
  type CliRuntime,
  CodexMetadataClient,
  discoverCodex,
  type MetadataClient,
  stopProcess,
} from './cliProcess.js';
import { acquireCodexLease } from './executionLease.js';
import { cliMetricsObserver, createExecutionMetrics } from './executionMetrics.js';
import {
  object,
  safeCliEnvironment,
  verifyChoice,
  verifySubscription,
} from './subscriptionPolicy.js';
import {
  type ExecuteOptions,
  ExecutionBlocked,
  type OfficialExecutor,
  type RunRecord,
  type SubscriptionEvidence,
} from './types.js';

export const CODEX_TASK_PREFIX =
  'Cumple las instrucciones del proyecto. No hagas commits, push ni cambios de rama. No uses APIs de pago, créditos, recargas ni credenciales. No inicies CLIs de IA, subagentes ni proveedores por tu cuenta. Las asignaciones del Jefe al equipo mediante el contrato de la oficina están autorizadas y las ejecuta el servidor con sus controles.\n\n';

export function buildCodexArguments(
  options: ExecuteOptions,
  model: string,
  effort: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  return [
    'exec',
    '--ignore-user-config',
    '--json',
    '--skip-git-repo-check',
    '--color',
    'never',
    '--cd',
    options.project,
    '--model',
    model,
    ...[
      'model_provider="openai"',
      'forced_login_method="chatgpt"',
      'model_providers={}',
      'mcp_servers={}',
      'apps={}',
      'features.apps=false',
      'features.plugins=false',
      'features.multi_agent=false',
      'features.image_generation=false',
      'web_search="disabled"',
      'skills.max_context_tokens=1000',
      // Use the native permission-profile contract. Do not mix it with legacy
      // --sandbox/sandbox_mode: recent exec runtimes can otherwise use read-only.
      `default_permissions="${options.allowWrites ? ':workspace' : ':read-only'}"`,
      ...(platform === 'win32' ? ['windows.sandbox="elevated"'] : []),
      // The parent environment is already allowlisted; core preserves PATH and
      // Windows essentials needed to run local project tools such as Node.
      'shell_environment_policy.inherit="core"',
      'shell_environment_policy.ignore_default_excludes=false',
      'approval_policy="never"',
      `model_reasoning_effort=${JSON.stringify(effort)}`,
    ].flatMap((value) => ['-c', value]),
    '-',
  ];
}

interface Dependencies {
  discover?: () => Promise<CliRuntime>;
  metadata?: (runtime: CliRuntime) => Promise<MetadataClient>;
  launch?: (
    runtime: CliRuntime,
    args: string[],
    env: NodeJS.ProcessEnv,
  ) => ChildProcessWithoutNullStreams;
  pollMs?: number;
  env?: NodeJS.ProcessEnv;
}

/** Two independent readers or one exclusive run; no account/payment fallback. */
export class CodexExecutor implements OfficialExecutor {
  readonly engine = 'codex-cli' as const;
  readonly provider = 'codex' as const;
  readonly maxConcurrentReadOnly = 2 as const;
  private readonly env: NodeJS.ProcessEnv;

  constructor(
    private readonly stateDir: string,
    private readonly dependencies: Dependencies = {},
  ) {
    this.env = dependencies.env ?? process.env;
  }

  private async connect(): Promise<{ runtime: CliRuntime; client: MetadataClient }> {
    safeCliEnvironment(this.env);
    const runtime = await (this.dependencies.discover?.() ?? discoverCodex(this.env));
    if (this.dependencies.metadata)
      return { runtime, client: await this.dependencies.metadata(runtime) };
    const client = new CodexMetadataClient(runtime, this.env);
    try {
      await client.initialize();
      return { runtime, client };
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  private async evidence(client: MetadataClient): Promise<SubscriptionEvidence> {
    const start = Date.now();
    const [account, limits, models] = await Promise.all([
      client.request('account/read', { refreshToken: false }),
      client.request('account/rateLimits/read'),
      client.request('model/list', { limit: 100, includeHidden: false }),
    ]);
    if (Date.now() - start > 15_000)
      throw new ExecutionBlocked(
        'metadata_stale',
        'La comprobación tardó demasiado para autorizar una ejecución.',
      );
    return verifySubscription(account, limits, models);
  }

  async diagnose(): Promise<SubscriptionEvidence> {
    const { client } = await this.connect();
    try {
      return await this.evidence(client);
    } finally {
      await client.close();
    }
  }

  async execute(options: ExecuteOptions): Promise<RunRecord> {
    if (options.ownedWorkspace)
      throw new ExecutionBlocked(
        'isolated_engine_required',
        'Selecciona AO para escritores aislados; no se cambia de motor automáticamente.',
      );
    if (
      options.maxReportedTokens !== undefined &&
      (!Number.isSafeInteger(options.maxReportedTokens) || options.maxReportedTokens < 1)
    )
      throw new ExecutionBlocked(
        'invalid_token_budget',
        'El límite de tokens debe ser un entero positivo.',
      );
    if (options.parallelReadOnly && options.allowWrites)
      throw new ExecutionBlocked(
        'parallel_write_forbidden',
        'Las tareas con escritura deben ejecutarse de forma exclusiva.',
      );
    if (
      options.timeoutMs !== undefined &&
      options.timeoutMs !== null &&
      (!Number.isFinite(options.timeoutMs) ||
        options.timeoutMs < 1 ||
        options.timeoutMs > 15 * 60_000)
    ) {
      throw new ExecutionBlocked(
        'invalid_timeout',
        'El tiempo debe estar entre 1 ms y 15 minutos.',
      );
    }
    const model = options.model ?? 'gpt-6.1-sol';
    const effort = options.effort ?? 'low';
    const now = Date.now();
    const project = realpathSync(options.project);
    if (
      !statSync(project).isDirectory() ||
      !options.prompt.trim() ||
      options.prompt.length > 100_000
    ) {
      throw new ExecutionBlocked(
        'invalid_task',
        'Indica una carpeta y una tarea no vacía de hasta 100.000 caracteres.',
      );
    }
    const record: RunRecord = {
      version: 1,
      officeRole: options.officeRole,
      id: randomUUID(),
      provider: 'codex',
      billing: 'subscription-only',
      status: 'checking',
      project,
      requestedModel: model,
      requestedEffort: effort,
      confirmedModel: null,
      sessionId: null,
      startedAt: now,
      updatedAt: now,
      reasonCode: null,
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      contextFingerprint: options.contextFingerprint,
      sessionMode: 'new',
      toolCalls: 0,
      metrics: createExecutionMetrics(
        'codex-json',
        options.prompt,
        CODEX_TASK_PREFIX + options.prompt,
      ),
    };
    mkdirSync(this.stateDir, { recursive: true, mode: 0o700 });
    const release = acquireCodexLease(this.stateDir, record.id, options.parallelReadOnly === true);
    let client: MetadataClient | undefined;
    let child: ChildProcessWithoutNullStreams | undefined;
    let interval: ReturnType<typeof setInterval> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let polling: Promise<void> | undefined;
    let removeInvalidated: (() => void) | undefined;
    let stopped = false;
    const save = () => {
      record.updatedAt = Date.now();
      const target = join(this.stateDir, `${record.id}.json`);
      const temporary = target + '.tmp';
      writeFileSync(temporary, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
      renameSync(temporary, target);
      options.onState?.({ ...record });
    };
    const stop = (code: string, status: 'paused' | 'cancelled') => {
      if (stopped) return;
      stopped = true;
      record.status = status;
      record.reasonCode = code;
      save();
      if (child) void stopProcess(child);
    };
    const abort = () => stop('cancelled_by_user', 'cancelled');
    try {
      save();
      const connected = await this.connect();
      client = connected.client;
      const evidence = await this.evidence(client);
      verifyChoice(evidence, model, effort);
      record.cliVersion = connected.runtime.version;
      record.subscriptionCheckedAt = evidence.checkedAt;
      if (options.signal?.aborted) {
        abort();
        return record;
      }
      removeInvalidated = client.onInvalidated?.(() => stop('account_changed', 'paused'));
      if (stopped) return record;
      // The execution ignores user config and pins the official provider/login.
      // Its environment does not forward credentials, custom URLs or providers.
      const args = buildCodexArguments({ ...options, project }, model, effort);
      child = this.dependencies.launch
        ? this.dependencies.launch(connected.runtime, args, safeCliEnvironment(this.env))
        : spawn(connected.runtime.executable, args, {
            cwd: project,
            env: safeCliEnvironment(this.env),
            windowsHide: true,
            stdio: 'pipe',
          });
      options.signal?.addEventListener('abort', abort, { once: true });
      record.status = 'running';
      save();
      const reader = createInterface({ input: child.stdout });
      let completed = false;
      let protocolFailed = false;
      const observeMetrics = cliMetricsObserver(record.metrics!);
      reader.on('line', (line) => {
        if (line.length > 2_000_000 || stopped) return;
        let event: Record<string, unknown>;
        try {
          event = object(JSON.parse(line));
        } catch {
          protocolFailed = true;
          stop('invalid_cli_output', 'paused');
          return;
        }
        observeMetrics(event);
        if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
          record.sessionId = event.thread_id;
          save();
          options.onActivity?.('thinking');
        } else if (event.type === 'item.started' || event.type === 'item.updated') {
          const item = object(event.item);
          options.onActivity?.(
            item.type === 'file_change'
              ? 'working'
              : item.type === 'reasoning'
                ? 'thinking'
                : 'reading',
          );
        } else if (event.type === 'item.completed') {
          const item = object(event.item);
          if (
            [
              'command_execution',
              'file_change',
              'web_search',
              'mcp_tool_call',
              'collab_tool_call',
            ].includes(String(item.type))
          )
            record.toolCalls = (record.toolCalls ?? 0) + 1;
          if (item.type === 'agent_message' && typeof item.text === 'string')
            options.onOutput?.(item.text);
        } else if (event.type === 'turn.completed') {
          completed = true;
          const usage = object(event.usage);
          for (const [source, target] of [
            ['input_tokens', 'inputTokens'],
            ['output_tokens', 'outputTokens'],
          ] as const) {
            const value = usage[source];
            if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
              record[target] = value;
          }
          const cached = usage.cached_input_tokens;
          if (
            typeof cached === 'number' &&
            Number.isSafeInteger(cached) &&
            cached >= 0 &&
            record.inputTokens !== null &&
            cached <= record.inputTokens
          )
            record.cachedInputTokens = cached;
          save();
          if (options.maxReportedTokens !== undefined) {
            if (record.inputTokens === null || record.outputTokens === null)
              stop('usage_unknown', 'paused');
            else if (record.inputTokens + record.outputTokens >= options.maxReportedTokens)
              stop('token_budget', 'paused');
          }
        } else if (event.type === 'turn.failed' || event.type === 'error') {
          // Classify locally; never persist provider error text or tool payloads.
          const text = String(object(event.error).message ?? event.message ?? '');
          if (/usage.?limit|rate.?limit|quota|credits|insufficient_quota/i.test(text))
            stop('provider_limit', 'paused');
          else protocolFailed = true;
        }
      });
      // Stderr is intentionally not displayed or stored: it can contain paths,
      // environment diagnostics and provider configuration. Fail with local codes.
      child.stderr.on('data', () => {});
      child.stdin.on('error', () => {
        protocolFailed = true;
      });
      const exit = new Promise<number | null>((resolve) => {
        child!.once('error', () => {
          protocolFailed = true;
          resolve(null);
        });
        child!.once('close', (code) => resolve(code));
      });
      const metadataClient = client;
      interval = setInterval(() => {
        if (polling || stopped || completed) return;
        polling = this.evidence(metadataClient)
          .then(() => {})
          .catch((error) => {
            stop(error instanceof ExecutionBlocked ? error.code : 'verification_lost', 'paused');
          })
          .finally(() => {
            polling = undefined;
          });
      }, this.dependencies.pollMs ?? 8000);
      if (options.timeoutMs !== null)
        timeout = setTimeout(() => stop('time_limit', 'paused'), options.timeoutMs ?? 15 * 60_000);
      child.stdin.end(CODEX_TASK_PREFIX + options.prompt);
      const code = await exit;
      clearInterval(interval);
      clearTimeout(timeout);
      await polling;
      if (!stopped) {
        // A final verification is required; successful output alone is not a
        // subscription receipt and must not mask a lost eligibility check.
        await this.evidence(client);
        record.status = code === 0 && completed && !protocolFailed ? 'completed' : 'failed';
        record.reasonCode = record.status === 'completed' ? null : 'cli_failed';
        save();
      }
    } catch (error) {
      if (!stopped) {
        record.reasonCode = error instanceof ExecutionBlocked ? error.code : 'execution_unverified';
        record.status = child || record.reasonCode.startsWith('quota_') ? 'paused' : 'blocked';
        save();
      }
    } finally {
      if (interval) clearInterval(interval);
      if (timeout) clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
      removeInvalidated?.();
      if (child) await stopProcess(child);
      // Finish any in-flight metadata request before closing its process.
      await polling;
      await client?.close();
      release();
    }
    return record;
  }
}
