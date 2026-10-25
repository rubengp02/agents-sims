import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';

import type { TeamTask } from '../../../core/src/team.js';
import { stopProcess } from './cliProcess.js';
import { inspectSelfWorkspace } from './selfWorkspace.js';
import { ExecutionBlocked } from './types.js';
import { type OwnedWorkspace, verifiedWorkspace } from './workflowWorkspace.js';

export interface CheckRunner {
  /** Public metadata only, never executable names, arguments or logs. */
  describe?(): Array<{ id: string; acceptance: boolean }>;
  authorizeWorkspace?(workspace: OwnedWorkspace): void;
  authorizeSelfWorkspace?(receiptPath: string): Promise<void>;
  has(id: string): boolean;
  hasAcceptance(ids: string[]): boolean;
  covers?(ids: string[], criteria: string[]): boolean;
  run(
    ids: string[],
    project: string,
    signal: AbortSignal,
  ): Promise<NonNullable<TeamTask['localChecks']>>;
}
export interface LocalCheckCommand {
  executable: string;
  args: string[];
  timeoutMs: number;
  acceptance?: boolean;
  /** Exact criteria covered, supplied by local code, never by an LLM/HTTP body. */
  criteria?: string[];
}

/** Registry is supplied by local application code, never by a task/model/HTTP request. */
export class LocalChecks implements CheckRunner {
  private readonly ownedWorkspaces = new Set<string>();
  async authorizeSelfWorkspace(receiptPath: string): Promise<void> {
    const { receipt } = await inspectSelfWorkspace(receiptPath);
    if (!this.allowedProject || realpathSync(this.allowedProject) !== receipt.sourceRoot)
      throw new ExecutionBlocked(
        'check_project_mismatch',
        'La copia no pertenece al proyecto de estas comprobaciones.',
      );
    this.ownedWorkspaces.add(realpathSync(receipt.workspaceRoot));
  }
  authorizeWorkspace(workspace: OwnedWorkspace) {
    verifiedWorkspace(workspace);
    if (this.allowedProject && realpathSync(this.allowedProject) !== workspace.project)
      throw new ExecutionBlocked(
        'check_project_mismatch',
        'Las pruebas pertenecen a otro proyecto.',
      );
    this.ownedWorkspaces.add(realpathSync(workspace.path));
  }
  private readonly commands: Readonly<Record<string, LocalCheckCommand>>;
  describe() {
    return Object.entries(this.commands).map(([id, command]) => ({
      id,
      acceptance: command.acceptance === true,
    }));
  }
  constructor(
    commands: Record<string, LocalCheckCommand>,
    private readonly logDir: string,
    private readonly allowedProject?: string,
  ) {
    this.commands = structuredClone(commands);
  }
  has(id: string) {
    return Object.hasOwn(this.commands, id);
  }
  hasAcceptance(ids: string[]) {
    return ids.some((id) => this.has(id) && this.commands[id].acceptance === true);
  }
  covers(ids: string[], criteria: string[]) {
    const covered = new Set(
      ids.flatMap((id) =>
        this.commands[id]?.acceptance ? (this.commands[id].criteria ?? []) : [],
      ),
    );
    return criteria.length > 0 && criteria.every((criterion) => covered.has(criterion));
  }
  async run(ids: string[], project: string, signal: AbortSignal) {
    if (
      this.allowedProject &&
      realpathSync(project) !== realpathSync(this.allowedProject) &&
      !this.ownedWorkspaces.has(realpathSync(project))
    ) {
      let owned = false;
      try {
        const rel = relative(
          realpathSync(join(this.allowedProject, '.local-office/agent-orchestrator/workspaces')),
          realpathSync(project),
        );
        const common = (dir: string) =>
          realpathSync(
            execFileSync(
              'git',
              ['-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
              { encoding: 'utf8', windowsHide: true },
            ).trim(),
          );
        owned =
          !!rel &&
          !rel.startsWith('..') &&
          !isAbsolute(rel) &&
          common(project) === common(this.allowedProject);
      } catch {
        /* Unknown workspace ownership never authorizes a check. */
      }
      if (!owned)
        throw new ExecutionBlocked(
          'check_project_mismatch',
          'Las comprobaciones pertenecen a otro proyecto.',
        );
    }
    if (ids.some((id) => !this.has(id)))
      throw new ExecutionBlocked('check_unconfigured', 'Comprobación local no configurada.');
    const results: NonNullable<TeamTask['localChecks']> = [];
    mkdirSync(this.logDir, { recursive: true, mode: 0o700 });
    for (const id of [...new Set(ids)]) {
      if (signal.aborted) throw new ExecutionBlocked('checks_cancelled', 'Comprobación cancelada.');
      const command = this.commands[id];
      const started = Date.now();
      const fd = openSync(join(this.logDir, `${randomUUID()}.log`), 'w', 0o600);
      const child = spawn(command.executable, command.args, {
        cwd: project,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', fd, fd],
      });
      closeSync(fd);
      let timedOut = false;
      const stop = () => {
        void stopProcess(child);
      };
      const timer = setTimeout(() => {
        timedOut = true;
        stop();
      }, command.timeoutMs);
      signal.addEventListener('abort', stop, { once: true });
      if (signal.aborted) stop();
      const exitCode = await new Promise<number | null>((resolve) => {
        child.once('error', () => resolve(null));
        child.once('close', resolve);
      });
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
      if (timedOut || signal.aborted) await stopProcess(child);
      results.push({
        id,
        exitCode,
        durationMs: Date.now() - started,
        passed: exitCode === 0 && !timedOut && !signal.aborted,
      });
      if (!results.at(-1)!.passed) break;
    }
    return results;
  }
}

/** Existing project scripts, configured by this local launcher, not by the model. */
export function pixelOfficeChecks(
  project: string,
  npmCli = process.env.npm_execpath ??
    join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
): LocalChecks | undefined {
  if (
    !npmCli ||
    !isAbsolute(npmCli) ||
    !existsSync(npmCli) ||
    !existsSync(join(project, 'scripts/context-study.test.mjs'))
  )
    return undefined;
  const scripts = ['check-types', 'lint', 'test', 'package'] as const;
  return new LocalChecks(
    Object.fromEntries([
      ...scripts.map((id) => [
        id,
        {
          executable: process.execPath,
          args: [npmCli, 'run', id],
          timeoutMs: 180_000,
          acceptance: id === 'test',
        },
      ]),
      [
        'context-study',
        {
          executable: process.execPath,
          args: ['--test', 'scripts/context-study.test.mjs', 'scripts/pilot-policy.test.mjs'],
          timeoutMs: 30_000,
        },
      ],
    ]),
    join(project, '.local-office/check-logs'),
    project,
  );
}
