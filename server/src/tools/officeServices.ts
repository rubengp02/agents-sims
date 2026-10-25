import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { promisify } from 'node:util';

import type { OfficeArtifact } from '../../../core/src/artifacts.js';
import type { OfficeCapability } from '../../../core/src/officeTools.js';
import type { TeamTask } from '../../../core/src/team.js';
import { stopProcess } from '../execution/cliProcess.js';
import type { CheckRunner } from '../execution/localChecks.js';
import { projectRevisionCapture } from '../execution/projectRevision.js';
import {
  createSelfWorkspace,
  inspectSelfWorkspace,
  integrateSelfWorkspace,
  isSelfProject,
  rehomeSelfWorkspace,
} from '../execution/selfWorkspace.js';
import { safeCliEnvironment } from '../execution/subscriptionPolicy.js';
import { ExecutionBlocked } from '../execution/types.js';
import { ArtifactStore } from './artifactStore.js';
import { ConnectionManager } from './connectionManager.js';
import { startOfficeMcp } from './officeMcp.js';
import { type AuthenticationOpener, OfficialAuthentication } from './officialAuthentication.js';
import type { OfficialIntegrations } from './officialIntegrations.js';
import type { OfficialPlugins } from './officialPlugins.js';
import { OperationReviewRegistry } from './operationReviews.js';
import { OfficeToolRuntime, type OfficeToolSession } from './toolRuntime.js';

const execAsync = promisify(execFile);

/** Owned resources and tool authority remain on the server, outside project source. */
export class OfficeServices {
  readonly artifacts: ArtifactStore;
  readonly connections: ConnectionManager;
  readonly authentications: OfficialAuthentication;
  readonly runtime: OfficeToolRuntime;
  readonly operationReviews: OperationReviewRegistry;
  private active = new Map<
    string,
    { task: TeamTask; session: OfficeToolSession; close?: () => Promise<void> }
  >();
  private checked = new Map<string, OfficeCapability>();
  private ready = false;
  private capabilitySave: Promise<void> = Promise.resolve();
  constructor(
    readonly directory: string,
    readonly hostRoot: string,
    desktopHelper?: string,
  ) {
    this.artifacts = new ArtifactStore(join(directory, 'images'));
    this.operationReviews = new OperationReviewRegistry(directory);
    this.connections = new ConnectionManager(join(directory, 'connections'));
    this.authentications = new OfficialAuthentication(join(directory, 'authentication-history'));
    this.runtime = new OfficeToolRuntime({
      stateDir: join(directory, 'tools'),
      desktopHelper,
      connections: this.connections,
      authentications: this.authentications,
      saveArtifact: async ({ taskId, filename, data }) => {
        const task = this.active.get(taskId)?.task;
        if (!task)
          throw new ExecutionBlocked('tool_session_closed', 'El encargo ya no está activo.');
        const artifact = await this.artifacts.put({
          name: filename,
          bytes: data,
          kind: 'screenshot',
          taskId,
          conversationId: task.conversationId,
        });
        task.artifacts = [...(task.artifacts ?? []), artifact];
        return artifact;
      },
    });
  }
  async initialize(): Promise<void> {
    await this.artifacts.initialize();
    await this.connections.initialize();
    await this.authentications.initialize();
    const saved = await readFile(join(this.directory, 'capabilities.json'), 'utf8').catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
        return '[]';
      },
    );
    const records: unknown = JSON.parse(saved);
    if (
      !Array.isArray(records) ||
      records.some(
        (c) =>
          !c ||
          typeof c.id !== 'string' ||
          typeof c.name !== 'string' ||
          typeof c.reason !== 'string' ||
          !['unverified', 'available', 'needs_connection', 'incompatible', 'blocked'].includes(
            c.state,
          ) ||
          (c.lastCheckedAt !== null && typeof c.lastCheckedAt !== 'string'),
      )
    )
      throw new Error('El catálogo guardado de herramientas necesita revisión.');
    for (const capability of records) this.checked.set(capability.id, capability);
    this.ready = true;
  }
  capabilities(): OfficeCapability[] {
    const declared: OfficeCapability[] = [
      {
        id: 'images',
        name: 'Inspección de imágenes',
        state: this.ready ? 'unverified' : 'blocked',
        reason: this.ready
          ? 'Adjuntos preparados. La lectura visual se verifica con el modelo al ejecutar.'
          : 'No se ha abierto el almacén de imágenes.',
        lastCheckedAt: null,
      },
      {
        id: 'web-search',
        name: 'Búsqueda web',
        state: 'unverified',
        reason: 'Requiere sesión ChatGPT, cuota y disponibilidad en Codex.',
        lastCheckedAt: null,
      },
      {
        id: 'image-generation',
        name: 'Generación de imágenes',
        state: 'unverified',
        reason:
          'Utiliza la herramienta nativa y cuota incluida; pendiente de comprobar con una generación.',
        lastCheckedAt: null,
      },
      {
        id: 'integrations',
        name: 'Aplicaciones, plugins y skills',
        state: 'needs_connection',
        reason:
          'Consulta las conexiones compatibles del ejecutor. No se heredan herramientas exclusivas del escritorio.',
        lastCheckedAt: null,
      },
      ...this.runtime.capabilities(),
      ...this.connections.capabilities(),
    ];
    for (const { session } of this.active.values())
      for (const c of session.capabilities()) if (c.lastCheckedAt) this.setCapability(c);
    return [
      ...declared.map((c) => this.checked.get(c.id) ?? c),
      ...[...this.checked.values()].filter((c) => !declared.some((d) => d.id === c.id)),
    ];
  }
  setCapability(capability: OfficeCapability): void {
    if (JSON.stringify(this.checked.get(capability.id)) === JSON.stringify(capability)) return;
    this.checked.set(capability.id, capability);
    const content = JSON.stringify([...this.checked.values()]);
    const saving = this.capabilitySave
      .catch(() => {})
      .then(async () => {
        const temporary = join(this.directory, `capabilities-${randomUUID()}.tmp`);
        await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
        await rename(temporary, join(this.directory, 'capabilities.json'));
      });
    void saving.catch(() => {});
    this.capabilitySave = saving;
  }
  async bindAttachments(
    ids: unknown,
    conversationId: string,
    taskId?: string,
  ): Promise<OfficeArtifact[]> {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string'))
      throw new ExecutionBlocked('invalid_attachments', 'Revisa las imágenes adjuntas.');
    return this.artifacts.bind(ids, conversationId, taskId);
  }
  async prepareSelf(task: TeamTask, signal?: AbortSignal): Promise<void> {
    if (!isSelfProject(task.project, this.hostRoot)) return;
    if (signal?.aborted)
      throw new ExecutionBlocked('cancelled_by_user', 'El encargo se ha detenido.');
    const privateRelative = relative(
      join(process.env.LOCALAPPDATA ?? homedir(), 'AgentsSims'),
      this.directory,
    );
    const useAccessibleRoot =
      process.platform === 'win32' &&
      !privateRelative.startsWith('..') &&
      !isAbsolute(privateRelative);
    const workspacesRoot = useAccessibleRoot
      ? join(
          homedir(),
          'CodexOfficeWorkspaces',
          createHash('sha256').update(this.directory).digest('hex').slice(0, 16),
        )
      : join(this.directory, 'workspaces');
    let receipt = task.selfWorkspaceReceipt
      ? (await inspectSelfWorkspace(task.selfWorkspaceReceipt)).receipt
      : await createSelfWorkspace({
          sourceRoot: task.project,
          workspacesRoot,
        });
    if (
      useAccessibleRoot &&
      (relative(workspacesRoot, receipt.workspaceRoot).startsWith('..') ||
        isAbsolute(relative(workspacesRoot, receipt.workspaceRoot)))
    )
      receipt = await rehomeSelfWorkspace(receipt.receiptPath, workspacesRoot);
    if (receipt.sourceRoot !== (await realpath(task.project)))
      throw new ExecutionBlocked(
        'self_workspace_scope',
        'La copia no pertenece al proyecto del encargo.',
      );
    task.selfWorkspaceReceipt = receipt.receiptPath;
    task.executionProject = receipt.workspaceRoot;
    // Separate dependencies; never link the live office's node_modules into an editable copy.
    const hostRelative = relative(task.project, this.hostRoot);
    const dependencyRoot = existsSync(join(receipt.workspaceRoot, 'package-lock.json'))
      ? receipt.workspaceRoot
      : hostRelative && !hostRelative.startsWith('..') && !isAbsolute(hostRelative)
        ? join(receipt.workspaceRoot, hostRelative)
        : receipt.workspaceRoot;
    if (existsSync(join(dependencyRoot, 'package-lock.json'))) {
      const lockHash = createHash('sha256')
        .update(await readFile(join(dependencyRoot, 'package-lock.json')))
        .digest('hex');
      const marker = join(dirname(receipt.receiptPath), 'dependencies.ready');
      if ((await readFile(marker, 'utf8').catch(() => '')) === lockHash) return;
      const npm =
        process.env.npm_execpath ??
        join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
      const install = execAsync(
        process.execPath,
        [npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'],
        {
          cwd: dependencyRoot,
          env: safeCliEnvironment(process.env),
          windowsHide: true,
          maxBuffer: 2_000_000,
        },
      );
      const abort = () => {
        void stopProcess(install.child);
      };
      signal?.addEventListener('abort', abort, { once: true });
      try {
        if (signal?.aborted) abort();
        await install;
        if (signal?.aborted) throw new Error('cancelled');
        await writeFile(marker, lockHash, { mode: 0o600 });
      } catch {
        throw new ExecutionBlocked(
          signal?.aborted ? 'cancelled_by_user' : 'self_dependencies_failed',
          'La copia está conservada, pero no se pudieron preparar sus dependencias. Revisa el encargo antes de continuar.',
        );
      } finally {
        signal?.removeEventListener('abort', abort);
      }
    }
  }
  async integrateSelf(task: TeamTask, reviewedDigest: string): Promise<void> {
    if (!task.selfWorkspaceReceipt) return;
    const { changes } = await inspectSelfWorkspace(task.selfWorkspaceReceipt);
    if (!changes.length) return;
    const candidate = projectRevisionCapture(task.executionProject ?? task.project)();
    if (candidate.digest !== reviewedDigest)
      throw new ExecutionBlocked(
        'self_review_outdated',
        'La copia cambió después de la revisión. El Tester debe comprobar su estado actualizado.',
      );
    const integrated = await integrateSelfWorkspace({
      receiptPath: task.selfWorkspaceReceipt,
      reviewedPaths: changes.map((c) => c.path),
      reviewedSnapshot: candidate,
    });
    if (integrated.conflicts.length)
      throw new ExecutionBlocked(
        'self_workspace_conflict',
        'El proyecto original cambió. Se conservan la copia y los archivos en conflicto; no se han sobrescrito los cambios ajenos.',
      );
  }
  async hasSelfChanges(task: TeamTask): Promise<boolean> {
    return (
      !!task.selfWorkspaceReceipt &&
      (await inspectSelfWorkspace(task.selfWorkspaceReceipt)).changes.length > 0
    );
  }
  async execution(
    task: TeamTask,
    signal: AbortSignal,
    checks?: CheckRunner,
    memory?: () => unknown,
    discoverCapabilities?: () => Promise<unknown>,
    plugins?: OfficialPlugins,
    authenticationProvider?: AuthenticationOpener,
    integrations?: OfficialIntegrations,
    officialConnections?: import('./toolRuntime.js').OfficeToolSessionOptions['officialConnections'],
    applications?: import('./officialApplications.js').OfficialApplications,
  ) {
    const outputDirectory = join(this.directory, 'outputs', task.id);
    await mkdir(outputDirectory, { recursive: true });
    const imagePaths = await Promise.all(
      [...(task.attachments ?? []), ...(task.referenceImages ?? [])].map((a) =>
        this.artifacts.path(a.id),
      ),
    );
    const effectiveProject = task.executionProject ?? task.project;
    const appRelative = relative(task.project, this.hostRoot);
    const previewProject =
      task.executionProject &&
      isSelfProject(task.project, this.hostRoot) &&
      appRelative &&
      !appRelative.startsWith('..') &&
      !isAbsolute(appRelative)
        ? join(effectiveProject, appRelative)
        : effectiveProject;
    const session = this.runtime.createSession({
      taskId: task.id,
      conversationId: task.conversationId,
      role: task.role,
      allowWrites: task.allowWrites,
      project: previewProject,
      projectRoot: effectiveProject,
      objectiveMemory: memory,
      discoverCapabilities,
      plugins,
      authenticationProvider,
      integrations,
      officialConnections,
      applications,
      onIntegrationVerified: (tool) =>
        this.setCapability({
          id: `operation:${tool}`,
          name: `Operación: ${tool}`,
          state: 'available',
          reason:
            'El puente oficial devolvió un resultado sin error para esta operación. No acredita otras herramientas ni autoriza operaciones futuras.',
          lastCheckedAt: new Date().toISOString(),
        }),
      projectChecks: checks
        ? {
            list: () => checks.describe?.() ?? [],
            run: async (id) => checks.run([id], effectiveProject, signal),
          }
        : undefined,
      signal,
      previewOrigins: [],
    });
    this.active.set(task.id, { task, session });
    try {
      const mcp = await startOfficeMcp(session);
      const close = async () => {
        for (const c of session.capabilities()) if (c.lastCheckedAt) this.setCapability(c);
        this.runtime.approvals.cancelTask(task.id);
        this.active.delete(task.id);
        await mcp.close();
      };
      this.active.set(task.id, { task, session, close });
      return {
        imagePaths,
        artifactDirectory: outputDirectory,
        toolServer: { url: mcp.url, token: mcp.secret },
        waitForIdle: (signal: AbortSignal) => session.waitForIdle(signal),
        close,
      };
    } catch (error) {
      this.active.delete(task.id);
      await session.dispose();
      throw error;
    }
  }
  async generated(task: TeamTask, file: string): Promise<void> {
    const root = await realpath(join(this.directory, 'outputs', task.id));
    const resolved = await realpath(file),
      rel = relative(root, resolved);
    if (!rel || rel.startsWith('..') || isAbsolute(rel))
      throw new ExecutionBlocked(
        'artifact_outside_scope',
        'La imagen generada está fuera del encargo.',
      );
    const artifact = await this.artifacts.put({
      name: basename(resolved),
      bytes: await readFile(resolved),
      kind: 'generated',
      conversationId: task.conversationId,
      taskId: task.id,
    });
    task.artifacts = [...(task.artifacts ?? []), artifact];
    this.setCapability({
      id: 'image-generation',
      name: 'Generación de imágenes',
      state: 'available',
      reason: 'Se ha recibido y validado una imagen de la herramienta nativa.',
      lastCheckedAt: new Date().toISOString(),
    });
  }
  async close(): Promise<void> {
    this.authentications.close();
    this.runtime.approvals.close();
    await Promise.allSettled(
      [...this.active.values()].map((v) => (v.close ? v.close() : v.session.dispose())),
    );
    this.active.clear();
    await this.capabilitySave;
  }
}
