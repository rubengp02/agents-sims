import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConnectionManager, type ConnectionOpener } from '../src/tools/connectionManager.js';
import { startOfficeMcp } from '../src/tools/officeMcp.js';
import { managedMcpTarget } from '../src/tools/officialMcpRegistration.js';
import { publicAddress, publicMcpFetch } from '../src/tools/publicMcpFetch.js';
import { OfficeToolRuntime } from '../src/tools/toolRuntime.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'office-connections-'));
  roots.push(root);
  const call = vi.fn(async () => ({ content: [{ type: 'text', text: 'Operación confirmada' }] }));
  const open = vi.fn<ConnectionOpener>(async () => ({
    listTools: async () => ({
      tools: [
        {
          name: 'fixture_operation',
          description: 'Servicio de prueba',
          inputSchema: { type: 'object' },
        },
      ],
    }),
    callTool: call,
    close: async () => {},
  }));
  const manager = new ConnectionManager(root, open);
  await manager.initialize();
  const runtime = new OfficeToolRuntime({ stateDir: root, connections: manager });
  const session = runtime.createSession({ taskId: 'task', role: 'chief', project: root });
  return { root, manager, runtime, session, call, open };
}
describe('managed connections, mock remote service, no quota', () => {
  it('binds each receipt to the real approval and owner without persisting private arguments or responses', async () => {
    const h = await fixture(),
      signal = new AbortController().signal;
    const entry = await h.manager.connect('Fixture', 'https://example.com/mcp', signal);
    const pending = h.session.execute('connection_call', {
      connectionId: entry.id,
      tool: 'fixture_operation',
      arguments: { value: 'PRIVATE_ARGUMENT' },
    });
    await vi.waitFor(() => expect(h.runtime.approvals.list()).toHaveLength(1));
    const approval = h.runtime.approvals.list()[0];
    expect((await h.manager.operations()).operations).toHaveLength(0);
    h.runtime.approvals.resolve(approval.id, true);
    const block = (await pending).content[0];
    if (block.type !== 'text') throw Error('expected operation receipt');
    const response = JSON.parse(block.text);
    const log = await h.manager.operations(entry.id);
    expect(log.recordingStartedAt).toEqual(expect.any(Number));
    expect(log.operations).toMatchObject([
      {
        id: response.operationId,
        status: 'completed',
        taskId: 'task',
        connectionId: entry.id,
        approval: {
          id: approval.id,
          fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
          approvedAt: expect.any(Number),
        },
        resultHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    ]);
    expect(JSON.stringify(log)).not.toContain('PRIVATE_ARGUMENT');
    expect(JSON.stringify(log)).not.toContain('Operación confirmada');
    expect(h.runtime.approvals.resolve(approval.id, true)).toBe(false);
    const restored = new ConnectionManager(h.root, h.open);
    await restored.initialize();
    expect((await restored.operations(entry.id)).operations).toEqual(log.operations);
    expect(h.call).toHaveBeenCalledTimes(1);
    await h.session.dispose();
  });
  it('persists an uncertain receipt before dispatch so recovery cannot duplicate an in-flight operation', async () => {
    const h = await fixture(),
      signal = new AbortController().signal;
    let release = () => {};
    const done = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entry = await h.manager.connect('Fixture', 'https://example.com/mcp', signal);
    h.call.mockImplementationOnce(async () => {
      await done;
      return { content: [{ type: 'text', text: 'confirmed' }] };
    });
    const operation = h.manager.call(entry.id, 'fixture_operation', {}, signal);
    try {
      await vi.waitFor(() => expect(h.call).toHaveBeenCalledTimes(1));
      expect((await h.manager.operations(entry.id)).operations[0].status).toBe('dispatching');
      const restored = new ConnectionManager(h.root, h.open);
      await restored.initialize();
      expect((await restored.operations(entry.id)).operations[0].status).toBe('review_required');
      expect(restored.list()[0].uncertain?.tool).toBe('fixture_operation');
      await expect(restored.call(entry.id, 'fixture_operation', {}, signal)).rejects.toThrow(
        'resultado incierto',
      );
      expect(h.call).toHaveBeenCalledTimes(1);
    } finally {
      release();
      await operation;
      await h.session.dispose();
    }
    const restored = new ConnectionManager(h.root, h.open);
    await restored.initialize();
    expect(restored.list()[0].uncertain).toBeUndefined();
  });
  it('remembers an official connection without opening it and preserves its engine on restart', async () => {
    const h = await fixture();
    const entry = await h.manager.remember('Oficial', 'https://example.com/mcp');
    expect(h.open).not.toHaveBeenCalled();
    expect(entry.enabled).toBe(false);
    await h.manager.adoptOfficial(entry.id, managedMcpTarget(entry.url).name);
    const restored = new ConnectionManager(h.root, h.open);
    await restored.initialize();
    expect(restored.list()[0]).toMatchObject({ engine: 'codex', state: 'unverified', tools: [] });
    await expect(
      restored.call(entry.id, 'fixture_operation', {}, new AbortController().signal),
    ).rejects.toThrow();
    expect(h.open).not.toHaveBeenCalled();
    await restored.disable(entry.id);
    await expect(
      restored.connect('Oficial', entry.url, new AbortController().signal),
    ).rejects.toThrow('se administra con Codex');
    expect(restored.list()[0].enabled).toBe(false);
    await h.session.dispose();
  });
  it('uses only the explicitly supplied official adapter and requires a successful operation for readiness', async () => {
    const h = await fixture();
    const entry = await h.manager.remember('Oficial', 'https://example.com/mcp');
    const target = managedMcpTarget(entry.url);
    await h.manager.adoptOfficial(entry.id, target.name);
    const native = vi.fn(async () => ({
      listTools: async () => ({
        tools: [{ name: 'fixture_operation', inputSchema: { type: 'object' } }],
      }),
      callTool: h.call,
      close: async () => {},
    }));
    const signal = new AbortController().signal;
    await h.manager.checkOfficial(entry.id, signal, native);
    expect(h.manager.list()[0].state).toBe('unverified');
    await h.manager.call(entry.id, 'fixture_operation', {}, signal, native);
    expect(native).toHaveBeenCalledWith(target, expect.anything());
    expect(h.manager.list()[0].state).toBe('available');
    expect(h.call).toHaveBeenCalledTimes(1);
    expect(h.open).not.toHaveBeenCalled();
    await h.session.dispose();
  });
  it('disables access durably and requires a new approved connection to re-enable it', async () => {
    const h = await fixture(),
      signal = new AbortController().signal;
    const entry = await h.manager.connect('Fixture', 'https://example.com/mcp', signal);
    await h.manager.disable(entry.id);
    expect(h.manager.list()[0]).toMatchObject({ enabled: false, state: 'blocked', tools: [] });
    await expect(h.manager.call(entry.id, 'fixture_operation', {}, signal)).rejects.toThrow(
      'desactivada',
    );
    expect(h.call).not.toHaveBeenCalled();
    const restored = new ConnectionManager(h.root, h.open);
    await restored.initialize();
    expect(restored.list()[0]).toMatchObject({ enabled: false, state: 'blocked' });
    await expect(restored.call(entry.id, 'fixture_operation', {}, signal)).rejects.toThrow(
      'desactivada',
    );
    await h.session.dispose();
  });
  it('requires a specific approval for disabling through an employee tool', async () => {
    const h = await fixture(),
      entry = await h.manager.connect(
        'Fixture',
        'https://example.com/mcp',
        new AbortController().signal,
      );
    const pending = h.session.execute('connection_disable', { connectionId: entry.id });
    await vi.waitFor(() => expect(h.runtime.approvals.list()).toHaveLength(1));
    expect(h.manager.list()[0].enabled).toBe(true);
    expect(h.runtime.approvals.list()[0].content).toContain('No revoca');
    h.runtime.approvals.resolve(h.runtime.approvals.list()[0].id, true);
    await pending;
    expect(h.manager.list()[0].enabled).toBe(false);
    await h.session.dispose();
  });
  it('stops an in-flight call when the connection is disabled and never restores its access', async () => {
    const h = await fixture(),
      signal = new AbortController().signal;
    const entry = await h.manager.connect('Fixture', 'https://example.com/mcp', signal);
    let began = false,
      operationSignal: AbortSignal | undefined;
    h.open.mockImplementation(async (_url, s) => ({
      listTools: async () => ({
        tools: [{ name: 'fixture_operation', inputSchema: { type: 'object' } }],
      }),
      close: async () => {},
      callTool: async () => {
        began = true;
        operationSignal = s;
        return new Promise((_resolve, reject) =>
          s.addEventListener('abort', () => reject(new Error('stopped')), { once: true }),
        );
      },
    }));
    const pending = h.manager.call(entry.id, 'fixture_operation', {}, signal),
      rejected = expect(pending).rejects.toThrow('no se pudo confirmar');
    await vi.waitFor(() => expect(began).toBe(true));
    await h.manager.disable(entry.id);
    await rejected;
    expect(operationSignal?.aborted).toBe(true);
    expect(h.manager.list()[0]).toMatchObject({ enabled: false, state: 'blocked' });
    await h.session.dispose();
  });
  it('connects and calls a real MCP HTTP fixture through the official SDK', async () => {
    const h = await fixture();
    await writeFile(join(h.root, 'fixture.txt'), 'REAL_MCP_OK');
    const servers: Array<() => Promise<void>> = [];
    try {
      const manager = new ConnectionManager(join(h.root, 'http-fixture'), async () => {
        const target = new OfficeToolRuntime({ stateDir: h.root }).createSession({
          taskId: 'remote-fixture',
          role: 'tester',
          project: h.root,
        });
        const server = await startOfficeMcp(target);
        servers.push(server.close);
        const client = new Client({ name: 'integration-fixture', version: '1' });
        await client.connect(
          new StreamableHTTPClientTransport(new URL(server.url), {
            requestInit: { headers: { authorization: `Bearer ${server.secret}` } },
          }),
        );
        return client;
      });
      await manager.initialize();
      const connection = await manager.connect(
        'HTTP fixture',
        'https://example.com/mcp',
        new AbortController().signal,
      );
      expect(connection.tools.some((t) => t.name === 'project_read')).toBe(true);
      const result = await manager.call(
        connection.id,
        'project_read',
        { args: { path: 'fixture.txt' } },
        new AbortController().signal,
      );
      expect(JSON.stringify(result)).toContain('REAL_MCP_OK');
      expect(manager.list()[0].state).toBe('available');
    } finally {
      for (const close of servers) await close();
      await h.session.dispose();
    }
  });
  it('requires approval before connecting and another approval before each operation', async () => {
    const h = await fixture();
    const connect = h.session.execute('connection_connect', {
      name: 'Prueba',
      url: 'https://example.com/mcp',
    });
    await vi.waitFor(() => expect(h.runtime.approvals.list()).toHaveLength(1));
    expect(h.open).not.toHaveBeenCalled();
    const approval = h.runtime.approvals.list()[0];
    expect(approval.destination).toContain('example.com');
    h.runtime.approvals.resolve(approval.id, true);
    await connect;
    expect(h.manager.list()[0].state).toBe('unverified');
    const id = h.manager.list()[0].id;
    const args = {
      connectionId: id,
      tool: 'fixture_operation',
      arguments: { message: 'approved' },
    };
    const pending = h.session.execute('connection_call', args);
    await vi.waitFor(() => expect(h.runtime.approvals.list()).toHaveLength(1));
    expect(h.call).not.toHaveBeenCalled();
    args.arguments.message = 'changed after approval request';
    const operation = h.runtime.approvals.list()[0];
    h.runtime.approvals.resolve(operation.id, true);
    await pending;
    expect(h.call).toHaveBeenCalledWith(
      { name: 'fixture_operation', arguments: { message: 'approved' } },
      undefined,
      expect.anything(),
    );
    expect(h.manager.list()[0].state).toBe('available');
    expect(h.runtime.approvals.resolve(operation.id, true)).toBe(false);
    const denied = h.session.execute('connection_call', args);
    await vi.waitFor(() => expect(h.runtime.approvals.list()).toHaveLength(1));
    h.runtime.approvals.resolve(h.runtime.approvals.list()[0].id, false);
    await expect(denied).rejects.toThrow('no fue autorizada');
    expect(h.call).toHaveBeenCalledTimes(1);
    await h.session.dispose();
  });
  it('retains connections on restart without replaying operations or claiming readiness', async () => {
    const h = await fixture();
    const connected = await h.manager.connect(
      'Prueba',
      'https://example.com/mcp',
      new AbortController().signal,
    );
    await h.manager.call(connected.id, 'fixture_operation', {}, new AbortController().signal);
    const restored = new ConnectionManager(h.root, h.open);
    await restored.initialize();
    expect(restored.list()[0]).toMatchObject({ id: connected.id, state: 'unverified', tools: [] });
    expect(h.call).toHaveBeenCalledTimes(1);
    await h.session.dispose();
  });
  it('explains unsupported authentication without saving credentials', async () => {
    const h = await fixture();
    h.open.mockRejectedValueOnce(new Error('HTTP 401 Unauthorized SECRET'));
    const result = await h.manager.connect(
      'Privada',
      'https://example.com/mcp',
      new AbortController().signal,
    );
    expect(result.state).toBe('needs_connection');
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(result.reason).toContain('autenticación');
    await h.session.dispose();
  });
  it('does not retry a lost operation and records its uncertain outcome', async () => {
    const h = await fixture();
    const connection = await h.manager.connect(
      'Prueba',
      'https://example.com/mcp',
      new AbortController().signal,
    );
    h.call.mockRejectedValueOnce(new Error('lost after sending'));
    await expect(
      h.manager.call(connection.id, 'fixture_operation', {}, new AbortController().signal),
    ).rejects.toThrow('no se pudo confirmar');
    expect(h.call).toHaveBeenCalledTimes(1);
    expect(h.manager.list()[0].state).toBe('blocked');
    const receipt = (await h.manager.operations(connection.id)).operations[0];
    const receiptFile = join(h.root, 'operations', receipt.id + '.json');
    const originalReceipt = await readFile(receiptFile, 'utf8');
    // Simulate interruption between the durable operation record and connection-state write.
    const saved = h.manager.list();
    delete saved[0].uncertain;
    await writeFile(join(h.root, 'connections.json'), JSON.stringify(saved));
    const restored = new ConnectionManager(h.root, h.open);
    await restored.initialize();
    expect(restored.list()[0].uncertain?.tool).toBe('fixture_operation');
    await restored.connect('Prueba', 'https://example.com/mcp', new AbortController().signal);
    await expect(
      restored.call(connection.id, 'fixture_operation', {}, new AbortController().signal),
    ).rejects.toThrow('resultado incierto');
    expect(h.call).toHaveBeenCalledTimes(1);
    await restored.acknowledge(connection.id);
    expect(await readFile(receiptFile, 'utf8')).toBe(originalReceipt);
    expect((await restored.operations(connection.id)).operations[0]).toMatchObject({
      status: 'review_required',
      review: { outcome: 'not_determined' },
    });
    expect(h.call).toHaveBeenCalledTimes(1);
    await restored.call(connection.id, 'fixture_operation', {}, new AbortController().signal);
    expect(h.call).toHaveBeenCalledTimes(2);
    await h.session.dispose();
  });
  it('keeps a malformed provider response uncertain instead of claiming success', async () => {
    const h = await fixture(),
      signal = new AbortController().signal;
    const connection = await h.manager.connect('Fixture', 'https://example.com/mcp', signal);
    h.call.mockResolvedValueOnce(undefined as never);
    await expect(h.manager.call(connection.id, 'fixture_operation', {}, signal)).rejects.toThrow(
      'no se pudo confirmar',
    );
    expect(h.manager.list()[0].state).toBe('blocked');
    expect((await h.manager.operations(connection.id)).operations).toMatchObject([
      { status: 'review_required' },
    ]);
    expect(h.call).toHaveBeenCalledTimes(1);
    await h.session.dispose();
  });
  it('exposes a provider error as failed to the employee and receipt without marking it completed', async () => {
    const h = await fixture(),
      signal = new AbortController().signal;
    const connection = await h.manager.connect('Fixture', 'https://example.com/mcp', signal);
    h.call.mockImplementationOnce(async () => ({
      content: [{ type: 'text', text: 'PRIVATE_PROVIDER_ERROR' }],
      isError: true,
    }));
    const pending = h.session.execute('connection_call', {
      connectionId: connection.id,
      tool: 'fixture_operation',
      arguments: {},
    });
    await vi.waitFor(() => expect(h.runtime.approvals.list()).toHaveLength(1));
    h.runtime.approvals.resolve(h.runtime.approvals.list()[0].id, true);
    expect((await pending).isError).toBe(true);
    const log = await h.manager.operations(connection.id);
    expect(log.operations[0].status).toBe('failed');
    expect(JSON.stringify(log)).not.toContain('PRIVATE_PROVIDER_ERROR');
    expect(h.manager.list()[0].state).toBe('blocked');
    expect(h.call).toHaveBeenCalledTimes(1);
    await h.session.dispose();
  });
  it('cancels pending connection approval when the session ends', async () => {
    const h = await fixture();
    const pending = h.session.execute('connection_connect', {
      name: 'Prueba',
      url: 'https://example.com/mcp',
    });
    await vi.waitFor(() => expect(h.runtime.approvals.list()).toHaveLength(1));
    await h.session.dispose();
    await expect(pending).rejects.toThrow('detenido');
    expect(h.open).not.toHaveBeenCalled();
  });
  it('aborts an operation in flight without resending it', async () => {
    const h = await fixture();
    const connection = await h.manager.connect(
      'Prueba',
      'https://example.com/mcp',
      new AbortController().signal,
    );
    let activeSignal: AbortSignal | undefined;
    let calls = 0;
    h.open.mockImplementation(async (_url, signal) => ({
      listTools: async () => ({
        tools: [{ name: 'fixture_operation', inputSchema: { type: 'object' } }],
      }),
      close: async () => {},
      callTool: async () => {
        calls++;
        activeSignal = signal;
        return new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('connection lost')), {
            once: true,
          }),
        );
      },
    }));
    const pending = h.session.execute('connection_call', {
      connectionId: connection.id,
      tool: 'fixture_operation',
      arguments: {},
    });
    const rejected = expect(pending).rejects.toThrow('no se pudo confirmar');
    await vi.waitFor(() => expect(h.runtime.approvals.list()).toHaveLength(1));
    h.runtime.approvals.resolve(h.runtime.approvals.list()[0].id, true);
    await vi.waitFor(() => expect(calls).toBe(1));
    await h.session.dispose();
    await rejected;
    expect(activeSignal?.aborted).toBe(true);
    expect(calls).toBe(1);
  });
  it('rejects credentials, HTTP endpoints and private network targets', async () => {
    const h = await fixture();
    for (const url of [
      'http://example.com',
      'https://user:secret@example.com',
      'https://example.com?token=secret',
      'https://example.com:444',
    ])
      expect(() => h.manager.endpoint(url)).toThrow();
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '172.20.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '::1',
      '::ffff:127.0.0.1',
      'fe80::1',
    ])
      expect(publicAddress(address)).toBe(false);
    expect(publicAddress('1.1.1.1')).toBe(true);
    await expect(publicMcpFetch('https://127.0.0.1/mcp')).rejects.toThrow('público');
    await expect(publicMcpFetch('https://localhost/mcp')).rejects.toThrow('privadas');
    await h.session.dispose();
  });
});
