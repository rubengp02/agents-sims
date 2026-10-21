import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

import type { TeamWorkflow } from '../../../core/src/team.js';
import type { CheckRunner } from './localChecks.js';
import { captureRevision, type FileRevision } from './reviewPacket.js';
import { ExecutionBlocked } from './types.js';

export interface OwnedWorkspace {
  readonly id: string;
  readonly workflowId: string;
  readonly workerId: string;
  readonly project: string;
  readonly path: string;
  readonly baseSHA: string;
}
const handles = new WeakMap<OwnedWorkspace, string>();
const ownedRoots = new Set<string>();
export function verifiedWorkspace(value: OwnedWorkspace): void {
  if (!value || !handles.has(value))
    throw new ExecutionBlocked('workspace_unowned', 'Espacio no acreditado por el gestor local.');
  const common = (p: string) =>
    realpathSync(git(p, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim());
  // One fresh Git process can report all three identities. Do not cache these:
  // replacing a worktree or changing HEAD must still invalidate its capability.
  const [directory, commonDirectory, head, ...extra] = git(value.path, [
    'rev-parse',
    '--path-format=absolute',
    '--git-dir',
    '--git-common-dir',
    'HEAD',
  ])
    .trim()
    .split(/\r?\n/);
  if (
    extra.length ||
    !directory ||
    !commonDirectory ||
    !head ||
    realpathSync(value.path) !== value.path ||
    realpathSync(value.project) !== value.project ||
    realpathSync(directory) !== handles.get(value) ||
    realpathSync(value.path) === realpathSync(value.project) ||
    realpathSync(commonDirectory) !== common(value.project) ||
    head !== value.baseSHA
  )
    throw new ExecutionBlocked('workspace_changed_base', 'La identidad o base del espacio cambió.');
}
function git(project: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync('git', ['-C', project, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 40_000_000,
    ...(env ? { env } : {}),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
export function validateOwnedFiles(files: unknown): string[] {
  if (
    !Array.isArray(files) ||
    files.length < 1 ||
    files.length > 100 ||
    files.some(
      (p) =>
        typeof p !== 'string' ||
        !p ||
        p.length > 240 ||
        p.includes('\\') ||
        p.includes('\0') ||
        /[\r\n:*?\[\]]/.test(p) ||
        isAbsolute(p) ||
        p
          .split('/')
          .some(
            (part: string) =>
              !part || ['.', '..', '.git', '.local-office', 'node_modules'].includes(part),
          ),
    )
  )
    throw new ExecutionBlocked(
      'invalid_ownership',
      'Indica archivos propios relativos y concretos.',
    );
  return [...new Set(files as string[])].sort();
}
function changed(base: FileRevision, current: FileRevision) {
  return [...new Set([...Object.keys(base.files), ...Object.keys(current.files)])]
    .filter((p) => base.files[p] !== current.files[p])
    .sort();
}
export interface WorkspaceResult {
  handle: OwnedWorkspace;
  revision: FileRevision;
  ownedFiles: string[];
  changedFiles: string[];
}

/** Uses AO's pinned worktree adapter in production. No model or credential operations. */
export class WorkflowWorkspaceManager {
  private readonly bases = new Map<string, FileRevision>();
  private readonly integrations = new Map<string, OwnedWorkspace>();
  constructor(
    private readonly managedRoot: string,
    private readonly evidenceRoot: string,
    private readonly create: (
      project: string,
      id: string,
      baseSHA: string,
      signal?: AbortSignal,
    ) => Promise<string>,
  ) {}
  async prepare(
    project: string,
    workflowId: string,
    workerId: string,
    baseSHA?: string,
    signal?: AbortSignal,
  ): Promise<OwnedWorkspace> {
    project = realpathSync(project);
    if (git(project, ['status', '--porcelain']).trim())
      throw new ExecutionBlocked(
        'ao_dirty_project',
        'Conserva los cambios del proyecto antes del aislamiento; no se han modificado.',
      );
    const head = git(project, ['rev-parse', 'HEAD']).trim();
    if (baseSHA && head !== baseSHA)
      throw new ExecutionBlocked(
        'workspace_changed_base',
        'El proyecto cambió desde el inicio del flujo.',
      );
    const id = randomUUID().replaceAll('-', '');
    this.persist(workflowId, id + '-preparation.json', {
      workerId,
      project,
      baseSHA: head,
      status: 'preparing',
    });
    if (signal?.aborted)
      throw new ExecutionBlocked(
        'preparation_cancelled',
        'Preparación detenida antes del arranque.',
      );
    const workspace = realpathSync(await this.create(project, id, head, signal));
    if (signal?.aborted)
      throw new ExecutionBlocked(
        'preparation_cancelled',
        'Preparación detenida; conserva el espacio creado.',
      );
    const rel = relative(realpathSync(this.managedRoot), workspace);
    if (!rel || rel.startsWith('..') || isAbsolute(rel))
      throw new ExecutionBlocked('workspace_unowned', 'El adaptador devolvió una carpeta ajena.');
    if (ownedRoots.has(workspace))
      throw new ExecutionBlocked('workspace_unowned', 'Esta copia ya pertenece a otro trabajador.');
    const handle = Object.freeze({
      id,
      project,
      workflowId,
      workerId,
      path: workspace,
      baseSHA: head,
    });
    handles.set(
      handle,
      realpathSync(git(workspace, ['rev-parse', '--path-format=absolute', '--git-dir']).trim()),
    );
    verifiedWorkspace(handle);
    const base = captureRevision(workspace);
    // Git may legitimately materialize LF/CRLF differently in two clean trees.
    // Commit identity plus a clean index/worktree verifies the common Git base;
    // byte fingerprints below bind each concrete candidate after materialization.
    if (
      git(workspace, ['status', '--porcelain']).trim() ||
      git(project, ['rev-parse', 'HEAD']).trim() !== head ||
      git(project, ['status', '--porcelain']).trim()
    )
      throw new ExecutionBlocked(
        'workspace_base_mismatch',
        'La copia no coincide con la base del proyecto.',
      );
    this.bases.set(id, base);
    ownedRoots.add(workspace);
    this.persist(workflowId, id + '-workspace.json', handle);
    return handle;
  }
  require(handle: OwnedWorkspace) {
    verifiedWorkspace(handle);
    if (!this.bases.has(handle.id))
      throw new ExecutionBlocked(
        'workspace_unowned',
        'Espacio de otro gestor o recuperación pendiente.',
      );
  }
  verifyIntegrated(workflow: TeamWorkflow): void {
    const handle = this.integrations.get(workflow.id);
    if (!handle || workflow.candidateProject !== handle.path || !workflow.candidateHash)
      throw new ExecutionBlocked('workspace_unowned', 'Falta acreditar el candidato integrado.');
    this.require(handle);
    if (captureRevision(handle.path).digest !== workflow.candidateHash)
      throw new ExecutionBlocked(
        'workspace_result_stale',
        'El candidato integrado cambió después de sus pruebas o revisión.',
      );
    if (
      git(workflow.project, ['rev-parse', 'HEAD']).trim() !== handle.baseSHA ||
      git(workflow.project, ['status', '--porcelain']).trim()
    )
      throw new ExecutionBlocked(
        'workspace_changed_base',
        'El proyecto original cambió antes de aceptar el conjunto.',
      );
  }
  seal(handle: OwnedWorkspace, owned: string[]): WorkspaceResult {
    this.require(handle);
    const ownedFiles = validateOwnedFiles(owned),
      revision = captureRevision(handle.path);
    const unexpected = changed(this.bases.get(handle.id)!, revision).filter(
      (p) => !ownedFiles.includes(p),
    );
    if (unexpected.length)
      throw new ExecutionBlocked(
        'workspace_scope_changed',
        'El trabajador modificó archivos fuera de su propiedad.',
      );
    this.persist(handle.workflowId, handle.id + '-result.json', {
      candidateHash: revision.digest,
      ownedFiles,
      changed: changed(this.bases.get(handle.id)!, revision),
    });
    return {
      handle,
      revision,
      ownedFiles,
      changedFiles: changed(this.bases.get(handle.id)!, revision),
    };
  }
  private persist(workflowId: string, name: string, data: unknown) {
    // IDs are generated by the coordinator, never paths supplied by a model.
    if (!/^[\w-]{1,100}$/.test(workflowId))
      throw new ExecutionBlocked('invalid_workflow', 'Identidad de flujo incorrecta.');
    const dir = join(this.evidenceRoot, workflowId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, name), JSON.stringify(data, null, 2), { flag: 'wx', mode: 0o600 });
  }
  async integrate(
    workflow: TeamWorkflow,
    results: WorkspaceResult[],
    checks: CheckRunner,
    signal: AbortSignal,
  ): Promise<OwnedWorkspace> {
    if (
      results.length !== 2 ||
      results.some(
        (r) => r.handle.workflowId !== workflow.id || r.handle.project !== workflow.project,
      )
    )
      throw new ExecutionBlocked('workspace_unowned', 'Resultados de flujos distintos.');
    for (const r of results) {
      this.require(r.handle);
      if (captureRevision(r.handle.path).digest !== r.revision.digest)
        throw new ExecutionBlocked(
          'workspace_result_stale',
          'Un resultado cambió después de sus pruebas.',
        );
    }
    const target = await this.prepare(
      workflow.project,
      workflow.id,
      'integration',
      workflow.baseSHA,
      signal,
    );
    checks.authorizeWorkspace?.(target);
    workflow.candidateProject = target.path;
    this.integrations.set(workflow.id, target);
    for (const [index, r] of results.entries()) {
      if (signal.aborted)
        throw new ExecutionBlocked('integration_cancelled', 'Integración cancelada.');
      const indexFile = resolve(this.evidenceRoot, workflow.id, r.handle.id + '-index');
      const env = { ...process.env, GIT_INDEX_FILE: indexFile };
      git(r.handle.path, ['read-tree', r.handle.baseSHA], env);
      const names = r.ownedFiles.filter(
        (p) =>
          Object.hasOwn(r.revision.files, p) ||
          Object.hasOwn(this.bases.get(r.handle.id)!.files, p),
      );
      if (names.length)
        git(r.handle.path, ['--literal-pathspecs', 'add', '-A', '--', ...names], env);
      const patch = git(
        r.handle.path,
        [
          'diff',
          '--cached',
          '--binary',
          '--full-index',
          '--no-ext-diff',
          '--no-textconv',
          r.handle.baseSHA,
        ],
        env,
      );
      if (captureRevision(r.handle.path).digest !== r.revision.digest)
        throw new ExecutionBlocked(
          'workspace_result_stale',
          'El resultado cambió durante la generación del parche.',
        );
      const name = `${index}-${r.handle.id}.patch`;
      this.persist(workflow.id, name + '.json', {
        hash: createHash('sha256').update(patch).digest('hex'),
        bytes: Buffer.byteLength(patch),
      });
      const patchFile = resolve(this.evidenceRoot, workflow.id, name);
      writeFileSync(patchFile, patch, { flag: 'wx', mode: 0o600 });
      if (patch) {
        try {
          git(target.path, ['apply', '--check', '--index', patchFile]);
          git(target.path, ['apply', '--index', patchFile]);
        } catch {
          throw new ExecutionBlocked(
            'integration_conflict',
            'Conflicto de integración: se conservan copias y parches; no se inicia IA.',
          );
        }
      }
    }
    const candidate = captureRevision(target.path);
    // The applied bytes must equal precisely the two sealed contributions.
    const expected = { ...this.bases.get(target.id)!.files };
    for (const r of results)
      for (const name of changed(this.bases.get(r.handle.id)!, r.revision)) {
        if (Object.hasOwn(r.revision.files, name)) expected[name] = r.revision.files[name];
        else delete expected[name];
      }
    if (
      JSON.stringify(Object.entries(expected).sort()) !==
      JSON.stringify(Object.entries(candidate.files).sort())
    )
      throw new ExecutionBlocked(
        'integration_scope_changed',
        'El candidato no coincide con las aportaciones selladas.',
      );
    workflow.localChecks = await checks.run(workflow.context.checks, target.path, signal);
    if (
      signal.aborted ||
      !workflow.localChecks.length ||
      workflow.localChecks.some((c) => !c.passed)
    )
      throw new ExecutionBlocked(
        'integration_checks_failed',
        'El conjunto no supera las comprobaciones obligatorias.',
      );
    if (captureRevision(target.path).digest !== candidate.digest)
      throw new ExecutionBlocked(
        'checks_changed_files',
        'Las pruebas alteraron el candidato integrado.',
      );
    if (
      git(workflow.project, ['rev-parse', 'HEAD']).trim() !== target.baseSHA ||
      git(workflow.project, ['status', '--porcelain']).trim()
    )
      throw new ExecutionBlocked(
        'workspace_changed_base',
        'El proyecto original cambió durante el flujo.',
      );
    workflow.candidateHash = candidate.digest;
    this.persist(workflow.id, 'integration.json', {
      candidateHash: candidate.digest,
      checks: workflow.localChecks,
    });
    return target;
  }
}
