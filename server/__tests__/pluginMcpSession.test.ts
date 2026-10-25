import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type PluginMcpClient,
  type PluginMcpSelection,
  PluginMcpSession,
} from '../src/tools/pluginMcpSession.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'office-plugin-mcp-'));
  roots.push(root);
  const selection: PluginMcpSelection = {
    pluginId: 'public-plugin',
    nativeId: 'fixture@local',
    name: 'fixture',
    marketplace: 'local',
    fingerprint: 'v1',
    pluginIds: ['fixture@local', 'other@local'],
    servers: ['fixture-server'],
  };
  let toolsError: string | null = null,
    description = 'Local operation',
    changed = false;
  const call = vi.fn<PluginMcpClient['call']>(async () => ({
    content: [{ type: 'text', text: 'OPERATION_OK' }],
  }));
  const close = vi.fn(async () => {});
  const list = vi.fn(async () => ({
    data: [
      {
        name: 'fixture-server',
        pluginId: 'fixture@local',
        toolsError,
        tools: { operation: { description, inputSchema: { type: 'object' } } },
      },
      { name: 'unrelated', pluginId: 'other@local', tools: { bad: {} } },
    ],
  }));
  const open = vi.fn(async () => ({ list, call, close }));
  const refresh = vi.fn(async () => ({
    ...selection,
    fingerprint: changed ? 'v2' : selection.fingerprint,
  }));
  const manager = new PluginMcpSession(root, open, refresh),
    signal = new AbortController().signal;
  return {
    root,
    selection,
    call,
    close,
    list,
    open,
    refresh,
    manager,
    signal,
    change: () => {
      changed = true;
    },
    changeTool: () => {
      description = 'Changed';
    },
    catalogueError: () => {
      toolsError = 'failed';
    },
  };
}
describe('selected plugin MCP session (simulated RPC, no plugins executed)', () => {
  it('binds tools to their plugin, invokes one operation, persists receipts and expires IDs on close', async () => {
    const h = await fixture(),
      connection = await h.manager.connect(h.selection, h.signal);
    expect(connection.tools).toHaveLength(1);
    expect(h.manager.prepare(connection.connectionId, connection.tools[0].id).server).toBe(
      'fixture-server',
    );
    expect(
      await h.manager.call(
        connection.connectionId,
        connection.tools[0].id,
        { message: 'approved' },
        h.signal,
      ),
    ).toMatchObject({ status: 'completed', isError: false });
    expect(h.call).toHaveBeenCalledExactlyOnceWith('fixture-server', 'operation', {
      message: 'approved',
    });
    const restored = new PluginMcpSession(h.root, h.open, h.refresh);
    expect(await restored.operations()).toMatchObject([
      { status: 'completed', plugin: 'fixture', tool: 'operation' },
    ]);
    expect(() => restored.prepare(connection.connectionId, connection.tools[0].id)).toThrow(
      'ya no está disponible',
    );
    await h.manager.close();
    expect(h.close).toHaveBeenCalledTimes(1);
    expect(() => h.manager.prepare(connection.connectionId, connection.tools[0].id)).toThrow(
      'ya no está disponible',
    );
  });
  it.each(['plugin', 'tool'] as const)(
    'invalidates the approved operation if its %s changes',
    async (mode) => {
      const h = await fixture(),
        connection = await h.manager.connect(h.selection, h.signal);
      if (mode === 'plugin') h.change();
      else h.changeTool();
      await expect(
        h.manager.call(connection.connectionId, connection.tools[0].id, {}, h.signal),
      ).rejects.toThrow('cambió');
      expect(h.call).not.toHaveBeenCalled();
      await h.manager.close();
    },
  );
  it('keeps an uncertain result across restart and blocks reordered duplicate arguments', async () => {
    const h = await fixture(),
      connection = await h.manager.connect(h.selection, h.signal);
    h.call.mockRejectedValueOnce(new Error('SECRET provider diagnostic'));
    await expect(
      h.manager.call(connection.connectionId, connection.tools[0].id, { a: 1, b: 2 }, h.signal),
    ).rejects.toThrow('incierto');
    await h.manager.close();
    const restored = new PluginMcpSession(h.root, h.open, h.refresh),
      next = await restored.connect(h.selection, h.signal);
    await expect(
      restored.call(next.connectionId, next.tools[0].id, { b: 2, a: 1 }, h.signal),
    ).rejects.toThrow('incierto');
    expect(h.call).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await restored.operations())).not.toContain('SECRET');
    await restored.close();
  });
  it('captures arguments before asynchronous checks and refuses a concurrent operation', async () => {
    const h = await fixture(),
      connection = await h.manager.connect(h.selection, h.signal);
    let release: () => void = () => {};
    h.refresh.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(h.selection);
        }),
    );
    const args = { message: 'approved' },
      pending = h.manager.call(connection.connectionId, connection.tools[0].id, args, h.signal);
    args.message = 'changed';
    await expect(
      h.manager.call(connection.connectionId, connection.tools[0].id, {}, h.signal),
    ).rejects.toThrow('activa');
    await vi.waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(2));
    release();
    await pending;
    expect(h.call).toHaveBeenCalledWith('fixture-server', 'operation', { message: 'approved' });
    await h.manager.close();
  });
  it('rejects cancelled connections and closes a failed catalogue without claiming readiness', async () => {
    const h = await fixture();
    await expect(h.manager.connect(h.selection, AbortSignal.abort())).rejects.toThrow('cancelado');
    expect(h.open).not.toHaveBeenCalled();
    h.catalogueError();
    await expect(h.manager.connect(h.selection, h.signal)).rejects.toThrow('revisión');
    expect(h.close).toHaveBeenCalledTimes(1);
  });
});
