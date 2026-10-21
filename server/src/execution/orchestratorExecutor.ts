import { type ChildProcessWithoutNullStreams, execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { createInterface } from 'node:readline';

import { type CliRuntime, discoverCodex, stopProcess } from './cliProcess.js';
import { CodexExecutor } from './codexExecutor.js';
import { acquireCodexLease } from './executionLease.js';
import { object, safeCliEnvironment, verifyChoice } from './subscriptionPolicy.js';
import {
  type ExecuteOptions,
  ExecutionBlocked,
  type OfficialExecutor,
  type RunRecord,
} from './types.js';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const REVISION = '1550d440b82ac9cfb3e671b060709457cdffbaea';
interface Session {
  version: 1;
  project: string;
  workspace: string;
  role: string;
  writes: boolean;
  thread: string | null;
  status: 'ready' | 'running' | 'completed' | 'uncertain';
  input: number;
  output: number;
  cached: number;
}
interface Dependencies {
  metadata?: OfficialExecutor;
  discover?: () => Promise<CliRuntime>;
  launch?: (env: NodeJS.ProcessEnv) => ChildProcessWithoutNullStreams;
  /** Test seam; production always verifies the built artifact. */
  verifyBuild?: () => void;
  env?: NodeJS.ProcessEnv;
}

/** AO supplies native session/worktree infrastructure. Office policy owns all starts. */
export class OrchestratorExecutor implements OfficialExecutor {
  readonly provider = 'codex' as const;
  readonly maxConcurrentReadOnly = 2 as const;
  private readonly metadata: OfficialExecutor;
  private readonly local: string;
  private readonly binary: string;
  private readonly env: NodeJS.ProcessEnv;
  constructor(
    private readonly root: string,
    private readonly stateDir: string,
    private readonly deps: Dependencies = {},
  ) {
    this.local = join(root, '.local-office/agent-orchestrator');
    this.binary = join(
      this.local,
      'bin',
      process.platform === 'win32' ? 'pixel-office-ao.exe' : 'pixel-office-ao',
    );
    this.env = deps.env ?? process.env;
    this.metadata = deps.metadata ?? new CodexExecutor(stateDir);
  }
  private verifyBuild(): void {
    if (this.deps.verifyBuild) return this.deps.verifyBuild();
    try {
      const manifest = JSON.parse(readFileSync(join(this.local, 'build.json'), 'utf8'));
      const integration = join(this.root, 'integrations/agent-orchestrator');
      const fingerprint = hash(
        Buffer.concat(
          ['lock.json', 'main.go', 'office_driver.go'].map((p) =>
            readFileSync(join(integration, p)),
          ),
        ),
      );
      if (
        manifest.revision !== REVISION ||
        manifest.protocol !== 1 ||
        manifest.sourceFingerprint !== fingerprint ||
        manifest.binaryHash !== hash(readFileSync(this.binary))
      )
        throw new Error();
    } catch {
      throw new ExecutionBlocked(
        'ao_build_unverified',
        'Prepara el motor con npm run engine:prepare. No se usará otro motor como alternativa.',
      );
    }
  }
  async diagnose() {
    safeCliEnvironment(this.env);
    this.verifyBuild();
    return this.metadata.diagnose();
  }
  private launch() {
    const env = safeCliEnvironment(this.env);
    return (
      this.deps.launch?.(env) ??
      spawn(this.binary, [], { cwd: this.root, env, windowsHide: true, stdio: 'pipe' })
    );
  }
  private save(file: string, value: unknown): void {
    mkdirSync(join(this.local, 'sessions'), { recursive: true, mode: 0o700 });
    writeFileSync(file + '.tmp', JSON.stringify(value), { mode: 0o600 });
    renameSync(file + '.tmp', file);
  }
  private async workspace(project: string, key: string): Promise<string> {
    // A branch must never silently omit the user's uncommitted work.
    try {
      if (
        execFileSync('git', ['-C', project, 'status', '--porcelain'], {
          encoding: 'utf8',
          windowsHide: true,
        }).trim()
      )
        throw new ExecutionBlocked(
          'ao_dirty_project',
          'Conserva o confirma los cambios del proyecto antes de crear el espacio aislado.',
        );
      execFileSync('git', ['-C', project, 'rev-parse', '--verify', 'HEAD'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch (error) {
      if (error instanceof ExecutionBlocked) throw error;
      throw new ExecutionBlocked(
        'ao_git_required',
        'El trabajo con escritura requiere un repositorio Git con un commit inicial.',
      );
    }
    const child = this.launch();
    child.stdin.on('error', () => {});
    let path: string | null = null;
    let invalid = false;
    const workspaces = join(this.local, 'workspaces');
    mkdirSync(workspaces, { recursive: true, mode: 0o700 });
    createInterface({ input: child.stdout }).on('line', (line) => {
      try {
        const value = object(JSON.parse(line));
        if (value.kind === 'workspace' && typeof value.path === 'string') path = value.path;
        else invalid = true;
      } catch {
        invalid = true;
      }
    });
    child.stderr.on('data', () => {});
    const baseRef = execFileSync('git', ['-C', project, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    child.stdin.end(
      JSON.stringify({
        action: 'workspace',
        project,
        stateDir: workspaces,
        // 128-bit workspace names keep Git ref lock paths within Windows limits.
        // Session ownership and continuation still use the full 256-bit key.
        sessionId: key.slice(0, 32),
        baseRef,
      }) + '\n',
    );
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    if (code !== 0 || invalid || !path)
      throw new ExecutionBlocked(
        'ao_workspace_failed',
        'Agent Orchestrator no pudo preparar el espacio aislado.',
      );
    const workspace = realpathSync(path);
    const rel = relative(realpathSync(workspaces), workspace);
    if (!rel || rel.startsWith('..') || isAbsolute(rel))
      throw new ExecutionBlocked(
        'ao_workspace_invalid',
        'Espacio fuera del directorio gestionado.',
      );
    return workspace;
  }
  async execute(options: ExecuteOptions): Promise<RunRecord> {
    this.verifyBuild();
    safeCliEnvironment(this.env);
    if (
      !options.prompt?.trim() ||
      options.prompt.length > 90_000 ||
      (options.allowWrites && options.officeRole && options.officeRole !== 'developer')
    )
      throw new ExecutionBlocked(
        'ao_scope_invalid',
        'Revisa el encargo y los permisos del personaje.',
      );
    const project = realpathSync(options.project);
    const key = hash(
      JSON.stringify([
        project,
        options.officeRole ?? 'developer',
        options.executionSessionKey ?? randomUUID(),
      ]),
    );
    const file = join(this.local, 'sessions', key + '.json');
    let session: Session | null = null;
    if (existsSync(file)) {
      session = JSON.parse(readFileSync(file, 'utf8')) as Session;
      if (
        session.version !== 1 ||
        session.project !== project ||
        session.role !== (options.officeRole ?? 'developer') ||
        session.writes !== !!options.allowWrites ||
        typeof session.workspace !== 'string' ||
        !isAbsolute(session.workspace) ||
        ![session.input, session.output, session.cached].every(
          (n) => Number.isSafeInteger(n) && n >= 0,
        ) ||
        session.cached > session.input ||
        (session.status === 'completed' && (typeof session.thread !== 'string' || !session.thread))
      )
        throw new ExecutionBlocked('ao_session_scope', 'La conversación pertenece a otro alcance.');
      if (session.status !== 'completed')
        throw new ExecutionBlocked(
          'ao_recovery_required',
          'La ejecución previa no está cerrada con consumo conocido; permanece pausada.',
        );
    }
    const release = acquireCodexLease(
      this.stateDir,
      key,
      options.parallelReadOnly === true && !options.allowWrites,
    );
    let child: ChildProcessWithoutNullStreams | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => {
      if (child) void stopProcess(child);
    };
    try {
      if (options.signal?.aborted)
        throw new ExecutionBlocked('cancelled_by_user', 'La tarea se canceló antes de arrancar.');
      const evidence = await this.diagnose();
      const model = options.model ?? 'gpt-6.1-sol',
        effort = options.effort ?? 'low';
      verifyChoice(evidence, model, effort);
      const runtime = await (this.deps.discover?.() ?? discoverCodex(this.env));
      let inherited: string | undefined;
      if (options.inheritedWorkspace) {
        inherited = realpathSync(options.inheritedWorkspace);
        const managed = relative(realpathSync(join(this.local, 'workspaces')), inherited);
        if (!managed || managed.startsWith('..') || isAbsolute(managed))
          throw new ExecutionBlocked(
            'ao_workspace_invalid',
            'Espacio heredado fuera del directorio gestionado.',
          );
        const common = (dir: string) =>
          realpathSync(
            execFileSync(
              'git',
              ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
              { encoding: 'utf8', windowsHide: true },
            ).trim(),
          );
        if (common(project) !== common(inherited))
          throw new ExecutionBlocked(
            'ao_workspace_invalid',
            'El espacio heredado pertenece a otro proyecto.',
          );
      }
      const workspace =
        session?.workspace ??
        inherited ??
        (options.allowWrites ? await this.workspace(project, key) : project);
      session ??= {
        version: 1,
        project,
        workspace,
        role: options.officeRole ?? 'developer',
        writes: !!options.allowWrites,
        thread: null,
        status: 'ready',
        input: 0,
        output: 0,
        cached: 0,
      };
      const prior = { input: session.input, output: session.output, cached: session.cached };
      const record: RunRecord = {
        version: 1,
        id: randomUUID(),
        provider: 'codex',
        billing: 'subscription-only',
        officeRole: options.officeRole,
        engine: 'agent-orchestrator',
        project,
        executionProject: workspace,
        requestedModel: model,
        requestedEffort: effort,
        confirmedModel: null,
        sessionId: session.thread,
        sessionMode: session.thread ? 'resume' : 'new',
        cliVersion: runtime.version,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        status: 'checking',
        reasonCode: null,
        inputTokens: null,
        outputTokens: null,
        cachedInputTokens: null,
        toolCalls: 0,
        contextFingerprint: options.contextFingerprint,
      };
      this.save(file, session);
      child = this.launch();
      options.signal?.addEventListener('abort', abort, { once: true });
      let finished = false,
        authorized = false,
        invalid = false,
        readySeen = false;
      let verification: Promise<void> = Promise.resolve();
      const notify = () => {
        record.updatedAt = Date.now();
        this.save(join(this.stateDir, record.id + '.json'), record);
        options.onState?.({ ...record });
      };
      const fail = (code: string) => {
        invalid = true;
        record.reasonCode ??= code;
        abort();
      };
      child.stdin.on('error', () => fail('ao_transport_closed'));
      const lines = createInterface({ input: child.stdout });
      lines.on('line', (line) => {
        if (invalid) return;
        if (line.length > 1_000_000) return fail('ao_protocol_invalid');
        let value: Record<string, unknown>;
        try {
          value = object(JSON.parse(line));
        } catch {
          return fail('ao_protocol_invalid');
        }
        if (value.kind === 'ready') {
          if (
            readySeen ||
            authorized ||
            session!.status === 'running' ||
            typeof value.threadId !== 'string' ||
            !value.threadId
          )
            return fail('ao_protocol_invalid');
          readySeen = true;
          session!.thread = value.threadId;
          record.sessionId = value.threadId;
          verification = (async () => {
            try {
              const current = await this.diagnose();
              verifyChoice(current, model, effort);
              if (invalid || options.signal?.aborted) return;
              record.subscriptionCheckedAt = current.checkedAt;
              session!.status = 'running';
              this.save(file, session);
              authorized = true;
              record.status = 'running';
              notify();
              child!.stdin.end(JSON.stringify({ action: 'turn', prompt: options.prompt }) + '\n');
            } catch {
              fail('subscription_unverified');
            }
          })();
        } else if (!authorized) fail('ao_protocol_invalid');
        else if (value.kind === 'text' && typeof value.text === 'string')
          options.onOutput?.(value.text);
        else if (value.kind === 'activity') {
          record.toolCalls = (record.toolCalls ?? 0) + 1;
          options.onActivity?.(value.activity === 'file_change' ? 'working' : 'reading');
        } else if (value.kind === 'usage') {
          const counters = [value.input, value.output, value.cached];
          if (
            !counters.every((n) => Number.isSafeInteger(n) && Number(n) >= 0) ||
            Number(value.cached) > Number(value.input) ||
            Number(value.input) < session!.input ||
            Number(value.output) < session!.output ||
            Number(value.cached) < session!.cached
          )
            return fail('ao_usage_invalid');
          session!.input = Number(value.input);
          session!.output = Number(value.output);
          session!.cached = Number(value.cached);
          record.inputTokens = session!.input - prior.input;
          record.outputTokens = session!.output - prior.output;
          record.cachedInputTokens = session!.cached - prior.cached;
          notify();
          if (
            options.maxReportedTokens &&
            record.inputTokens + record.outputTokens > options.maxReportedTokens
          )
            fail('token_budget');
        } else if (value.kind === 'finished' && !finished) {
          finished = true;
          record.status = value.status === 'completed' ? 'completed' : 'failed';
        } else fail(value.kind === 'error' ? 'ao_runtime_failed' : 'ao_protocol_invalid');
      });
      let diagnostics = '';
      child.stderr.on('data', (chunk) => {
        diagnostics = (diagnostics + chunk.toString()).slice(0, 32_000);
        writeFileSync(join(this.stateDir, record.id + '.stderr.log'), diagnostics, { mode: 0o600 });
      });
      timer = setTimeout(
        () => fail('time_budget'),
        Math.min(900_000, options.timeoutMs ?? 180_000),
      );
      const closed = new Promise<number | null>((resolve, reject) => {
        child!.once('error', reject);
        child!.once('close', resolve);
      });
      child.stdin.write(
        JSON.stringify({
          action: 'open',
          binary: runtime.executable,
          project: workspace,
          stateDir: this.local,
          sessionId: key,
          threadId: session.thread ?? '',
          model,
          effort,
          allowWrites: !!options.allowWrites,
          timeoutMs: Math.min(900_000, options.timeoutMs ?? 180_000),
        }) + '\n',
      );
      const code = await closed;
      await verification;
      if (
        invalid ||
        code !== 0 ||
        !finished ||
        record.inputTokens === null ||
        record.outputTokens === null ||
        options.signal?.aborted
      ) {
        record.status = options.signal?.aborted ? 'cancelled' : 'paused';
        record.reasonCode ??= 'ao_usage_or_completion_unknown';
        session.status = 'uncertain';
      } else session.status = 'completed';
      this.save(file, session);
      notify();
      mkdirSync(this.stateDir, { recursive: true, mode: 0o700 });
      this.save(join(this.stateDir, record.id + '.json'), record);
      return record;
    } finally {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (child) await stopProcess(child);
      release();
    }
  }
}
