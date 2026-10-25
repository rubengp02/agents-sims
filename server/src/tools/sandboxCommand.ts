import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import { type CliRuntime, discoverCodex, stopProcess } from '../execution/cliProcess.js';
import { safeCliEnvironment } from '../execution/subscriptionPolicy.js';
import { ExecutionBlocked } from '../execution/types.js';

export interface SandboxedCommandOptions {
  project: string;
  executable: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  trustedExtraEnv?: Partial<
    Record<'PIXEL_OFFICE_PREVIEW' | 'PIXEL_OFFICE_STATE_DIR' | 'PIXEL_OFFICE_PREVIEW_NONCE', string>
  >;
  signal?: AbortSignal;
  /** Windows permits all loopback destinations. Port-scoped loopback is unsupported. */
  allowLoopback?: boolean | { port: number };
  /** Trusted backend-owned state directories; never accept these from a tool argument. */
  writableRoots?: string[];
}
export interface SandboxedCommandDependencies {
  discover?: () => Promise<CliRuntime>;
  launch?: (
    runtime: CliRuntime,
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv },
  ) => ChildProcessWithoutNullStreams;
  platform?: NodeJS.Platform;
}
export interface SandboxedCommand {
  child: ChildProcessWithoutNullStreams;
  networkPolicy: 'external-denied-loopback-unrestricted';
  close(): Promise<void>;
}

/** No model or account request. The official CLI only starts its native OS sandbox. */
export async function startSandboxedCommand(
  input: SandboxedCommandOptions,
  dependencies: SandboxedCommandDependencies = {},
): Promise<SandboxedCommand> {
  if ((dependencies.platform ?? process.platform) !== 'win32')
    throw new ExecutionBlocked(
      'command_sandbox_unsupported',
      'El auxiliar de comandos aislados solo se ha verificado en Windows.',
    );
  // Do not advertise stronger network guarantees than the actual Windows sandbox.
  if (input.allowLoopback !== true)
    throw new ExecutionBlocked(
      'sandbox_loopback_scope_unsupported',
      'El aislamiento de Windows bloquea Internet, pero permite todos los puertos locales. Este proceso necesita una política local explícita; no se ejecutó sin aislamiento suficiente.',
    );
  if (input.signal?.aborted)
    throw new ExecutionBlocked('cancelled_by_user', 'El encargo se ha detenido.');
  const sourceEnv = input.env ?? process.env;
  const env = safeCliEnvironment(sourceEnv);
  if (
    Object.keys(input.trustedExtraEnv ?? {}).some(
      (key) =>
        !['PIXEL_OFFICE_PREVIEW', 'PIXEL_OFFICE_STATE_DIR', 'PIXEL_OFFICE_PREVIEW_NONCE'].includes(
          key,
        ),
    )
  )
    throw new ExecutionBlocked(
      'invalid_sandbox_environment',
      'La vista previa solicita variables no autorizadas.',
    );
  for (const key of [
    'PIXEL_OFFICE_PREVIEW',
    'PIXEL_OFFICE_STATE_DIR',
    'PIXEL_OFFICE_PREVIEW_NONCE',
  ]) {
    const value =
      input.trustedExtraEnv?.[
        key as keyof NonNullable<SandboxedCommandOptions['trustedExtraEnv']>
      ] ?? sourceEnv[key];
    if (value !== undefined) {
      if (value.includes('\0') || value.length > 4000)
        throw new ExecutionBlocked(
          'invalid_sandbox_environment',
          'La configuración de la vista previa no es válida.',
        );
      env[key] = value;
    }
  }
  const project = realpathSync(input.project);
  if (
    !statSync(project).isDirectory() ||
    !isAbsolute(input.executable) ||
    !statSync(input.executable).isFile() ||
    !Array.isArray(input.args) ||
    input.args.some((a) => typeof a !== 'string' || a.includes('\0') || a.length > 100_000)
  )
    throw new ExecutionBlocked('invalid_sandbox_command', 'El comando local aislado no es válido.');
  const runtime = await (dependencies.discover?.() ?? discoverCodex(input.env ?? process.env));
  if (input.signal?.aborted)
    throw new ExecutionBlocked('cancelled_by_user', 'El encargo se ha detenido.');
  const profile = `office-command-${randomUUID()}`;
  const writableRoots = (input.writableRoots ?? []).map((root) => {
    if (!isAbsolute(root))
      throw new ExecutionBlocked(
        'invalid_sandbox_root',
        'El estado privado del proceso debe usar una carpeta absoluta.',
      );
    const resolved = realpathSync(root);
    if (!statSync(resolved).isDirectory())
      throw new ExecutionBlocked(
        'invalid_sandbox_root',
        'La carpeta privada del proceso no está disponible.',
      );
    return resolved;
  });
  const args = [
    'sandbox',
    '-P',
    profile,
    '--cd',
    project,
    '-c',
    'windows.sandbox="elevated"',
    '-c',
    `permissions.${profile}.extends=":workspace"`,
    '-c',
    `permissions.${profile}.network.enabled=false`,
    ...(writableRoots.length
      ? [
          '-c',
          `permissions.${profile}.filesystem={${writableRoots.map((root) => `${JSON.stringify(root)}="write"`).join(',')}}`,
        ]
      : []),
    '-c',
    'shell_environment_policy.inherit="all"',
    '-c',
    'shell_environment_policy.ignore_default_excludes=false',
    '--',
    realpathSync(input.executable),
    ...input.args,
  ];
  const child =
    dependencies.launch?.(runtime, args, { cwd: project, env }) ??
    spawn(runtime.executable, args, { cwd: project, env, windowsHide: true, stdio: 'pipe' });
  let stopping: Promise<void> | undefined;
  const close = (): Promise<void> => {
    input.signal?.removeEventListener('abort', abort);
    stopping ??= stopProcess(child);
    return stopping;
  };
  const abort = () => {
    void close();
  };
  input.signal?.addEventListener('abort', abort, { once: true });
  if (input.signal?.aborted) abort();
  child.once('close', () => input.signal?.removeEventListener('abort', abort));
  return { child, close, networkPolicy: 'external-denied-loopback-unrestricted' };
}
