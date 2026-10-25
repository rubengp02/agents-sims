import type { ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';

import { safeCliEnvironment } from '../execution/subscriptionPolicy.js';
import {
  type SandboxedCommand,
  type SandboxedCommandOptions,
  startSandboxedCommand,
} from './sandboxCommand.js';

export interface PreviewAddress {
  url: string;
  origin: string;
  kind: 'office' | 'vite';
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/** Owns exactly one child. Never uses project-defined shell commands or the live office port. */
export class PreviewServer {
  private child?: ChildProcess;
  private command?: SandboxedCommand;
  private address?: PreviewAddress;
  private closed = false;
  private abort = () => {
    void this.close();
  };
  constructor(
    private readonly options: { project: string; stateDir: string; signal?: AbortSignal },
    private readonly launchSandbox: (
      input: SandboxedCommandOptions,
    ) => Promise<SandboxedCommand> = startSandboxedCommand,
  ) {
    options.signal?.addEventListener('abort', this.abort, { once: true });
  }
  async start(): Promise<PreviewAddress> {
    if (this.closed || this.options.signal?.aborted) throw new Error('El encargo se ha detenido.');
    if (this.address) return this.address;
    const manifest = JSON.parse(
      await readFile(join(this.options.project, 'package.json'), 'utf8'),
    ) as {
      name?: string;
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    const port = await freePort();
    if (this.closed) throw new Error('El encargo se ha detenido.');
    const nonce = randomBytes(20).toString('hex');
    const origin = `http://127.0.0.1:${port}`;
    const office = manifest.name === 'pixel-agents';
    const entry = office
      ? join(this.options.project, 'dist', 'cli.js')
      : join(this.options.project, 'node_modules', 'vite', 'bin', 'vite.js');
    if (!office && !manifest.dependencies?.vite && !manifest.devDependencies?.vite)
      throw new Error(
        'Vista previa no compatible: se admite la oficina y proyectos Vite instalados. No se ejecutarán scripts desconocidos.',
      );
    if (!existsSync(entry))
      throw new Error(
        office
          ? 'Compila primero la copia con npm run package para preparar su vista previa.'
          : 'Prepara primero las dependencias del proyecto Vite.',
      );
    await mkdir(this.options.stateDir, { recursive: true });
    const base = `/__office_preview_${nonce}/`;
    const args = office
      ? [
          entry,
          '--host',
          '127.0.0.1',
          '--port',
          String(port),
          '--providers',
          'codex',
          '--no-watch-all-sessions',
        ]
      : [entry, '--host', '127.0.0.1', '--port', String(port), '--strictPort', '--base', base];
    this.command = await this.launchSandbox({
      project: this.options.project,
      executable: process.execPath,
      args,
      env: safeCliEnvironment(process.env),
      signal: this.options.signal,
      allowLoopback: true,
      trustedExtraEnv: {
        PIXEL_OFFICE_PREVIEW: '1',
        PIXEL_OFFICE_STATE_DIR: this.options.stateDir,
        PIXEL_OFFICE_PREVIEW_NONCE: nonce,
      },
      writableRoots: [this.options.stateDir],
    });
    const child = this.command.child;
    child.stdout.resume();
    child.stderr.resume();
    this.child = child;
    if (this.closed) {
      await this.command.close();
      throw new Error('El encargo se ha detenido.');
    }
    let failed = false;
    child.once('error', () => {
      failed = true;
    });
    child.once('exit', () => {
      failed = true;
    });
    const deadline = Date.now() + 30_000;
    try {
      while (Date.now() < deadline) {
        if (this.closed || this.options.signal?.aborted)
          throw new Error('El encargo se ha detenido.');
        if (failed || child.exitCode !== null)
          throw new Error('La vista previa no pudo arrancar. Revisa la compilación de la copia.');
        try {
          const response = await fetch(office ? `${origin}/api/office/preview` : origin + base, {
            signal: AbortSignal.timeout(800),
            redirect: 'error',
          });
          const text = await response.text();
          const verified = office
            ? JSON.parse(text).nonce === nonce
            : text.includes(base + '@vite/client');
          if (response.ok && verified && !failed) {
            this.address = {
              origin,
              url: office ? origin : origin + base,
              kind: office ? 'office' : 'vite',
            };
            return this.address;
          }
        } catch {
          /* startup is not ready yet */
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(
        'La vista previa no confirmó su identidad a tiempo. No se ha autorizado ningún puerto.',
      );
    } catch (error) {
      await this.close();
      throw error;
    }
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.options.signal?.removeEventListener('abort', this.abort);
    if (this.child) await this.command?.close();
  }
}
