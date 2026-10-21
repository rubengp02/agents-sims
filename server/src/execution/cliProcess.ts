import { type ChildProcess, type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { createInterface } from 'node:readline';

import { object, safeCliEnvironment } from './subscriptionPolicy.js';
import { ExecutionBlocked } from './types.js';

export interface CliRuntime {
  executable: string;
  version: string;
}
export interface MetadataClient {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
  onInvalidated?(listener: () => void): () => void;
  close(): Promise<void>;
}

export async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    // Fixed executable + structured arguments. Only the child process we own.
    await new Promise<void>((resolve) => {
      const killer = spawn(
        join(process.env.SYSTEMROOT ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
        ['/pid', String(child.pid), '/t', '/f'],
        { windowsHide: true, stdio: 'ignore' },
      );
      killer.on('error', () => {
        child.kill();
        resolve();
      });
      killer.on('close', () => resolve());
    });
  } else {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 1000);
      child.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

export async function discoverCodex(env = process.env): Promise<CliRuntime> {
  const safeEnv = safeCliEnvironment(env);
  const name = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const candidates = new Set<string>();
  if (process.platform === 'win32' && env.LOCALAPPDATA) {
    const base = join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    if (existsSync(base))
      for (const entry of readdirSync(base, { withFileTypes: true })) {
        if (entry.isDirectory()) candidates.add(join(base, entry.name, name));
      }
    candidates.add(join(env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin', name));
  }
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH');
  for (const dir of (env[pathKey ?? 'PATH'] ?? '').split(delimiter))
    if (isAbsolute(dir)) candidates.add(join(dir, name));
  const runtimes: CliRuntime[] = [];
  for (const executable of candidates) {
    if (!existsSync(executable)) continue;
    const version = await new Promise<string | null>((resolve) => {
      const child = spawn(executable, ['--version'], {
        env: safeEnv,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '';
      const timer = setTimeout(() => {
        child.kill();
        resolve(null);
      }, 3000);
      child.stdout.on('data', (chunk) => {
        if (output.length < 1000) output += chunk.toString();
      });
      child.stderr.on('data', () => {});
      child.on('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve(code === 0 ? (/^codex-cli (\S+)/.exec(output.trim())?.[1] ?? null) : null);
      });
    });
    if (version && compatibleVersion(version)) runtimes.push({ executable, version });
  }
  runtimes.sort((a, b) => compareVersions(b.version, a.version));
  if (!runtimes.length)
    throw new ExecutionBlocked(
      'cli_missing',
      'No se encuentra un Codex CLI compatible (0.163 o posterior). No se ha instalado ni actualizado nada.',
    );
  return runtimes[0];
}

function compareVersions(a: string, b: string): number {
  const x = a.split(/[.-]/).map(Number);
  const y = b.split(/[.-]/).map(Number);
  for (let index = 0; index < 3; index++)
    if (x[index] !== y[index]) return (x[index] ?? 0) - (y[index] ?? 0);
  return a.includes('-') === b.includes('-')
    ? a.localeCompare(b, undefined, { numeric: true })
    : a.includes('-')
      ? -1
      : 1;
}

export function compatibleVersion(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[\w.-]+)?$/.exec(version);
  return !!match && (Number(match[1]) > 0 || Number(match[2]) >= 163);
}

/** A deliberately narrow RPC client: metadata only, no login/logout/token endpoints. */
export class CodexMetadataClient implements MetadataClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private closed = false;
  private readonly invalidated = new Set<() => void>();
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(runtime: CliRuntime, env = process.env) {
    this.child = spawn(runtime.executable, ['app-server', '--listen', 'stdio://'], {
      env: safeCliEnvironment(env),
      windowsHide: true,
      stdio: 'pipe',
    });
    const reader = createInterface({ input: this.child.stdout });
    reader.on('line', (line) => {
      if (line.length > 2_000_000) {
        this.fail();
        return;
      }
      let message: Record<string, unknown>;
      try {
        message = object(JSON.parse(line));
      } catch {
        return;
      }
      if (message.method === 'account/updated') for (const notify of this.invalidated) notify();
      if (typeof message.id !== 'number') return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      // Never forward remote error text, account email, or raw messages to logs.
      if (message.error)
        pending.reject(
          new ExecutionBlocked(
            'metadata_rejected',
            'Codex ha rechazado una comprobación de metadatos.',
          ),
        );
      else pending.resolve(message.result);
    });
    this.child.stderr.on('data', () => {});
    this.child.on('error', () => this.fail());
    this.child.on('close', () => this.fail());
    this.child.stdin.on('error', () => this.fail());
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      clientInfo: { name: 'pixel-office-local', title: 'Pixel Office personal', version: '0.1.0' },
    });
    this.child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  }

  request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!['initialize', 'account/read', 'account/rateLimits/read', 'model/list'].includes(method))
      return Promise.reject(
        new ExecutionBlocked(
          'rpc_forbidden',
          'Operación no permitida en el diagnóstico de suscripción.',
        ),
      );
    if (method === 'account/read' && params?.refreshToken !== false)
      return Promise.reject(
        new ExecutionBlocked(
          'rpc_forbidden',
          'No se permite solicitar ni renovar credenciales desde la aplicación.',
        ),
      );
    if (this.closed)
      return Promise.reject(
        new ExecutionBlocked('metadata_unavailable', 'El proceso de comprobación está cerrado.'),
      );
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new ExecutionBlocked(
            'metadata_timeout',
            'No se ha podido verificar la suscripción a tiempo.',
          ),
        );
      }, 15_000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, ...(params ? { params } : {}) }) + '\n');
    });
  }

  private fail(): void {
    if (!this.closed) for (const notify of this.invalidated) notify();
    this.closed = true;
    for (const value of this.pending.values()) {
      clearTimeout(value.timer);
      value.reject(
        new ExecutionBlocked(
          'metadata_unavailable',
          'Se ha perdido la comprobación con Codex CLI.',
        ),
      );
    }
    this.pending.clear();
  }

  onInvalidated(listener: () => void): () => void {
    this.invalidated.add(listener);
    return () => {
      this.invalidated.delete(listener);
    };
  }

  async close(): Promise<void> {
    this.fail();
    await stopProcess(this.child);
  }
}
