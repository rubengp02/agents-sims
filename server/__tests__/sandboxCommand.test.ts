import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { startSandboxedCommand } from '../src/tools/sandboxCommand.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function harness() {
  const project = mkdtempSync(join(tmpdir(), 'office-command-'));
  roots.push(project);
  const child = Object.assign(new EventEmitter(), { exitCode: 0, signalCode: null });
  const launch = vi.fn<
    NonNullable<import('../src/tools/sandboxCommand.js').SandboxedCommandDependencies['launch']>
  >(() => child as unknown as ChildProcessWithoutNullStreams);
  const dependencies = {
    platform: 'win32' as const,
    launch,
    discover: vi.fn(async () => ({ executable: '/official/codex', version: '0.163.0' })),
  };
  const input = {
    project,
    executable: process.execPath,
    args: ['-e', 'console.log("fixture")'],
    env: {},
    allowLoopback: true as const,
  };
  return { project, child, launch, dependencies, input };
}
describe('official local command sandbox (no model inference)', () => {
  it('adds only explicitly trusted preview environment and backend state roots', async () => {
    const h = harness();
    await startSandboxedCommand(
      {
        ...h.input,
        writableRoots: [h.project],
        trustedExtraEnv: {
          PIXEL_OFFICE_PREVIEW: '1',
          PIXEL_OFFICE_STATE_DIR: h.project,
          PIXEL_OFFICE_PREVIEW_NONCE: 'nonce',
        },
      },
      h.dependencies,
    );
    const [, args, options] = h.launch.mock.calls[0];
    expect(args).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^permissions\.office-command-.*\.filesystem=\{/),
      ]),
    );
    expect(options.env).toMatchObject({
      PIXEL_OFFICE_PREVIEW: '1',
      PIXEL_OFFICE_STATE_DIR: h.project,
      PIXEL_OFFICE_PREVIEW_NONCE: 'nonce',
    });
  });
  it('uses structured official sandbox arguments with direct Internet disabled', async () => {
    const h = harness();
    const owned = await startSandboxedCommand(h.input, h.dependencies);
    expect(h.launch).toHaveBeenCalledWith(
      expect.objectContaining({ executable: '/official/codex' }),
      expect.arrayContaining(['sandbox', '-P', '--', process.execPath]),
      expect.objectContaining({ cwd: h.project, env: {} }),
    );
    expect(h.launch.mock.calls[0][1]).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^permissions\.office-command-.*\.network\.enabled=false$/),
      ]),
    );
    await owned.close();
  });
  it.each([undefined, false, { port: 4174 }])(
    'fails closed for unsupported loopback policy %s',
    async (allowLoopback) => {
      const h = harness();
      await expect(
        startSandboxedCommand({ ...h.input, allowLoopback }, h.dependencies),
      ).rejects.toMatchObject({ code: 'sandbox_loopback_scope_unsupported' });
      expect(h.launch).not.toHaveBeenCalled();
    },
  );
  it('blocks unverified platforms and aborts before starting a process', async () => {
    const h = harness();
    await expect(
      startSandboxedCommand(h.input, { ...h.dependencies, platform: 'linux' }),
    ).rejects.toMatchObject({ code: 'command_sandbox_unsupported' });
    const controller = new AbortController();
    controller.abort();
    await expect(
      startSandboxedCommand({ ...h.input, signal: controller.signal }, h.dependencies),
    ).rejects.toMatchObject({ code: 'cancelled_by_user' });
    expect(h.launch).not.toHaveBeenCalled();
  });
  it('does not forward API credentials or select another billing provider', async () => {
    const h = harness();
    await expect(
      startSandboxedCommand({ ...h.input, env: { OPENAI_API_KEY: 'not-read' } }, h.dependencies),
    ).rejects.toMatchObject({ code: 'payment_environment' });
    expect(h.launch).not.toHaveBeenCalled();
  });
});
