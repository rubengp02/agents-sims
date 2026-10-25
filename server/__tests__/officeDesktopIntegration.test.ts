import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it, vi } from 'vitest';

import { stopProcess } from '../src/execution/cliProcess.js';
import { OfficeToolRuntime } from '../src/tools/toolRuntime.js';

const run = promisify(execFile);
const helper = resolve(
  process.cwd().endsWith('server')
    ? '../dist/native/office-desktop.exe'
    : 'dist/native/office-desktop.exe',
);
describe.skipIf(
  process.env.OFFICE_DESKTOP_INTEGRATION !== '1' ||
    process.platform !== 'win32' ||
    !existsSync(helper),
)('owned Windows application, real input without model inference', () => {
  it('inspects, excludes competitors and enforces focus, approval and cancellation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'office-owned-window-'));
    const executable = join(root, 'fixture.exe'),
      saved = join(root, 'saved.txt'),
      ready = join(root, 'ready.txt');
    const source = resolve(
      process.cwd().endsWith('server')
        ? '__tests__/fixtures/office-desktop-test.cs'
        : 'server/__tests__/fixtures/office-desktop-test.cs',
    );
    const compiler = join(
      process.env.WINDIR ?? 'C:\\Windows',
      'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
    );
    await run(
      compiler,
      [
        '/nologo',
        '/target:winexe',
        '/out:' + executable,
        '/reference:System.Windows.Forms.dll',
        source,
      ],
      { windowsHide: true },
    );
    const child = spawn(executable, [saved, ready], { windowsHide: false, stdio: 'ignore' });
    const runtime = new OfficeToolRuntime({ stateDir: root, desktopHelper: helper });
    const controller = new AbortController();
    const session = runtime.createSession({
      taskId: 'owned-fixture',
      role: 'developer',
      project: root,
      signal: controller.signal,
    });
    const other = runtime.createSession({
      taskId: 'competing-fixture',
      role: 'developer',
      project: root,
    });
    try {
      await vi.waitFor(() => expect(existsSync(ready)).toBe(true), { timeout: 10000 });
      const target = { handle: readFileSync(ready, 'utf8'), processId: child.pid! };
      const inspected = await session.execute('desktop_inspect', target);
      const controls = JSON.parse(inspected.content.find((c) => c.type === 'text')!.text!)
        .controls as Array<{
        automationId: string;
        x: number;
        y: number;
        width: number;
        height: number;
      }>;
      const input = controls.find((c) => c.automationId === 'fixture-input')!,
        button = controls.find((c) => c.automationId === 'fixture-save')!;
      expect(input).toBeDefined();
      expect(button).toBeDefined();
      await expect(other.execute('desktop_windows', {})).rejects.toThrow('Otro empleado');
      const windows = await session.execute('desktop_windows', {});
      const foreground = JSON.parse(
        windows.content.find((c) => c.type === 'text')!.text!,
      ).windows.find(
        (window: { handle: string; foreground: boolean }) => window.handle === target.handle,
      )?.foreground;
      const approveFixtureOnly = async (name: string, args: Record<string, unknown>) => {
        const pending = session.execute(name, args);
        await vi.waitFor(() => expect(runtime.approvals.list()).toHaveLength(1));
        expect(existsSync(saved)).toBe(false);
        runtime.approvals.resolve(runtime.approvals.list()[0].id, true);
        return pending;
      };
      const firstClick = approveFixtureOnly('desktop_click', {
        ...target,
        x: Math.round(input.x + input.width / 2),
        y: Math.round(input.y + input.height / 2),
      });
      if (!foreground) {
        await expect(firstClick).rejects.toThrow('perdió el foco');
        expect(existsSync(saved)).toBe(false);
        controller.abort();
        await expect(
          session.execute('desktop_keys', { ...target, keys: 'unexpected' }),
        ).rejects.toThrow('detenido');
        console.warn(
          'Comprobadas inspección, exclusión, aprobación, pérdida de foco y parada. Escritura real pendiente: Windows no dio foco a la aplicación de prueba.',
        );
        return;
      }
      await firstClick;
      await approveFixtureOnly('desktop_keys', { ...target, keys: 'office-verified' });
      await approveFixtureOnly('desktop_click', {
        ...target,
        x: Math.round(button.x + button.width / 2),
        y: Math.round(button.y + button.height / 2),
      });
      await vi.waitFor(() => expect(readFileSync(saved, 'utf8')).toBe('office-verified'));
      controller.abort();
      await expect(
        session.execute('desktop_keys', { ...target, keys: 'unexpected' }),
      ).rejects.toThrow('detenido');
      expect(readFileSync(saved, 'utf8')).toBe('office-verified');
      console.info(
        'Windows real: escritura de la aplicación propia verificada y parada posterior comprobada; sin inferencia.',
      );
    } finally {
      await session.dispose();
      await other.dispose();
      await stopProcess(child);
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }).catch(
        () => {
          console.warn(
            'Windows mantiene bloqueado el ejecutable temporal de la prueba tras detenerlo.',
          );
        },
      );
    }
  }, 30000);
});
