import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

import type { RemoteClient } from '../tools/connectionManager.js';
import {
  type ManagedMcpState,
  type ManagedMcpTarget,
  managedMcpTarget,
} from '../tools/officialMcpRegistration.js';
import type { PluginMcpSelection } from '../tools/pluginMcpSession.js';
import { checkPublicMcpEndpoint } from '../tools/publicMcpFetch.js';
import { type CliRuntime, discoverCodex } from './cliProcess.js';
import { appServerThreadConfig } from './codexAppServerConfig.js';
import { type AppServerProtocol, CodexAppServerProtocol } from './codexAppServerProtocol.js';
import { CODEX_TASK_PREFIX } from './codexExecutor.js';
import { acquireCodexLease } from './executionLease.js';
import { LocalFileApprovals } from './localFileApprovals.js';
import { officialMcpLogout } from './officialMcpLogout.js';
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
  type SteeringInput,
  type SteeringResult,
  type SubscriptionEvidence,
} from './types.js';

export interface AppServerApprovalRequest {
  runId: string;
  taskId: string;
  method: string;
  params: Record<string, unknown>;
  signal: AbortSignal;
}

export interface AppServerDependencies {
  discover?: () => Promise<CliRuntime>;
  launch?: (
    runtime: CliRuntime,
    args: string[],
    env: NodeJS.ProcessEnv,
  ) => ChildProcessWithoutNullStreams;
  protocol?: (runtime: CliRuntime, args: string[], env: NodeJS.ProcessEnv) => AppServerProtocol;
  approvals?: { request(request: AppServerApprovalRequest): Promise<unknown> };
  env?: NodeJS.ProcessEnv;
  pollMs?: number;
  logoutMcp?: typeof officialMcpLogout;
  checkMcpEndpoint?: typeof checkPublicMcpEndpoint;
}

export interface AppServerToolDiscovery {
  checkedAt: number;
  cliVersion: string;
  installedApps?: {
    verified: boolean;
    items: Array<{ id: string; name: string; enabled: boolean; callable: boolean }>;
  };
  apps: {
    verified: boolean;
    errorCode?: string;
    items: Array<{ id: string; name: string; connected: boolean; enabled: boolean }>;
  };
  skills: { verified: boolean; items: Array<{ name: string; enabled: boolean }> };
  mcp: { verified: boolean; items: Array<{ name: string; authStatus: string; tools: number }> };
}

// Identity stays in memory as a digest; no email or account identifier enters receipts.
const accountIdentity = (raw: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(object(raw).account ?? null))
    .digest('hex');

function verifiedAppsPolicy(value: unknown): boolean {
  const apps = object(value);
  const defaults = object(apps._default);
  if (defaults.default_tools_approval_mode !== 'prompt' || defaults.approvals_reviewer !== 'user')
    return false;
  // Existing user/link/tool overrides must not silently relax prompt-all.
  for (const [name, raw] of Object.entries(apps)) {
    if (name === '_default') continue;
    const app = object(raw);
    if (
      app.default_tools_approval_mode !== undefined &&
      app.default_tools_approval_mode !== 'prompt'
    )
      return false;
    if (app.approvals_reviewer !== undefined && app.approvals_reviewer !== 'user') return false;
    for (const tool of Object.values(object(app.tools))) {
      const approval = object(tool).approval_mode;
      if (approval !== undefined && approval !== 'prompt') return false;
    }
    for (const link of Object.values(object(app.links))) {
      const approval = object(link).default_tools_approval_mode;
      if (approval !== undefined && approval !== 'prompt') return false;
      const reviewer = object(link).approvals_reviewer;
      if (reviewer !== undefined && reviewer !== 'user') return false;
    }
  }
  return true;
}

export { appServerThreadConfig } from './codexAppServerConfig.js';

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Both initial and steered inputs originate from the private validated artifact store. */
function imageInputs(paths: string[] = []): string[] {
  try {
    if (!Array.isArray(paths) || paths.length > 10) throw new Error('count');
    return paths.map((path) => {
      if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('path');
      const file = realpathSync(path);
      const info = statSync(file);
      if (!info.isFile() || info.size === 0 || info.size > 20 * 1024 * 1024)
        throw new Error('size');
      return file;
    });
  } catch {
    throw new ExecutionBlocked('invalid_images', 'Las imágenes adjuntas no son válidas.');
  }
}

interface ActiveExecution {
  client: AppServerProtocol;
  threadId: string;
  turnId: string;
  supportsImages: boolean;
  stopped: boolean;
  completed: boolean;
  invalidateApprovals(): void;
}

function generatedImage(item: Record<string, unknown>, options: ExecuteOptions): string | null {
  if (!options.artifactDirectory || item.failure || item.status !== 'completed') return null;
  try {
    const root = realpathSync(options.artifactDirectory);
    let bytes: Buffer | undefined;
    if (typeof item.savedPath === 'string') {
      const path = realpathSync(item.savedPath);
      const allowed = [root, realpathSync(options.project)].some((base) => {
        const delta = relative(base, path);
        return !!delta && !delta.startsWith('..') && !isAbsolute(delta);
      });
      if (allowed && statSync(path).isFile() && statSync(path).size <= 20 * 1024 * 1024)
        bytes = readFileSync(path);
    }
    if (
      !bytes &&
      typeof item.result === 'string' &&
      item.result.length <= 28_000_000 &&
      /^[A-Za-z0-9+/\r\n]+={0,2}$/.test(item.result)
    )
      bytes = Buffer.from(item.result, 'base64');
    if (!bytes || bytes.length > 20 * 1024 * 1024) return null;
    const extension = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'png'
      : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        ? 'jpg'
        : bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
            bytes.subarray(8, 12).toString('ascii') === 'WEBP'
          ? 'webp'
          : null;
    if (!extension) return null;
    const target = join(root, `${randomUUID()}.${extension}`);
    writeFileSync(target, bytes, { mode: 0o600, flag: 'wx' });
    return target;
  } catch {
    return null;
  }
}

function deny(method: string): unknown {
  if (method === 'item/permissions/requestApproval') return { permissions: {}, scope: 'turn' };
  if (method === 'mcpServer/elicitation/request') return { action: 'decline' };
  if (method === 'item/tool/requestUserInput') return { answers: {} };
  if (method === 'item/tool/call')
    return {
      success: false,
      contentItems: [{ type: 'inputText', text: 'Herramienta no autorizada.' }],
    };
  return { decision: 'decline' };
}

/** App Server execution uses the same official account, quota guard and lease as exec. */
export class CodexAppServerExecutor implements OfficialExecutor {
  get executionEvidence(): 'official-cli' | 'unknown' {
    return this.dependencies.launch || this.dependencies.protocol || this.dependencies.discover
      ? 'unknown'
      : 'official-cli';
  }
  readonly provider = 'codex' as const;
  readonly engine = 'codex-app-server' as const;
  readonly maxConcurrentReadOnly = 2 as const;
  readonly supportsSteering = true;
  private readonly objectiveSessions = new Map<
    string,
    {
      threadId: string;
      project: string;
      model: string;
      account: string;
      input: number;
      output: number;
      cached: number | null;
    }
  >();
  releaseObjectiveSession(key: string): void {
    this.objectiveSessions.delete(key);
  }
  private readonly env: NodeJS.ProcessEnv;
  private readonly active = new Map<string, ActiveExecution>();
  // Keep results after a turn ends: a retry must never silently become a second send.
  private readonly steering = new Map<
    string,
    { fingerprint: string; result: Promise<SteeringResult> }
  >();

  constructor(
    private readonly stateDir: string,
    private readonly dependencies: AppServerDependencies = {},
  ) {
    this.env = dependencies.env ?? process.env;
  }

  async steer(executionSessionKey: string, input: SteeringInput): Promise<SteeringResult> {
    if (!input.id || input.id.length > 200 || !input.text.trim() || input.text.length > 100_000)
      throw new ExecutionBlocked('invalid_steering', 'Indica una instrucción válida.');
    const images = imageInputs(input.imagePaths);
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          input.text,
          images.map((file) => [
            file,
            createHash('sha256').update(readFileSync(file)).digest('hex'),
          ]),
        ]),
      )
      .digest('hex');
    const key = JSON.stringify([executionSessionKey, input.id]);
    const prior = this.steering.get(key);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new ExecutionBlocked(
          'steering_conflict',
          'Esta indicación ya se registró con otro contenido.',
        );
      return prior.result;
    }
    const execution = this.active.get(executionSessionKey);
    if (!execution || execution.stopped || execution.completed) return { status: 'not_running' };
    if (images.length && !execution.supportsImages)
      throw new ExecutionBlocked(
        'image_model_unverified',
        'Este modelo no confirma soporte de imágenes.',
      );
    const result = (async (): Promise<SteeringResult> => {
      try {
        const response = object(
          await execution.client.request('turn/steer', {
            threadId: execution.threadId,
            expectedTurnId: execution.turnId,
            clientUserMessageId: input.id,
            input: [
              { type: 'text', text: input.text },
              ...images.map((path) => ({ type: 'localImage', path })),
            ],
          }),
        );
        if (response.turnId !== execution.turnId) return { status: 'unknown' };
        execution.invalidateApprovals();
        return { status: 'accepted', turnId: execution.turnId };
      } catch (error) {
        // A lost/late RPC response cannot prove that the instruction was not delivered.
        if (
          execution.completed &&
          error instanceof ExecutionBlocked &&
          error.code === 'app_server_rejected'
        )
          return { status: 'not_running' };
        return { status: 'unknown' };
      }
    })();
    this.steering.set(key, { fingerprint, result });
    return result;
  }

  private async connect(
    project?: string,
    pluginManagement = false,
    selectedPlugin?: PluginMcpSelection,
  ): Promise<{
    runtime: CliRuntime;
    client: AppServerProtocol;
    configuredMcpNames: string[];
    configuredPluginNames: string[];
  }> {
    const env = safeCliEnvironment(this.env);
    const runtime = await (this.dependencies.discover?.() ?? discoverCodex(this.env));
    // The official provider is pinned before initialization, including metadata requests.
    const args = [
      'app-server',
      '--listen',
      'stdio://',
      ...[
        'model_provider="openai"',
        'forced_login_method="chatgpt"',
        'model_providers={}',
        'mcp_servers={}',
        'apps={_default={enabled=true,default_tools_approval_mode="prompt",approvals_reviewer="user"}}',
        'features.apps=true',
        `features.plugins=${pluginManagement ? 'true' : 'false'}`,
        'features.multi_agent=false',
        'features.hooks=false',
        ...(selectedPlugin
          ? [
              'plugins={' +
                selectedPlugin.pluginIds
                  .map(
                    (id) =>
                      `${JSON.stringify(id)}={enabled=${id === selectedPlugin.nativeId ? 'true' : 'false'}}`,
                  )
                  .join(',') +
                '}',
            ]
          : []),
        ...(process.platform === 'win32'
          ? ['windows.sandbox="elevated"', 'features.prefer_mxc=true']
          : []),
      ].flatMap((entry) => ['-c', entry]),
    ];
    const client =
      this.dependencies.protocol?.(runtime, args, env) ??
      new CodexAppServerProtocol(
        this.dependencies.launch?.(runtime, args, env) ??
          spawn(runtime.executable, args, { env, windowsHide: true, stdio: 'pipe' }),
      );
    try {
      await client.request('initialize', {
        clientInfo: { name: 'pixel-office', version: '1.0.0' },
        capabilities: { experimentalApi: true },
      });
      client.notify('initialized');
      const effective = object(
        object(
          await client.request('config/read', {
            includeLayers: false,
            ...(project ? { cwd: project } : {}),
          }),
        ).config,
      );
      if (!verifiedAppsPolicy(effective.apps))
        throw new ExecutionBlocked(
          'apps_approval_unverified',
          'No se pudo confirmar que las aplicaciones solicitan aprobación para cada operación.',
        );
      if (selectedPlugin) {
        const plugins = object(effective.plugins);
        const reason =
          object(plugins[selectedPlugin.nativeId]).enabled !== true
            ? 'Codex no confirmó que el plugin seleccionado esté habilitado.'
            : Object.entries(plugins).some(
                  ([id, value]) =>
                    id !== selectedPlugin.nativeId && object(value).enabled !== false,
                )
              ? 'Codex mantiene otros plugins habilitados en el contexto seleccionado.'
              : object(effective.features).hooks !== false
                ? 'Codex no confirmó que los hooks estén desactivados.'
                : object(effective.features).plugins !== true
                  ? 'Codex no confirmó la función de plugins en este contexto.'
                  : null;
        if (reason) throw new ExecutionBlocked('plugin_isolation_unconfirmed', reason);
      }
      return {
        runtime,
        client,
        configuredMcpNames: Object.keys(object(effective.mcp_servers)),
        configuredPluginNames: Object.keys(object(effective.plugins)),
      };
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  private async evidence(
    client: AppServerProtocol,
  ): Promise<{ evidence: SubscriptionEvidence; models: unknown; accountIdentity: string }> {
    const started = Date.now();
    const [account, limits, models] = await Promise.all([
      client.request('account/read', { refreshToken: false }),
      client.request('account/rateLimits/read'),
      client.request('model/list', { limit: 100, includeHidden: false }),
    ]);
    if (Date.now() - started > 15_000)
      throw new ExecutionBlocked('metadata_stale', 'La comprobación de cuota ha caducado.');
    return {
      evidence: verifySubscription(account, limits, models),
      models,
      accountIdentity: accountIdentity(account),
    };
  }

  async diagnose(): Promise<SubscriptionEvidence> {
    const { client } = await this.connect();
    try {
      return (await this.evidence(client)).evidence;
    } finally {
      await client.close();
    }
  }

  async openPluginManagement(signal: AbortSignal) {
    if (signal.aborted)
      throw new ExecutionBlocked('cancelled_by_user', 'La operación se ha cancelado.');
    const { client, configuredPluginNames } = await this.connect(undefined, true);
    const stop = () => {
      void client.close().catch(() => {});
    };
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    return {
      configuredPluginNames,
      request: async (method: string, params?: Record<string, unknown>) => {
        if (signal.aborted)
          throw new ExecutionBlocked('cancelled_by_user', 'La operación se ha cancelado.');
        if (
          ![
            'plugin/list',
            'plugin/read',
            'plugin/skill/read',
            'plugin/install',
            'plugin/uninstall',
          ].includes(method)
        )
          throw new ExecutionBlocked(
            'plugin_method_denied',
            'La operación no pertenece a la gestión de plugins.',
          );
        return client.request(method, params);
      },
      close: async () => {
        signal.removeEventListener('abort', stop);
        await client.close();
      },
    };
  }

  async openMcpRegistration(signal: AbortSignal) {
    if (signal.aborted)
      throw new ExecutionBlocked('cancelled_by_user', 'El registro de conexión se ha cancelado.');
    const { client } = await this.connect();
    let closed = false;
    const stop = () => {
      closed = true;
      void client.close().catch(() => {});
    };
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    const check = () => {
      if (closed || signal.aborted)
        throw new ExecutionBlocked('cancelled_by_user', 'El registro de conexión se ha cancelado.');
    };
    const validate = (target: ManagedMcpTarget) => {
      const actual = managedMcpTarget(target.url);
      if (actual.name !== target.name)
        throw new ExecutionBlocked(
          'mcp_registration_target_invalid',
          'El destino de registro no coincide con su dirección.',
        );
    };
    const inspect = async (target: ManagedMcpTarget): Promise<ManagedMcpState> => {
      check();
      validate(target);
      const response = object(await client.request('config/read', { includeLayers: true })),
        config = object(response.config);
      const layers = Array.isArray(response.layers) ? response.layers.map(object) : [];
      const user = layers.filter((layer) => {
        const name = object(layer.name);
        return name.type === 'user' && !name.profile && !layer.disabledReason;
      });
      if (
        user.length !== 1 ||
        typeof user[0].version !== 'string' ||
        !user[0].version ||
        typeof object(user[0].name).file !== 'string' ||
        !isAbsolute(String(object(user[0].name).file))
      )
        throw new ExecutionBlocked(
          'mcp_user_config_unverified',
          'Codex no ha identificado una configuración de usuario y una versión seguras para este registro.',
        );
      const servers = object(config.mcp_servers),
        entry = object(servers[target.name]);
      check();
      return {
        exists: Object.hasOwn(servers, target.name),
        matches: entry.url === target.url && entry.enabled !== false && entry.command === undefined,
        file: object(user[0].name).file as string,
        version: user[0].version as string,
      };
    };
    return {
      inspect,
      register: async (target: ManagedMcpTarget, expected: ManagedMcpState) => {
        const current = await inspect(target);
        if (
          current.exists ||
          current.file !== expected.file ||
          current.version !== expected.version
        )
          throw new ExecutionBlocked(
            'mcp_registration_changed',
            'La configuración cambió o el servidor ya existe. No se sobrescribirá.',
          );
        check();
        const result = object(
          await client.request('config/value/write', {
            keyPath: `mcp_servers.${target.name}`,
            value: { url: target.url, enabled: true, default_tools_approval_mode: 'prompt' },
            mergeStrategy: 'replace',
            filePath: current.file,
            expectedVersion: current.version,
          }),
        );
        check();
        if (
          result.status !== 'ok' ||
          result.filePath !== current.file ||
          typeof result.version !== 'string'
        )
          throw new ExecutionBlocked(
            'mcp_registration_unverified',
            'Codex no acreditó el registro sin sobrescrituras de otra configuración.',
          );
      },
      close: async () => {
        closed = true;
        signal.removeEventListener('abort', stop);
        await client.close();
      },
    };
  }
  private async verifyManagedTarget(client: AppServerProtocol, target: ManagedMcpTarget) {
    if (managedMcpTarget(target.url).name !== target.name)
      throw new ExecutionBlocked('mcp_target_invalid', 'La conexión no coincide con su dirección.');
    const config = object(
      object(await client.request('config/read', { includeLayers: false })).config,
    );
    const server = object(object(config.mcp_servers)[target.name]);
    if (server.url !== target.url || server.enabled === false || server.command !== undefined)
      throw new ExecutionBlocked(
        'mcp_target_changed',
        'La configuración oficial de la conexión cambió. Revisa su registro.',
      );
  }

  async openManagedAuthentication(target: ManagedMcpTarget, signal: AbortSignal) {
    target = { ...target };
    const registration = await this.openMcpRegistration(signal);
    try {
      if (!(await registration.inspect(target)).matches)
        throw new ExecutionBlocked(
          'mcp_target_changed',
          'La conexión oficial no está registrada con esta dirección.',
        );
    } finally {
      await registration.close();
    }
    const client = await this.openAuthentication(signal);
    return {
      request: async (method: string, params?: Record<string, unknown>) => {
        if (method === 'mcpServerStatus/list') {
          const page = object(await client.request(method, { ...params, serverName: target.name }));
          if (
            !Array.isArray(page.data) ||
            page.data.some((raw) => object(raw).name !== target.name || object(raw).pluginId)
          )
            throw new ExecutionBlocked(
              'mcp_catalogue_invalid',
              'El catálogo no corresponde a la conexión autorizada.',
            );
          return page;
        }
        if (method !== 'mcpServer/oauth/login' || params?.name !== target.name)
          throw new ExecutionBlocked(
            'auth_method_denied',
            'La autorización no corresponde a esta conexión.',
          );
        // Re-open the registration reader immediately before requesting OAuth.
        const fresh = await this.openMcpRegistration(signal);
        try {
          if (!(await fresh.inspect(target)).matches)
            throw new ExecutionBlocked(
              'mcp_target_changed',
              'La dirección cambió antes de autorizar.',
            );
        } finally {
          await fresh.close();
        }
        return client.request(method, params);
      },
      onNotification: client.onNotification,
      onDisconnect: client.onDisconnect,
      logout: async (name: string) => {
        if (name !== target.name)
          throw new ExecutionBlocked(
            'auth_method_denied',
            'La desconexión no corresponde a esta conexión.',
          );
        const fresh = await this.openMcpRegistration(signal);
        try {
          if (!(await fresh.inspect(target)).matches)
            throw new ExecutionBlocked(
              'mcp_target_changed',
              'La dirección cambió antes de desconectar.',
            );
        } finally {
          await fresh.close();
        }
        await client.logout(name);
      },
      close: client.close,
    };
  }

  async openManagedMcp(
    project: string,
    target: ManagedMcpTarget,
    signal: AbortSignal,
  ): Promise<RemoteClient> {
    target = { ...target };
    if (managedMcpTarget(target.url).name !== target.name)
      throw new ExecutionBlocked('mcp_target_invalid', 'La conexión no coincide con su dirección.');
    if (signal.aborted) throw new ExecutionBlocked('cancelled_by_user', 'Conexión cancelada.');
    await (this.dependencies.checkMcpEndpoint ?? checkPublicMcpEndpoint)(target.url, signal);
    project = realpathSync(project);
    const connected = await this.connect(project),
      client = connected.client;
    let closed = false;
    const close = async () => {
      closed = true;
      signal.removeEventListener('abort', stop);
      await client.close();
    };
    const stop = () => {
      void close().catch(() => {});
    };
    signal.addEventListener('abort', stop, { once: true });
    const check = () => {
      if (closed || signal.aborted)
        throw new ExecutionBlocked('cancelled_by_user', 'Conexión cancelada.');
    };
    client.onRequest(async (method) => deny(method));
    try {
      check();
      await this.verifyManagedTarget(client, target);
      const before = await this.evidence(client),
        model = before.evidence.models[0]?.id;
      if (!model)
        throw new ExecutionBlocked('model_unavailable', 'No se ha verificado un modelo oficial.');
      const config = appServerThreadConfig({
        project,
        prompt: 'Sesión MCP aprobada, sin inferencia.',
        allowWrites: false,
      });
      config.mcp_servers = Object.fromEntries(
        [...new Set([...connected.configuredMcpNames, target.name])].map((name) => [
          name,
          { enabled: name === target.name, default_tools_approval_mode: 'prompt' },
        ]),
      );
      const started = object(
        await client.request('thread/start', {
          cwd: project,
          model,
          modelProvider: 'openai',
          approvalPolicy: 'on-request',
          config,
          ephemeral: true,
        }),
      );
      if (
        started.modelProvider !== 'openai' ||
        object(started.sandbox).type !== 'readOnly' ||
        object(started.sandbox).networkAccess === true ||
        started.approvalPolicy !== 'on-request' ||
        typeof object(started.thread).id !== 'string'
      )
        throw new ExecutionBlocked(
          'permissions_unconfirmed',
          'Codex no confirmó el aislamiento de la conexión.',
        );
      const threadId = object(started.thread).id as string;
      const tools = async () => {
        check();
        await this.verifyManagedTarget(client, target);
        const all: Array<{ name: string; description?: string; inputSchema: unknown }> = [],
          seen = new Set<string>();
        let cursor: string | undefined;
        let matches = 0;
        do {
          const page = object(
            await client.request('mcpServerStatus/list', {
              threadId,
              serverName: target.name,
              detail: 'toolsAndAuthOnly',
              limit: 100,
              ...(cursor ? { cursor } : {}),
            }),
          );
          if (!Array.isArray(page.data))
            throw new ExecutionBlocked(
              'mcp_catalogue_invalid',
              'El catálogo oficial está incompleto.',
            );
          for (const raw of page.data) {
            const server = object(raw);
            if (
              server.name !== target.name ||
              server.pluginId ||
              (server.httpOrigin && server.httpOrigin !== new URL(target.url).origin)
            )
              throw new ExecutionBlocked(
                'mcp_catalogue_invalid',
                'El catálogo no corresponde a la conexión autorizada.',
              );
            if (server.authStatus === 'notLoggedIn')
              throw new ExecutionBlocked(
                'mcp_auth_required',
                'La conexión necesita inicio de sesión oficial.',
              );
            if (server.toolsError)
              throw new ExecutionBlocked(
                'mcp_tools_unavailable',
                'Codex no pudo cargar las herramientas de la conexión.',
              );
            matches++;
            for (const [name, rawTool] of Object.entries(object(server.tools))) {
              const tool = object(rawTool);
              all.push({
                name,
                ...(typeof tool.description === 'string' ? { description: tool.description } : {}),
                inputSchema: tool.inputSchema ?? {},
              });
            }
          }
          cursor = typeof page.nextCursor === 'string' ? page.nextCursor : undefined;
          if (cursor && seen.has(cursor))
            throw new ExecutionBlocked('mcp_catalogue_invalid', 'El catálogo repite una página.');
          if (cursor) seen.add(cursor);
        } while (cursor);
        if (matches !== 1)
          throw new ExecutionBlocked(
            'mcp_catalogue_invalid',
            'Codex no identificó una única conexión oficial.',
          );
        check();
        return all;
      };
      return {
        listTools: async () => ({ tools: await tools() }),
        callTool: async ({ name, arguments: args }) => {
          const payload = structuredClone(args);
          if (!(await tools()).some((tool) => tool.name === name))
            throw new ExecutionBlocked(
              'mcp_tool_unavailable',
              'La herramienta ya no está disponible.',
            );
          if ((await this.evidence(client)).accountIdentity !== before.accountIdentity)
            throw new ExecutionBlocked('account_changed', 'La cuenta cambió antes de ejecutar.');
          check();
          const response = await client.request('mcpServer/tool/call', {
            threadId,
            server: target.name,
            tool: name,
            arguments: payload,
          });
          check();
          if ((await this.evidence(client)).accountIdentity !== before.accountIdentity)
            throw new ExecutionBlocked(
              'account_changed',
              'La cuenta cambió durante la operación. Revisa el resultado.',
            );
          return response;
        },
        close,
      };
    } catch (error) {
      await close().catch(() => {});
      throw error;
    }
  }

  async openAuthentication(signal: AbortSignal) {
    if (signal.aborted)
      throw new ExecutionBlocked('cancelled_by_user', 'La autorización se ha cancelado.');
    const { client, runtime } = await this.connect();
    let closed = false;
    const stop = () => {
      closed = true;
      void client.close().catch(() => {});
    };
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    return {
      logout: async (name: string) => {
        // Only an exact, currently authenticated catalogue entry can reach the fixed command.
        let cursor: string | undefined,
          matches = 0;
        const seen = new Set<string>();
        do {
          if (closed || signal.aborted)
            throw new ExecutionBlocked('cancelled_by_user', 'La desconexión se ha cancelado.');
          const page = object(
            await client.request('mcpServerStatus/list', {
              limit: 100,
              ...(cursor ? { cursor } : {}),
            }),
          );
          if (!Array.isArray(page.data)) {
            matches = 0;
            break;
          }
          matches += page.data.filter((raw) => {
            const entry = object(raw);
            return entry.name === name && entry.authStatus === 'oAuth';
          }).length;
          cursor = typeof page.nextCursor === 'string' ? page.nextCursor : undefined;
          if (cursor && seen.has(cursor)) {
            matches = 0;
            break;
          }
          if (cursor) seen.add(cursor);
        } while (cursor);
        if (matches !== 1 || closed || signal.aborted)
          throw new ExecutionBlocked(
            'auth_server_changed',
            'El servidor OAuth ya no está disponible para desconectarlo.',
          );
        await (this.dependencies.logoutMcp ?? officialMcpLogout)(
          runtime,
          name,
          safeCliEnvironment(this.env),
          signal,
        );
      },
      request: async (method: string, params?: Record<string, unknown>) => {
        if (signal.aborted)
          throw new ExecutionBlocked('cancelled_by_user', 'La autorización se ha cancelado.');
        if (!['mcpServerStatus/list', 'mcpServer/oauth/login'].includes(method))
          throw new ExecutionBlocked(
            'auth_method_denied',
            'La operación no pertenece a la autenticación oficial.',
          );
        return client.request(method, params);
      },
      onNotification: client.onNotification.bind(client),
      onDisconnect: client.onDisconnect.bind(client),
      close: async () => {
        closed = true;
        signal.removeEventListener('abort', stop);
        await client.close();
      },
    };
  }

  async openApplications(signal: AbortSignal) {
    if (signal.aborted)
      throw new ExecutionBlocked(
        'cancelled_by_user',
        'La consulta de aplicaciones se ha cancelado.',
      );
    const { client } = await this.connect();
    let closed = false;
    const stop = () => {
      closed = true;
      void client.close().catch(() => {});
    };
    signal.addEventListener('abort', stop, { once: true });
    client.onRequest(async (method) => deny(method));
    const request = async (method: string, params: Record<string, unknown>) => {
      if (closed || signal.aborted)
        throw new ExecutionBlocked(
          'cancelled_by_user',
          'La consulta de aplicaciones se ha cancelado.',
        );
      try {
        return await client.request(method, params);
      } catch (error) {
        if (signal.aborted)
          throw new ExecutionBlocked(
            'cancelled_by_user',
            'La consulta de aplicaciones se ha cancelado.',
          );
        throw new ExecutionBlocked(
          'apps_metadata_unavailable',
          /403/.test(String(error))
            ? 'El directorio oficial denegó esta consulta (403). Se conserva el bloqueo; el estado de aplicaciones instaladas es una comprobación distinta.'
            : 'Codex no pudo comprobar los metadatos oficiales de aplicaciones. No se presentará la conexión como lista.',
        );
      }
    };
    return {
      list: (cursor?: string) => request('app/list', { limit: 100, ...(cursor ? { cursor } : {}) }),
      read: (ids: string[]) => request('app/read', { appIds: ids, includeTools: false }),
      installed: (refresh: boolean) => request('app/installed', { forceRefresh: refresh }),
      close: async () => {
        closed = true;
        signal.removeEventListener('abort', stop);
        await client.close();
      },
    };
  }

  async openPluginMcp(project: string, selection: PluginMcpSelection, signal: AbortSignal) {
    if (signal.aborted || !selection.pluginIds.includes(selection.nativeId))
      throw new ExecutionBlocked('cancelled_by_user', 'La conexión del plugin no está disponible.');
    project = realpathSync(project);
    const connected = await this.connect(project, true, selection),
      client = connected.client;
    let closed = false;
    const close = async () => {
      closed = true;
      signal.removeEventListener('abort', stop);
      await client.close();
    };
    const stop = () => {
      void close().catch(() => {});
    };
    signal.addEventListener('abort', stop, { once: true });
    const check = () => {
      if (closed || signal.aborted)
        throw new ExecutionBlocked('cancelled_by_user', 'La conexión del plugin se ha cancelado.');
    };
    client.onRequest(async (method) => deny(method));
    try {
      check();
      const before = await this.evidence(client),
        model = before.evidence.models[0]?.id;
      if (!model)
        throw new ExecutionBlocked('model_unavailable', 'No se ha verificado un modelo oficial.');
      const config = appServerThreadConfig({
        project,
        prompt: 'Sesión técnica MCP aprobada, sin inferencia.',
        allowWrites: false,
      });
      config['features.plugins'] = true;
      config.plugins = Object.fromEntries(
        selection.pluginIds.map((id) => [id, { enabled: id === selection.nativeId }]),
      );
      config.mcp_servers = Object.fromEntries(
        connected.configuredMcpNames.map((id) => [id, { enabled: false }]),
      );
      const started = object(
        await client.request('thread/start', {
          cwd: project,
          model,
          modelProvider: 'openai',
          approvalPolicy: 'on-request',
          config,
          ephemeral: true,
        }),
      );
      if (
        started.modelProvider !== 'openai' ||
        object(started.sandbox).type !== 'readOnly' ||
        object(started.sandbox).networkAccess === true ||
        started.approvalPolicy !== 'on-request' ||
        typeof object(started.thread).id !== 'string'
      )
        throw new ExecutionBlocked(
          'permissions_unconfirmed',
          'Codex no confirmó el aislamiento de la sesión MCP del plugin.',
        );
      const threadId = object(started.thread).id as string;
      const list = async () => {
        check();
        const data: unknown[] = [],
          seen = new Set<string>();
        let cursor: string | undefined;
        do {
          const page = object(
            await client.request('mcpServerStatus/list', {
              threadId,
              limit: 100,
              ...(cursor ? { cursor } : {}),
            }),
          );
          if (!Array.isArray(page.data))
            throw new ExecutionBlocked(
              'plugin_catalogue_incomplete',
              'El catálogo MCP del plugin está incompleto.',
            );
          data.push(...page.data.filter((raw) => object(raw).pluginId === selection.nativeId));
          cursor = typeof page.nextCursor === 'string' ? page.nextCursor : undefined;
          if (cursor && seen.has(cursor))
            throw new ExecutionBlocked(
              'plugin_catalogue_incomplete',
              'El catálogo MCP del plugin repite una página.',
            );
          if (cursor) seen.add(cursor);
        } while (cursor);
        check();
        return { data, nextCursor: null };
      };
      return {
        list,
        call: async (server: string, tool: string, args: Record<string, unknown>) => {
          check();
          const current = (await list()).data
            .map(object)
            .filter((s) => s.name === server && s.pluginId === selection.nativeId);
          if (current.length !== 1 || !Object.hasOwn(object(current[0].tools), tool))
            throw new ExecutionBlocked(
              'plugin_tool_unavailable',
              'La herramienta no pertenece al plugin conectado.',
            );
          const evidence = await this.evidence(client);
          if (evidence.accountIdentity !== before.accountIdentity)
            throw new ExecutionBlocked(
              'account_changed',
              'La cuenta cambió antes de la operación MCP.',
            );
          const response = await client.request('mcpServer/tool/call', {
            threadId,
            server,
            tool,
            arguments: args,
          });
          check();
          if ((await this.evidence(client)).accountIdentity !== before.accountIdentity)
            throw new ExecutionBlocked(
              'account_changed',
              'La cuenta cambió durante la operación MCP. Revisa el resultado.',
            );
          return response;
        },
        close,
      };
    } catch (error) {
      await close().catch(() => {});
      throw error;
    }
  }
  async openIntegrations(project: string, signal: AbortSignal) {
    if (signal.aborted)
      throw new ExecutionBlocked('cancelled_by_user', 'La operación se ha cancelado.');
    project = realpathSync(project);
    const connected = await this.connect(project),
      client = connected.client;
    const stop = () => {
      void client.close().catch(() => {});
    };
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    client.onRequest(async (method) => deny(method));
    let threadId: string | undefined;
    const check = () => {
      if (signal.aborted)
        throw new ExecutionBlocked('cancelled_by_user', 'La operación se ha cancelado.');
    };
    return {
      list: async () => {
        check();
        return client.request('mcpServerStatus/list', { limit: 100 });
      },
      call: async (tool: string, args: Record<string, unknown>) => {
        check();
        const before = await this.evidence(client);
        if (!threadId) {
          const model =
            before.evidence.models.find((m) => m.id === 'gpt-6.1-sol')?.id ??
            before.evidence.models[0]?.id;
          if (!model)
            throw new ExecutionBlocked(
              'model_unavailable',
              'No se ha verificado un modelo oficial.',
            );
          const config = appServerThreadConfig({
            project,
            prompt: 'Sesión técnica para una operación aprobada, sin inferencia.',
            allowWrites: false,
          });
          config.mcp_servers = Object.fromEntries(
            connected.configuredMcpNames.map((name) => [
              name,
              { enabled: name === 'codex_apps', default_tools_approval_mode: 'prompt' },
            ]),
          );
          const started = object(
            await client.request('thread/start', {
              cwd: project,
              model,
              modelProvider: 'openai',
              approvalPolicy: 'on-request',
              config,
              ephemeral: true,
            }),
          );
          if (
            started.modelProvider !== 'openai' ||
            object(started.sandbox).type !== 'readOnly' ||
            object(started.sandbox).networkAccess === true ||
            started.approvalPolicy !== 'on-request' ||
            typeof object(started.thread).id !== 'string'
          )
            throw new ExecutionBlocked(
              'permissions_unconfirmed',
              'Codex no confirmó el aislamiento de la sesión técnica.',
            );
          threadId = object(started.thread).id as string;
        }
        check();
        const result = await client.request('mcpServer/tool/call', {
          threadId,
          server: 'codex_apps',
          tool,
          arguments: args,
        });
        if ((await this.evidence(client)).accountIdentity !== before.accountIdentity)
          throw new ExecutionBlocked(
            'account_changed',
            'La cuenta cambió durante la operación. Revisa su resultado.',
          );
        return result;
      },
      close: async () => {
        signal.removeEventListener('abort', stop);
        await client.close();
      },
    };
  }

  /** Discovery is metadata-only. Connected apps still require approval at every call. */
  async discoverTools(project?: string): Promise<AppServerToolDiscovery> {
    const { runtime, client } = await this.connect(project);
    const result: AppServerToolDiscovery = {
      checkedAt: Date.now(),
      cliVersion: runtime.version,
      installedApps: { verified: false, items: [] },
      apps: { verified: false, items: [] },
      skills: { verified: false, items: [] },
      mcp: { verified: false, items: [] },
    };
    const safeName = (value: unknown): string =>
      typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, '').slice(0, 200) : '';
    const pages = async (method: string): Promise<unknown[]> => {
      let cursor: unknown;
      const items: unknown[] = [];
      const seen = new Set<string>();
      for (;;) {
        const page = object(
          await client.request(method, {
            limit: 100,
            ...(typeof cursor === 'string' ? { cursor } : {}),
          }),
        );
        if (!Array.isArray(page.data)) throw new Error('invalid catalog');
        items.push(...page.data);
        cursor = page.nextCursor;
        if (cursor === null || cursor === undefined) return items;
        if (typeof cursor !== 'string' || seen.has(cursor)) throw new Error('incomplete catalog');
        seen.add(cursor);
      }
    };
    try {
      await Promise.all([
        client
          .request('app/installed', { forceRefresh: true })
          .then((raw) => {
            const apps = object(raw).apps;
            if (!Array.isArray(apps)) return;
            result.installedApps = {
              verified: true,
              items: apps
                .map((raw) => {
                  const app = object(raw);
                  return {
                    id: safeName(app.id),
                    name: safeName(app.runtimeName) || 'Aplicación instalada',
                    enabled: app.enabled === true,
                    callable: app.callable === true,
                  };
                })
                .filter((app) => !!app.id),
            };
          })
          .catch(() => {}),
        pages('app/list')
          .then((items) => {
            result.apps = {
              verified: true,
              items: items
                .map((raw) => {
                  const item = object(raw);
                  return {
                    id: safeName(item.id),
                    name: safeName(item.name),
                    connected: item.isAccessible === true,
                    enabled: item.isEnabled === true,
                  };
                })
                .filter((item) => !!item.id && !!item.name),
            };
          })
          .catch((error) => {
            result.apps.errorCode =
              error instanceof ExecutionBlocked ? error.code : 'discovery_failed';
          }),
        client
          .request('skills/list', {
            cwds: project ? [realpathSync(project)] : [],
            forceReload: false,
          })
          .then((response) => {
            const data = object(response).data;
            if (!Array.isArray(data)) return;
            result.skills = {
              verified: true,
              items: data
                .flatMap((raw) =>
                  Array.isArray(object(raw).skills) ? (object(raw).skills as unknown[]) : [],
                )
                .map((raw) => ({
                  name: safeName(object(raw).name),
                  enabled: object(raw).enabled === true,
                }))
                .filter((item) => !!item.name),
            };
          })
          .catch(() => {}),
        pages('mcpServerStatus/list')
          .then((items) => {
            result.mcp = {
              verified: true,
              items: items
                .map((raw) => {
                  const item = object(raw);
                  return {
                    name: safeName(item.name),
                    authStatus: safeName(item.authStatus),
                    tools: Object.keys(object(item.tools)).length,
                  };
                })
                .filter((item) => !!item.name),
            };
          })
          .catch(() => {}),
      ]);
      return result;
    } finally {
      await client.close();
    }
  }

  async execute(options: ExecuteOptions): Promise<RunRecord> {
    if (options.ownedWorkspace)
      throw new ExecutionBlocked(
        'isolated_engine_required',
        'Este ejecutor no adopta espacios AO implícitamente.',
      );
    if (options.parallelReadOnly && options.allowWrites)
      throw new ExecutionBlocked(
        'parallel_write_forbidden',
        'La escritura requiere ejecución exclusiva.',
      );
    if (
      options.timeoutMs !== undefined &&
      options.timeoutMs !== null &&
      (!Number.isFinite(options.timeoutMs) || options.timeoutMs < 1)
    )
      throw new ExecutionBlocked('invalid_timeout', 'El plazo debe ser positivo o ilimitado.');
    if (
      options.maxReportedTokens !== undefined &&
      (!Number.isSafeInteger(options.maxReportedTokens) || options.maxReportedTokens < 1)
    )
      throw new ExecutionBlocked('invalid_token_budget', 'El presupuesto debe ser positivo.');
    const project = realpathSync(options.project);
    if (
      !statSync(project).isDirectory() ||
      !options.prompt.trim() ||
      options.prompt.length > 100_000
    )
      throw new ExecutionBlocked('invalid_task', 'Indica una carpeta y una tarea válida.');
    const images = imageInputs(options.imagePaths);
    const config = appServerThreadConfig(options);
    const model = options.model ?? 'gpt-6.1-sol';
    const effort = options.effort ?? 'low';
    const record: RunRecord = {
      version: 1,
      id: randomUUID(),
      provider: 'codex',
      billing: 'subscription-only',
      engine: 'codex-app-server',
      officeRole: options.officeRole,
      project,
      requestedModel: model,
      requestedEffort: effort,
      confirmedModel: null,
      sessionId: null,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      status: 'checking',
      reasonCode: null,
      inputTokens: null,
      outputTokens: null,
      cachedInputTokens: null,
      contextFingerprint: options.contextFingerprint,
      sessionMode: 'new',
      toolCalls: 0,
    };
    mkdirSync(this.stateDir, { recursive: true, mode: 0o700 });
    const release = acquireCodexLease(this.stateDir, record.id, options.parallelReadOnly === true);
    const controller = new AbortController();
    let approvalController = new AbortController();
    let activeExecution: ActiveExecution | undefined;
    const executionKey = options.executionSessionKey ?? record.id;
    let client: AppServerProtocol | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polling: Promise<void> | undefined;
    let checkingAccount: Promise<void> | undefined;
    let verifiedIdentity: string | undefined;
    let accountUpdatedBeforeVerification = false;
    let finish: (() => void) | undefined;
    let ended = false;
    let turnCompleted = false;
    let turnId: string | undefined;
    const objectiveKey = options.officeRole === 'chief' ? options.objectiveSessionKey : undefined;
    const priorSession = objectiveKey ? this.objectiveSessions.get(objectiveKey) : undefined;
    let cumulative: { input: number; output: number; cached: number | null } | undefined;
    const save = () => {
      record.updatedAt = Date.now();
      const path = join(this.stateDir, `${record.id}.json`);
      writeFileSync(path + '.tmp', JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
      renameSync(path + '.tmp', path);
      options.onState?.({ ...record });
    };
    const stop = (reason: string, status: 'paused' | 'cancelled' = 'paused') => {
      if (ended) return;
      ended = true;
      controller.abort();
      approvalController.abort();
      if (activeExecution) activeExecution.stopped = true;
      if (record.inputTokens !== null && record.outputTokens !== null) {
        record.observedUsage = {
          inputTokens: record.inputTokens,
          outputTokens: record.outputTokens,
          cachedInputTokens: record.cachedInputTokens ?? null,
        };
        record.inputTokens = null;
        record.outputTokens = null;
        record.cachedInputTokens = null;
      }
      record.status = status;
      record.reasonCode = reason;
      save();
      if (client && record.sessionId && turnId)
        void client
          .request('turn/interrupt', { threadId: record.sessionId, turnId })
          .catch(() => {});
      if (client) void client.close().catch(() => {});
      finish?.();
    };
    const abort = () =>
      stop(
        options.interruptionReason?.() === 'redirected_by_user' ||
          options.signal?.reason === 'redirected_by_user'
          ? 'redirected_by_user'
          : 'cancelled_by_user',
        'cancelled',
      );
    try {
      save();
      if (options.signal?.aborted) {
        abort();
        return record;
      }
      const connected = await this.connect(project);
      client = connected.client;
      if (options.toolServer && connected.configuredMcpNames.includes('office'))
        throw new ExecutionBlocked(
          'tool_namespace_conflict',
          'Ya existe una conexión MCP llamada office. No se mezclan sus permisos con el navegador privado de la oficina.',
        );
      client.onNotification((method) => {
        if (method !== 'account/updated' || ended) return;
        if (!verifiedIdentity) {
          accountUpdatedBeforeVerification = true;
          return;
        }
        if (checkingAccount) return;
        checkingAccount = Promise.resolve()
          .then(() => client!.request('account/read', { refreshToken: false }))
          .then((account) => {
            if (accountIdentity(account) !== verifiedIdentity) stop('account_changed');
          })
          .catch(() => stop('verification_lost'))
          .finally(() => {
            checkingAccount = undefined;
          });
      });
      // TOML table overrides merge with user configuration. Explicitly disable each
      // inherited MCP server; an empty table alone does not remove node_repl etc.
      config.mcp_servers = {
        ...Object.fromEntries(
          connected.configuredMcpNames.map((name) => [name, { enabled: false }]),
        ),
        ...object(config.mcp_servers),
      };
      client.onDisconnect(() => stop('app_server_disconnected'));
      const verified = await this.evidence(client);
      verifiedIdentity = verified.accountIdentity;
      if (accountUpdatedBeforeVerification) {
        const account = await client.request('account/read', { refreshToken: false });
        if (accountIdentity(account) !== verifiedIdentity) stop('account_changed');
      }
      verifyChoice(verified.evidence, model, effort);
      const entries = object(verified.models).data;
      const selected = Array.isArray(entries)
        ? entries.find((entry) => object(entry).model === model || object(entry).id === model)
        : undefined;
      const supportsImages =
        Array.isArray(object(selected).inputModalities) &&
        (object(selected).inputModalities as unknown[]).includes('image');
      if (images.length) {
        if (!supportsImages)
          throw new ExecutionBlocked(
            'image_model_unverified',
            'Este modelo no confirma soporte de imágenes.',
          );
      }
      record.cliVersion = connected.runtime.version;
      record.subscriptionCheckedAt = verified.evidence.checkedAt;
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();
      if (ended) return record;
      const localFileApprovals = new LocalFileApprovals(project, options.allowWrites === true);
      client.onRequest(async (method, params) => {
        if (params.threadId && params.threadId !== record.sessionId) return deny(method);
        if (ended || approvalController.signal.aborted) return deny(method);
        if (method === 'item/fileChange/requestApproval')
          return {
            decision: localFileApprovals.accept(params, record.sessionId, turnId)
              ? 'accept'
              : 'decline',
          };
        if (method === 'item/permissions/requestApproval') return deny(method);
        if (method === 'item/commandExecution/requestApproval' && !options.allowWrites)
          return deny(method);
        if (
          ended ||
          ![
            'item/commandExecution/requestApproval',
            'item/fileChange/requestApproval',
            'item/permissions/requestApproval',
            'mcpServer/elicitation/request',
            'item/tool/requestUserInput',
          ].includes(method)
        )
          return deny(method);
        options.onToolActivity?.('Esperando tu confirmación');
        if (!this.dependencies.approvals) return deny(method);
        const approvalRevision = approvalController;
        const response = await this.dependencies.approvals.request({
          runId: record.id,
          taskId: options.executionSessionKey ?? record.id,
          method,
          params,
          signal: approvalRevision.signal,
        });
        if (ended || approvalRevision.signal.aborted) return deny(method);
        // Session grants and persistent exec/network amendments are never accepted.
        const value = object(response);
        if (
          'decision' in value &&
          !['accept', 'decline', 'cancel'].includes(String(value.decision))
        )
          return deny(method);
        if (value.scope === 'session') return deny(method);
        return response;
      });
      const completed = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const seen = new Set<string>();
      const progress = new Map<
        string,
        { id: string; title: string; detail?: string; completed: boolean }
      >();
      const sensitiveProgress = new Set<string>();
      const reportProgress = (event: {
        id: string;
        title: string;
        detail?: string;
        completed: boolean;
      }) => {
        if (
          event.detail &&
          /password|secret|api[_-]?key|authorization|credential|bearer\s|access[_-]?token/i.test(
            event.detail,
          )
        )
          sensitiveProgress.add(event.id);
        const safe = {
          ...event,
          detail: sensitiveProgress.has(event.id)
            ? '[Contenido sensible ocultado]'
            : event.detail && event.detail.length > 8000
              ? event.detail.slice(0, 2000) +
                '\n[… vista abreviada …]\n' +
                event.detail.slice(-6000)
              : event.detail,
        };
        progress.set(event.id, safe);
        options.onProgress?.(safe);
      };
      client.onNotification((method, params) => {
        if (ended) return;
        if (params.threadId && params.threadId !== record.sessionId) return;
        localFileApprovals.observe(method, params);
        if (
          (method === 'item/commandExecution/outputDelta' ||
            method === 'item/reasoning/summaryTextDelta') &&
          typeof params.itemId === 'string' &&
          typeof params.delta === 'string'
        ) {
          const previous = progress.get(params.itemId);
          reportProgress({
            id: params.itemId,
            title:
              previous?.title ??
              (method.includes('reasoning') ? 'Pensando' : 'Ejecutando un comando'),
            detail: (previous?.detail ?? '') + params.delta,
            completed: false,
          });
        }
        if (method === 'turn/started' && !turnId && typeof object(params.turn).id === 'string')
          turnId = object(params.turn).id as string;
        if (method === 'thread/tokenUsage/updated') {
          if (turnId && typeof params.turnId === 'string' && params.turnId !== turnId) return;
          const usage = object(object(params.tokenUsage).total);
          const input = count(usage.inputTokens),
            output = count(usage.outputTokens),
            cached = count(usage.cachedInputTokens);
          cumulative = input !== null && output !== null ? { input, output, cached } : undefined;
          record.inputTokens =
            input === null || input < (priorSession?.input ?? 0)
              ? null
              : input - (priorSession?.input ?? 0);
          record.outputTokens =
            output === null || output < (priorSession?.output ?? 0)
              ? null
              : output - (priorSession?.output ?? 0);
          record.cachedInputTokens =
            cached === null ||
            (priorSession && priorSession.cached === null) ||
            cached < (priorSession?.cached ?? 0)
              ? null
              : cached - (priorSession?.cached ?? 0);
          if (
            record.cachedInputTokens !== null &&
            (record.inputTokens === null || record.cachedInputTokens > record.inputTokens)
          )
            record.cachedInputTokens = null;
          save();
        }
        if (method === 'item/started' || method === 'item/completed') {
          const item = object(params.item);
          const type = String(item.type);
          const titles: Record<string, string> = {
            reasoning: 'Pensando',
            commandExecution: 'Ejecutando un comando',
            fileChange: 'Modificando archivos',
            agentMessage: 'Preparando la respuesta',
            webSearch: 'Buscando información',
            imageGeneration: 'Generando una imagen',
            imageView: 'Revisando una imagen',
            mcpToolCall: 'Usando una herramienta',
          };
          if (titles[type] && typeof item.id === 'string') {
            const detail =
              type === 'reasoning' && Array.isArray(item.summary)
                ? item.summary.filter((v) => typeof v === 'string').join('\n\n')
                : type === 'agentMessage' &&
                    item.phase === 'commentary' &&
                    typeof item.text === 'string'
                  ? item.text
                  : type === 'commandExecution'
                    ? [item.command, item.aggregatedOutput]
                        .filter((v) => typeof v === 'string')
                        .join('\n')
                    : type === 'mcpToolCall'
                      ? JSON.stringify(
                          {
                            tool: item.tool ?? item.name,
                            arguments: item.arguments,
                            result: item.result,
                          },
                          null,
                          2,
                        )
                      : type === 'fileChange' && Array.isArray(item.changes)
                        ? item.changes
                            .map(
                              (c) =>
                                String(object(c).path ?? '') + '\n' + String(object(c).diff ?? ''),
                            )
                            .join('\n')
                        : type === 'webSearch'
                          ? JSON.stringify(
                              { query: item.query, queries: item.queries, action: item.action },
                              null,
                              2,
                            )
                          : undefined;
            reportProgress({
              id: item.id,
              title:
                type === 'mcpToolCall' && typeof (item.tool ?? item.name) === 'string'
                  ? `${titles[type]}: ${String(item.tool ?? item.name)
                      .replace(/[\r\n]/g, ' ')
                      .slice(0, 160)}`
                  : titles[type],
              detail: detail || progress.get(item.id)?.detail,
              completed: method === 'item/completed',
            });
          }
          options.onActivity?.(
            type === 'fileChange' ? 'working' : type === 'reasoning' ? 'thinking' : 'reading',
          );
          if (type === 'webSearch') options.onToolActivity?.('Buscando información');
          if (type === 'imageGeneration') options.onToolActivity?.('Generando una imagen');
          if (type === 'imageView') options.onToolActivity?.('Revisando una imagen');
          if (type === 'mcpToolCall') {
            const tool = String(item.tool ?? item.name ?? '');
            options.onToolActivity?.(
              tool.startsWith('desktop_')
                ? 'Usando Windows'
                : tool.startsWith('browser_')
                  ? 'Usando el navegador'
                  : 'Usando herramientas de la oficina',
            );
          }
          if (method === 'item/completed' && typeof item.id === 'string' && !seen.has(item.id)) {
            seen.add(item.id);
            if (type === 'agentMessage' && typeof item.text === 'string')
              options.onOutput?.(item.text + '\n\n');
            if (
              [
                'commandExecution',
                'fileChange',
                'webSearch',
                'mcpToolCall',
                'imageGeneration',
                'imageView',
              ].includes(type)
            )
              record.toolCalls = (record.toolCalls ?? 0) + 1;
            if (type === 'imageGeneration') {
              const artifact = generatedImage(item, options);
              if (artifact) options.onArtifact?.(artifact);
            }
            if (type === 'webSearch' && !item.error && item.status !== 'failed')
              options.onCapabilityVerified?.('web-search');
          }
        }
        if (method === 'turn/completed') {
          const turn = object(params.turn);
          if (turnId && turn.id !== turnId) return;
          if (turn.status !== 'completed')
            return stop(turn.status === 'interrupted' ? 'turn_interrupted' : 'turn_failed');
          turnCompleted = true;
          if (activeExecution) activeExecution.completed = true;
          finish?.();
        }
        if (method === 'error' && params.willRetry !== true) stop('app_server_turn_error');
      });
      if (
        priorSession &&
        (priorSession.project !== project ||
          priorSession.model !== model ||
          priorSession.account !== verifiedIdentity)
      )
        throw new ExecutionBlocked(
          'chief_session_changed',
          'La cuenta, el modelo o la carpeta del Jefe ha cambiado. Revisa el objetivo antes de continuar.',
        );
      record.sessionMode = priorSession ? 'resume' : 'new';
      const started = object(
        await client.request(priorSession ? 'thread/resume' : 'thread/start', {
          ...(priorSession ? { threadId: priorSession.threadId } : {}),
          cwd: project,
          model,
          modelProvider: 'openai',
          approvalPolicy: 'on-request',
          config,
          developerInstructions:
            CODEX_TASK_PREFIX +
            'Comunica brevemente tu actividad observable antes de iniciar una búsqueda, ejecutar comandos o editar archivos: qué vas a comprobar y para qué. Son actualizaciones públicas para el usuario, no razonamiento interno. No anuncies una herramienta como ejecutada antes de recibir su resultado. ' +
            'Todos los empleados disponen del mismo catálogo de herramientas; los permisos de escritura dependen del papel. Puedes inspeccionar archivos y ejecutar comprobaciones dentro del proyecto. Si un comando falla, distingue ese fallo de una herramienta ausente: descubre las herramientas MCP office y utiliza project_list, project_read, project_checks y project_check_run cuando corresponda. No extrapoles un fallo de un comando a todos los empleados ni des por vigentes diagnósticos antiguos; comprueba el acceso actual. Un permiso denegado debe respetarse. Las acciones externas y desconocidas requieren aprobación específica. Usa las herramientas de la oficina para navegador y Windows. Para generar imágenes consulta y sigue la skill imagegen completa, sin resumir sus instrucciones. Guarda los recursos generados en la carpeta de artefactos autorizada. No actives subagentes nativos.',
        }),
      );
      if (ended) return record;
      record.sessionId =
        typeof object(started.thread).id === 'string'
          ? (object(started.thread).id as string)
          : null;
      record.confirmedModel = typeof started.model === 'string' ? started.model : null;
      if (priorSession && (record.sessionId !== priorSession.threadId || started.cwd !== project))
        throw new ExecutionBlocked(
          'chief_session_unconfirmed',
          'Codex no confirmó la conversación anterior del Jefe.',
        );
      if (
        !record.sessionId ||
        record.confirmedModel !== model ||
        started.modelProvider !== 'openai'
      )
        throw new ExecutionBlocked(
          'model_unconfirmed',
          'Codex no confirmó la sesión y el modelo solicitados.',
        );
      const sandbox = object(started.sandbox);
      if (
        sandbox.type !== (options.allowWrites ? 'workspaceWrite' : 'readOnly') ||
        sandbox.networkAccess === true ||
        started.approvalPolicy !== 'on-request'
      )
        throw new ExecutionBlocked(
          'permissions_unconfirmed',
          'Codex no confirmó los permisos locales y el aislamiento de red solicitados.',
        );
      record.status = 'running';
      save();
      poll = setInterval(() => {
        if (polling || ended || turnCompleted || !client) return;
        polling = this.evidence(client)
          .then((current) => {
            if (current.accountIdentity !== verifiedIdentity) stop('account_changed');
          })
          .catch((error) =>
            stop(error instanceof ExecutionBlocked ? error.code : 'verification_lost'),
          )
          .finally(() => {
            polling = undefined;
          });
      }, this.dependencies.pollMs ?? 8000);
      if (options.timeoutMs !== undefined && options.timeoutMs !== null)
        timer = setTimeout(() => stop('time_limit'), options.timeoutMs);
      const turn = object(
        await client.request('turn/start', {
          threadId: record.sessionId,
          model,
          effort,
          input: [
            { type: 'text', text: options.prompt },
            ...images.map((path) => ({ type: 'localImage', path })),
          ],
        }),
      );
      turnId =
        typeof object(turn.turn).id === 'string' ? (object(turn.turn).id as string) : undefined;
      if (!turnId) throw new ExecutionBlocked('turn_unconfirmed', 'Codex no confirmó el turno.');
      if (!ended && !turnCompleted) {
        if (this.active.has(executionKey))
          throw new ExecutionBlocked(
            'execution_session_conflict',
            'Ya existe una ejecución con esta identidad.',
          );
        activeExecution = {
          client,
          threadId: record.sessionId,
          turnId,
          supportsImages,
          stopped: false,
          completed: false,
          invalidateApprovals: () => {
            localFileApprovals.clear();
            approvalController.abort();
            approvalController = new AbortController();
          },
        };
        this.active.set(executionKey, activeExecution);
      }
      await completed;
      await polling;
      await checkingAccount;
      if (record.status === 'running') {
        await options.waitForTools?.(controller.signal);
        if (record.status !== 'running') return record;
        const finalEvidence = await this.evidence(client);
        if (finalEvidence.accountIdentity !== verifiedIdentity) stop('account_changed');
        if (record.status !== 'running') return record;
        record.status = 'completed';
        if (record.inputTokens === null || record.outputTokens === null) {
          record.status = 'paused';
          record.reasonCode = 'usage_unknown';
        } else if (
          options.maxReportedTokens !== undefined &&
          record.inputTokens + record.outputTokens >= options.maxReportedTokens
        ) {
          record.status = 'paused';
          record.reasonCode = 'token_budget';
        }
        if (record.status === 'completed' && images.length)
          options.onCapabilityVerified?.('images');
        if (objectiveKey && record.status === 'completed' && cumulative && record.sessionId)
          this.objectiveSessions.set(objectiveKey, {
            threadId: record.sessionId,
            project,
            model,
            account: verifiedIdentity!,
            ...cumulative,
          });
        save();
        ended = true;
      }
    } catch (error) {
      if (record.status === 'checking' || record.status === 'running') {
        record.status = record.status === 'running' ? 'paused' : 'blocked';
        record.reasonCode = error instanceof ExecutionBlocked ? error.code : 'execution_unverified';
        save();
      }
    } finally {
      if (objectiveKey && record.status !== 'completed')
        this.objectiveSessions.delete(objectiveKey);
      ended = true;
      controller.abort();
      approvalController.abort();
      if (activeExecution) {
        activeExecution.stopped = true;
        if (this.active.get(executionKey) === activeExecution) this.active.delete(executionKey);
      }
      if (poll) clearInterval(poll);
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      try {
        await polling;
      } finally {
        try {
          await client?.close();
        } catch {
          // Cleanup must preserve the receipt's original reason and always free its lease.
        } finally {
          release();
        }
      }
    }
    return record;
  }
}
