import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { stopProcess } from '../src/execution/cliProcess.js';
import { PreviewServer } from '../src/tools/previewServer.js';
import type { SandboxedCommandOptions } from '../src/tools/sandboxCommand.js';

describe('server-owned preview lifecycle', () => {
  const cleanup: Array<() => Promise<unknown>> = [];
  afterEach(async () => {
    for (const dispose of cleanup.splice(0).reverse()) await dispose();
  });
  async function fixture() {
    const project = await mkdtemp(join(tmpdir(), 'office-preview-'));
    cleanup.push(() => rm(project, { recursive: true, force: true }));
    await writeFile(
      join(project, 'package.json'),
      JSON.stringify({ name: 'local-fixture', devDependencies: { vite: 'fixture' } }),
    );
    const bin = join(project, 'node_modules', 'vite', 'bin');
    await mkdir(bin, { recursive: true });
    await writeFile(
      join(bin, 'vite.js'),
      `const http=require('node:http'); const port=Number(process.argv[process.argv.indexOf('--port')+1]); const base=process.argv[process.argv.indexOf('--base')+1]; const trusted=process.env.PIXEL_OFFICE_PREVIEW==='1' && !!process.env.PIXEL_OFFICE_PREVIEW_NONCE && !!process.env.PIXEL_OFFICE_STATE_DIR; if(trusted)require('node:fs').writeFileSync(require('node:path').join(process.env.PIXEL_OFFICE_STATE_DIR,'probe.txt'),'trusted state writable'); http.createServer((req,res)=>res.end('<script src="'+base+'@vite/client"></script><h1>Vista separada</h1><p>'+trusted+'</p>')).listen(port,'127.0.0.1');`,
    );
    return project;
  }
  it('allocates and verifies its own origin, then stops only its child', async () => {
    const project = await fixture();
    const sandbox = vi.fn(async (input: SandboxedCommandOptions) => {
      // Controlled fixture only: production never falls back to an unsandboxed process.
      const child = spawn(input.executable, input.args, {
        cwd: input.project,
        env: { ...input.env, ...input.trustedExtraEnv },
        stdio: 'pipe',
        windowsHide: true,
      });
      return {
        child,
        networkPolicy: 'external-denied-loopback-unrestricted' as const,
        close: () => stopProcess(child),
      };
    });
    const preview = new PreviewServer(
      { project, stateDir: join(project, 'private-state') },
      sandbox,
    );
    cleanup.push(() => preview.close());
    const address = await preview.start();
    expect(sandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        allowLoopback: true,
        writableRoots: [join(project, 'private-state')],
      }),
    );
    expect(address.kind).toBe('vite');
    expect(address.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(address.origin).not.toBe('http://127.0.0.1:4173');
    expect(await (await fetch(address.url)).text()).toContain('Vista separada');
    expect(await preview.start()).toEqual(address);
    await preview.close();
    await expect(fetch(address.url)).rejects.toThrow();
  });
  it('never falls back when the official sandbox is unavailable', async () => {
    const project = await fixture();
    const sandbox = vi.fn(async () => {
      throw new Error('sandbox unavailable');
    });
    await expect(
      new PreviewServer({ project, stateDir: join(project, 'state') }, sandbox).start(),
    ).rejects.toThrow('sandbox unavailable');
    expect(sandbox).toHaveBeenCalledTimes(1);
  });
  it.runIf(process.platform === 'win32' && process.env.OFFICE_SANDBOX_INTEGRATION === '1')(
    'starts a real official sandbox preview with trusted state outside its project (no AI)',
    async () => {
      const project = await fixture();
      const stateDir = await mkdtemp(join(tmpdir(), 'office-preview-state-'));
      cleanup.push(() => rm(stateDir, { recursive: true, force: true }));
      const preview = new PreviewServer({ project, stateDir });
      cleanup.push(() => preview.close());
      const address = await preview.start();
      expect(await (await fetch(address.url)).text()).toContain('<p>true</p>');
      expect(await readFile(join(stateDir, 'probe.txt'), 'utf8')).toBe('trusted state writable');
    },
    45_000,
  );
  it('rejects unknown scripts rather than executing a package dev command', async () => {
    const project = await fixture();
    await writeFile(
      join(project, 'package.json'),
      JSON.stringify({ name: 'unknown', scripts: { dev: 'dangerous shell' } }),
    );
    await expect(
      new PreviewServer({ project, stateDir: join(project, 'state') }).start(),
    ).rejects.toThrow('scripts desconocidos');
  });
  it('aborted tasks cannot start a preview', async () => {
    const project = await fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      new PreviewServer({
        project,
        stateDir: join(project, 'state'),
        signal: controller.signal,
      }).start(),
    ).rejects.toThrow('detenido');
  });
});
