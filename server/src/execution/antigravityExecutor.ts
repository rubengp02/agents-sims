import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';

import {
  type AntigravityProbe,
  discoverAntigravity,
  LocalAntigravityProbe,
} from './antigravityProbe.js';
import { prepareAntigravityWorkspace } from './antigravityWorkspace.js';
import { type CliRuntime, stopProcess } from './cliProcess.js';
import { acquireCodexLease } from './executionLease.js';
import { object, safeCliEnvironment } from './subscriptionPolicy.js';
import {
  type ExecuteOptions,
  ExecutionBlocked,
  type OfficialExecutor,
  type RunRecord,
  type RunStatus,
  type SubscriptionEvidence,
} from './types.js';

export interface AntigravityDependencies {
  discover?: () => Promise<CliRuntime>;
  launch?: (
    runtime: CliRuntime,
    args: string[],
    env: NodeJS.ProcessEnv,
    cwd: string,
  ) => ChildProcessWithoutNullStreams;
  stop?: (child: ChildProcessWithoutNullStreams) => Promise<void>;
  pollMs?: number;
  env?: NodeJS.ProcessEnv;
}
interface ChiefSession {
  id: string;
  input: number;
  output: number;
  cached: number | null;
}
const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Official CLI, included quota only. Native tools are denied by a private PreToolUse
 * gate: local writes, checks, browser and external approvals are mediated by office MCP. */
export class AntigravityExecutor implements OfficialExecutor {
  readonly engine = 'antigravity-cli' as const;
  readonly provider = 'antigravity' as const;
  readonly supportsSteering = false;
  readonly supportsOfficeRedirect = true;
  readonly maxConcurrentReadOnly = 1 as const;
  readonly executionEvidence: 'official-cli' | 'simulated';
  private readonly sessions = new Map<string, ChiefSession>();
  constructor(
    private readonly stateDir: string,
    private readonly enabled: () => boolean = () => false,
    private readonly probe: AntigravityProbe = new LocalAntigravityProbe(),
    private readonly dependencies: AntigravityDependencies = {},
  ) {
    if (dependencies.launch && !dependencies.stop)
      throw new Error('A simulated launcher needs a simulated stopper.');
    this.executionEvidence = dependencies.launch ? 'simulated' : 'official-cli';
  }

  async diagnose(cwd?: string): Promise<SubscriptionEvidence> {
    if (!this.enabled())
      throw new ExecutionBlocked(
        'antigravity_disabled',
        'La comprobación de Antigravity está desactivada.',
      );
    const inspection = await this.probe.inspect(cwd);
    const usage = inspection.includedUsage;
    if (
      !usage?.verified ||
      usage.creditsEnabled !== false ||
      !usage.windows.length ||
      !inspection.models.length
    )
      throw new ExecutionBlocked(
        'antigravity_billing_unverified',
        'No se ha verificado cuota Google incluida, catálogo y créditos adicionales desactivados.',
        inspection,
      );
    if (inspection.cliVersion !== '1.4.7')
      throw new ExecutionBlocked(
        'antigravity_version_unsupported',
        'Esta versión del CLI necesita comprobar su protocolo y permisos antes de ejecutar.',
        inspection,
      );
    for (const window of usage.windows) {
      if (
        !Number.isFinite(window.usedPercent) ||
        window.usedPercent < 0 ||
        window.usedPercent > 100 ||
        !Number.isFinite(window.resetsAt) ||
        window.resetsAt * 1000 <= Date.now()
      )
        throw new ExecutionBlocked(
          'antigravity_quota_unverified',
          'La cuota está caducada o incompleta.',
          inspection,
        );
    }
    const available = inspection.models.filter((model) => {
      const group = model.id.startsWith('gemini-')
        ? 'Gemini Models'
        : /^(claude-|gpt-oss-)/.test(model.id)
          ? 'Claude and GPT models'
          : null;
      const windows = group
        ? usage.windows.filter((window) => window.id.startsWith(group + ':'))
        : [];
      return windows.length === 2 && windows.every((window) => window.usedPercent < 90);
    });
    if (!available.length)
      throw new ExecutionBlocked(
        'quota_reserve',
        'No hay modelos con margen verificable del 10% de cuota incluida.',
        inspection,
      );
    return {
      checkedAt: inspection.checkedAt,
      plan: 'google-included',
      quota: usage.windows,
      models: available.map((model) => ({ id: model.id, efforts: ['default'] })),
      inspection,
    };
  }

  releaseObjectiveSession(key: string): void {
    for (const sessionKey of this.sessions.keys())
      if (sessionKey.startsWith(key + ':')) this.sessions.delete(sessionKey);
  }

  async execute(options: ExecuteOptions): Promise<RunRecord> {
    if (options.signal?.aborted)
      throw new ExecutionBlocked('user_cancelled', 'La petición ya está cancelada.');
    if (!options.toolServer)
      throw new ExecutionBlocked(
        'antigravity_tools_required',
        'Antigravity necesita el puente de herramientas y permisos de la oficina.',
      );
    if (options.ownedWorkspace || options.parallelReadOnly)
      throw new ExecutionBlocked(
        'antigravity_isolation_unsupported',
        'Antigravity utiliza un único puesto exclusivo; no admite escritores experimentales.',
      );
    if (
      (options.timeoutMs !== undefined &&
        options.timeoutMs !== null &&
        (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1)) ||
      (options.maxReportedTokens !== undefined &&
        (!Number.isSafeInteger(options.maxReportedTokens) || options.maxReportedTokens < 1))
    )
      throw new ExecutionBlocked('invalid_budget', 'El presupuesto de ejecución no es válido.');
    const evidence = await this.diagnose();
    const model = evidence.models.find((candidate) => candidate.id === options.model);
    if (!model || (options.effort !== undefined && options.effort !== 'default'))
      throw new ExecutionBlocked(
        'choice_unavailable',
        'Selecciona un identificador nativo del catálogo y razonamiento default.',
      );
    const project = realpathSync(options.project);
    const env = safeCliEnvironment(this.dependencies.env ?? process.env);
    const pathKey = Object.keys(env).find((name) => name.toLowerCase() === 'path') ?? 'PATH';
    env[pathKey] = dirname(process.execPath) + delimiter + (env[pathKey] ?? '');
    const runtime = await (this.dependencies.discover?.() ?? discoverAntigravity(env));
    if (runtime.version !== evidence.inspection?.cliVersion)
      throw new ExecutionBlocked(
        'antigravity_version_changed',
        'El CLI cambió después de comprobarlo. Vuelve a verificar su versión antes de ejecutar.',
      );
    const key =
      options.officeRole === 'chief' && options.objectiveSessionKey
        ? options.objectiveSessionKey +
          ':' +
          createHash('sha256')
            .update(project + '\n' + model.id)
            .digest('hex')
        : undefined;
    const previous = key ? this.sessions.get(key) : undefined;
    const id = randomUUID();
    const release = acquireCodexLease(this.stateDir, id, false);
    let profile: ReturnType<typeof prepareAntigravityWorkspace> | undefined;
    try {
      profile = prepareAntigravityWorkspace(this.stateDir, key ?? id, options.toolServer);
      // Check effective settings in the exact launch folder, including inherited
      // workspace configuration, before an inference attempt is recorded.
      const launchEvidence = await this.diagnose(profile.cwd);
      if (!launchEvidence.models.some((candidate) => candidate.id === model.id))
        throw new ExecutionBlocked(
          'quota_reserve',
          'El modelo ya no tiene cuota incluida disponible.',
        );
      if (launchEvidence.inspection?.cliVersion !== runtime.version)
        throw new ExecutionBlocked(
          'antigravity_version_changed',
          'El CLI cambió antes de arrancar.',
        );
      if (options.signal?.aborted)
        throw new ExecutionBlocked('user_cancelled', 'La petición está cancelada.');
    } catch (error) {
      try {
        profile?.close();
      } finally {
        release();
      }
      throw error;
    }
    const record: RunRecord = {
      version: 1,
      id,
      provider: 'antigravity',
      engine: this.engine,
      billing: 'subscription-only',
      status: 'running',
      project,
      executionProject: project,
      officeRole: options.officeRole,
      requestedModel: model.id,
      requestedEffort: 'default',
      confirmedModel: null,
      sessionId: previous?.id ?? null,
      sessionMode: previous ? 'resume' : 'new',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      subscriptionCheckedAt: evidence.checkedAt,
      reasonCode: null,
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      cliVersion: runtime.version,
      contextFingerprint: options.contextFingerprint,
    };
    const save = () => {
      record.updatedAt = Date.now();
      mkdirSync(this.stateDir, { recursive: true, mode: 0o700 });
      const file = join(this.stateDir, id + '.json');
      writeFileSync(file + '.tmp', JSON.stringify(record), { mode: 0o600 });
      renameSync(file + '.tmp', file);
      options.onState?.({ ...record });
    };
    let child: ChildProcessWithoutNullStreams | undefined;
    let stopping: Promise<void> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    let polling = false;
    let pendingPoll: Promise<void> | undefined;
    let final: Record<string, unknown> | undefined;
    let protocolError = false;
    let receivedInit = false;
    let imageRead = false;
    const local = new AbortController();
    const observations = new Map<number, { input: number; output: number }>();
    const toolSteps = new Set<number>();
    const stop = (reason: string, status: RunStatus) => {
      if (local.signal.aborted) return;
      record.status = status;
      record.reasonCode = reason;
      local.abort();
      if (key) this.sessions.delete(key);
      if (child) stopping = (this.dependencies.stop ?? stopProcess)(child);
    };
    const cancel = () => stop(options.interruptionReason?.() ?? 'user_cancelled', 'cancelled');
    try {
      profile.check();
      save();
      const args = [
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--print-timeout',
        '0',
        '--model',
        model.id,
        '--mode',
        'accept-edits',
        '--disable-slash-commands',
        ...(previous ? ['--conversation', previous.id] : []),
      ];
      child = this.dependencies.launch
        ? this.dependencies.launch(runtime, args, env, profile.cwd)
        : spawn(runtime.executable, args, {
            cwd: profile.cwd,
            env,
            windowsHide: true,
            stdio: 'pipe',
          });
      const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve) => {
          child!.once('error', () => {
            record.reasonCode = 'spawn_failed';
            resolve({ code: -1, signal: null });
          });
          child!.once('close', (code, signal) => resolve({ code, signal }));
        },
      );
      options.signal?.addEventListener('abort', cancel, { once: true });
      if (options.signal?.aborted) cancel();
      child.stderr.on('data', () => {});
      const reader = createInterface({ input: child.stdout });
      reader.on('line', (line) => {
        if (local.signal.aborted) return;
        try {
          const event = object(JSON.parse(line));
          if (event.event === 'init') {
            const init = object(event.init);
            if (
              receivedInit ||
              realpathSync(String(init.cwd)) !== profile.cwd ||
              init.permission_mode === 'always-proceed'
            )
              throw new Error('init');
            receivedInit = true;
            if (typeof event.conversation_id === 'string') record.sessionId = event.conversation_id;
            if (typeof init.model === 'string') {
              if (init.model !== model.id) throw new Error('model');
              record.confirmedModel = init.model;
            }
            save();
            options.onActivity?.('thinking');
          } else if (event.event === 'step_update') {
            const step = object(event.step_update);
            if (!receivedInit || final) throw new Error('sequence');
            if (step.step_type === 'tool') {
              let tool = typeof step.tool_name === 'string' ? step.tool_name : 'herramienta';
              const parameters = object(object(step.tool_info).parameters);
              if (tool === 'call_mcp_tool' && typeof parameters.ToolName === 'string') {
                let name = parameters.ToolName;
                try {
                  const parsed = JSON.parse(name);
                  if (typeof parsed === 'string') name = parsed;
                } catch {
                  /* plain name */
                }
                if (/^[a-z_]{1,100}$/.test(name)) tool = name;
              }
              if (
                tool === 'attachment_read' &&
                step.state === 'DONE' &&
                !object(step.tool_info).error
              )
                imageRead = true;
              if (
                Number.isSafeInteger(step.step_index) &&
                !toolSteps.has(Number(step.step_index))
              ) {
                toolSteps.add(Number(step.step_index));
                record.toolCalls = (record.toolCalls ?? 0) + 1;
              }
              options.onProgress?.({
                id: 'agy-' + String(step.step_index),
                title: 'Usando una herramienta: ' + tool,
                completed: step.state === 'DONE',
              });
              options.onToolActivity?.(tool);
              options.onActivity?.(/read|list|view/.test(tool) ? 'reading' : 'working');
            }
            if (step.state === 'DONE' && Number.isSafeInteger(step.step_index)) {
              const usage = object(step.usage),
                input = count(usage.input_tokens),
                output = count(usage.output_tokens);
              if (input !== null && output !== null)
                observations.set(Number(step.step_index), { input, output });
              const observed = [...observations.values()].reduce(
                (sum, value) => ({
                  input: sum.input + value.input,
                  output: sum.output + value.output,
                }),
                { input: 0, output: 0 },
              );
              record.observedUsage = {
                inputTokens: observed.input,
                outputTokens: observed.output,
                cachedInputTokens: null,
              };
              if (
                options.maxReportedTokens !== undefined &&
                observed.input + observed.output >= options.maxReportedTokens
              )
                stop('token_budget', 'paused');
            }
          } else if (event.event === 'result') {
            if (!receivedInit || final) throw new Error('result');
            final = object(event.result);
            if (
              typeof final.conversation_id !== 'string' ||
              !record.sessionId ||
              final.conversation_id !== record.sessionId
            )
              throw new Error('conversation');
          }
        } catch {
          protocolError = true;
          stop('antigravity_protocol_invalid', 'failed');
        }
      });
      const prompt =
        options.prompt +
        '\n\nLa carpeta de arranque es privada y no es el proyecto. Cita archivos con las rutas relativas devueltas por MCP; no inventes enlaces file:// a la carpeta privada.' +
        '\n\nUsa exclusivamente las herramientas MCP de la oficina ' +
        profile.serverName +
        '. project_list/project_read consultan el proyecto real; project_write/project_delete modifican solo como Programador autorizado. Usa attachment_list y attachment_read para inspeccionar cada imagen autorizada, sin inventar su contenido. Las herramientas nativas están bloqueadas por el guardián. Las acciones externas se aprueban en la oficina. No instales herramientas ni uses otros servidores por tu cuenta.';
      const checkGuide =
        '\nproject_check_run devuelve results con passed y exitCode: passed=true y exitCode=0 acreditan esa ejecución. No repitas una prueba ya aprobada sin un cambio o una nueva incertidumbre concreta. No necesitas plugins ni otras herramientas para interpretar ese resultado.';
      child.stdin.end(
        JSON.stringify({ event: 'user', message: { content: prompt + checkGuide } }) + '\n',
      );
      if (options.timeoutMs !== undefined && options.timeoutMs !== null)
        timeout = setTimeout(() => stop('time_limit', 'paused'), options.timeoutMs);
      poll = setInterval(() => {
        if (polling || local.signal.aborted) return;
        polling = true;
        pendingPoll = this.diagnose(profile.cwd)
          .then(
            (current) => {
              record.subscriptionCheckedAt = current.checkedAt;
              if (!current.models.some((candidate) => candidate.id === model.id))
                stop('quota_reserve', 'paused');
            },
            (error: unknown) =>
              stop(
                error instanceof ExecutionBlocked ? error.code : 'antigravity_quota_unverified',
                'paused',
              ),
          )
          .finally(() => {
            polling = false;
          });
      }, this.dependencies.pollMs ?? 30_000);
      const exit = await closed;
      if (poll) clearInterval(poll);
      await pendingPoll;
      if (stopping) await stopping;
      // A failed/interrupted attempt can still have consumed quota. Preserve a
      // valid final receipt regardless of whether its delivery was successful.
      if (final && !protocolError) {
        const usage = object(final.usage),
          input = count(usage.input_tokens),
          output = count(usage.output_tokens),
          cached = count(usage.cache_read_tokens);
        if (
          input !== null &&
          output !== null &&
          (!previous || (input >= previous.input && output >= previous.output))
        ) {
          record.inputTokens = input - (previous?.input ?? 0);
          record.outputTokens = output - (previous?.output ?? 0);
          record.cachedInputTokens =
            cached === null
              ? null
              : previous?.cached === null || previous?.cached === undefined
                ? cached
                : cached >= previous.cached
                  ? cached - previous.cached
                  : null;
        }
      }
      if (!local.signal.aborted) {
        if (exit.code !== 0 || exit.signal || !final || protocolError) {
          record.status = 'failed';
          record.reasonCode ??= final ? 'exit_non_zero' : 'antigravity_result_missing';
        } else if (final.status !== 'SUCCESS') {
          record.status =
            final.status === 'CANCELED' || final.status === 'INTERRUPTED' ? 'cancelled' : 'failed';
          record.reasonCode =
            'antigravity_result_' +
            String(final.status)
              .toLowerCase()
              .replace(/[^a-z_]/g, '');
        } else {
          await options.waitForTools?.(local.signal);
          profile.check();
          const guard = profile.evidence();
          const usage = object(final.usage);
          const input = count(usage.input_tokens),
            output = count(usage.output_tokens),
            cached = count(usage.cache_read_tokens);
          if (
            input === null ||
            output === null ||
            (previous && (input < previous.input || output < previous.output))
          ) {
            record.status = 'paused';
            record.reasonCode = 'usage_unknown';
          } else {
            record.status = 'completed';
            if (
              options.maxReportedTokens !== undefined &&
              record.inputTokens! + record.outputTokens! >= options.maxReportedTokens
            ) {
              record.status = 'paused';
              record.reasonCode = 'token_budget';
            }
            if (record.toolCalls && !guard.seen) {
              record.status = 'failed';
              record.reasonCode = 'antigravity_guard_unverified';
            }
            if (options.imagePaths?.length && !imageRead) {
              record.status = 'blocked';
              record.reasonCode = 'antigravity_image_not_inspected';
            }
            if (imageRead && record.status === 'completed')
              options.onCapabilityVerified?.('images');
            if (key && record.status === 'completed' && record.sessionId)
              this.sessions.set(key, { id: record.sessionId, input, output, cached });
          }
          if (typeof final.response === 'string') options.onOutput?.(final.response);
        }
      }
      save();
      return record;
    } catch (error) {
      stop(
        error instanceof ExecutionBlocked ? error.code : 'antigravity_execution_failed',
        'failed',
      );
      if (stopping) await stopping;
      save();
      return record;
    } finally {
      if (timeout) clearTimeout(timeout);
      if (poll) clearInterval(poll);
      options.signal?.removeEventListener('abort', cancel);
      if (record.status !== 'completed' && key) this.sessions.delete(key);
      try {
        profile.close();
      } finally {
        release();
      }
    }
  }
}
