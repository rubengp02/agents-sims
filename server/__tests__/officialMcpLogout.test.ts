import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { officialMcpLogout } from '../src/execution/officialMcpLogout.js';

function fixture() {
  const mock = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
  });
  const child = mock as unknown as ChildProcessWithoutNullStreams;
  return {
    diagnostic: mock.stderr,
    child,
    launch: vi.fn(() => child),
    runtime: { executable: '/official/codex', version: 'fixture' },
  };
}
describe('official MCP logout process (simulated child, no real credentials)', () => {
  it('uses a fixed subcommand and a literal server argument and discards diagnostic output', async () => {
    const h = fixture(),
      name = '-flag; arbitrary text';
    const pending = officialMcpLogout(h.runtime, name, {}, new AbortController().signal, h.launch);
    expect(h.launch).toHaveBeenCalledWith('/official/codex', ['mcp', 'logout', '--', name]);
    h.diagnostic.write('SECRET diagnostics');
    h.child.emit('close', 0);
    await pending;
  });
  it('never starts a cancelled action and sanitizes a failing exit', async () => {
    const h = fixture();
    await expect(
      officialMcpLogout(h.runtime, 'fixture', {}, AbortSignal.abort(), h.launch),
    ).rejects.toThrow('cancelado');
    expect(h.launch).not.toHaveBeenCalled();
    const pending = officialMcpLogout(
      h.runtime,
      'fixture',
      {},
      new AbortController().signal,
      h.launch,
    );
    h.diagnostic.write('SECRET diagnostics');
    h.child.emit('close', 1);
    await expect(pending).rejects.toThrow('No se pudo confirmar el cierre de sesión oficial.');
  });
});
