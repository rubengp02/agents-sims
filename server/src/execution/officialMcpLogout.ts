import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';

import { type CliRuntime, stopProcess } from './cliProcess.js';

/** Fixed official CLI action. Never accepts commands, arguments, or credential data from a model. */
export async function officialMcpLogout(
  runtime: CliRuntime,
  name: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  launch = (executable: string, args: string[]) =>
    spawn(executable, args, { env, windowsHide: true, shell: false, stdio: 'pipe' }),
): Promise<void> {
  if (signal.aborted) throw new Error('La desconexión se ha cancelado.');
  if (!name || name.includes('\0')) throw new Error('El servidor no es válido.');
  const child: ChildProcessWithoutNullStreams = launch(runtime.executable, [
    'mcp',
    'logout',
    '--',
    name,
  ]);
  // Discard provider diagnostics rather than retaining credentials or authenticated URLs.
  child.stdout.resume();
  child.stderr.resume();
  child.stdin.end();
  await new Promise<void>((resolve, reject) => {
    const stop = () => {
      void stopProcess(child);
    };
    const timer = setTimeout(stop, 30000);
    signal.addEventListener('abort', stop, { once: true });
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
    };
    child.once('error', () => {
      cleanup();
      reject(new Error('No se pudo iniciar el cierre de sesión oficial.'));
    });
    child.once('close', (code) => {
      cleanup();
      if (code === 0 && !signal.aborted) resolve();
      else reject(new Error('No se pudo confirmar el cierre de sesión oficial.'));
    });
    if (signal.aborted) stop();
  });
}
