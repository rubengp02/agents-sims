import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { ConnectionManager } from '../src/tools/connectionManager.js';
import { OfficialAuthentication } from '../src/tools/officialAuthentication.js';
import { managedMcpTarget, OfficialMcpRegistration } from '../src/tools/officialMcpRegistration.js';
import { OfficeToolRuntime } from '../src/tools/toolRuntime.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(oauth = false) {
  const root = await mkdtemp(join(tmpdir(), 'office-managed-'));
  roots.push(root);
  const url = 'https://example.com/mcp',
    target = managedMcpTarget(url);
  let registered = false;
  const register = vi.fn(async () => {
    registered = true;
  });
  const registration = new OfficialMcpRegistration(join(root, 'mcp-registrations'), async () => ({
    inspect: async () => ({
      exists: registered,
      matches: registered,
      file: join(root, 'config.toml'),
      version: registered ? '2' : '1',
    }),
    register,
    close: async () => {},
  }));
  const sdk = vi.fn(async () => {
    throw new Error('must never use SDK');
  });
  const manager = new ConnectionManager(join(root, 'connections'), sdk);
  await manager.initialize();
  const authentication = new OfficialAuthentication(join(root, 'authentication-history'));
  await authentication.initialize();
  const login = vi.fn(async (method: string) =>
    method === 'mcpServerStatus/list'
      ? {
          data: [{ name: target.name, authStatus: oauth ? 'notLoggedIn' : 'unsupported' }],
          nextCursor: null,
        }
      : {
          loginId: 'login-one',
          authorizationUrl: 'https://provider.example/authorize?state=transient',
        },
  );
  const auth = vi.fn(async () => ({
    request: login,
    onNotification: () => () => {},
    onDisconnect: () => () => {},
    close: async () => {},
  }));
  const call = vi.fn(async () => ({ content: [{ type: 'text', text: 'read completed' }] }));
  const open = vi.fn(async () => ({
    listTools: async () => ({ tools: [{ name: 'read', inputSchema: { type: 'object' } }] }),
    callTool: call,
    close: async () => {},
  }));
  const preflight = vi.fn(async () => {});
  const runtime = new OfficeToolRuntime({
    stateDir: root,
    connections: manager,
    authentications: authentication,
  });
  const session = runtime.createSession({
    taskId: 'fixture',
    role: 'chief',
    project: root,
    officialConnections: { registration, open, authentication: auth, checkEndpoint: preflight },
  });
  return {
    root,
    url,
    register,
    sdk,
    manager,
    authentication,
    login,
    auth,
    call,
    open,
    preflight,
    runtime,
    session,
  };
}

it('groups registration and authentication discovery, then requires a separate exact tool approval', async () => {
  const h = await fixture();
  try {
    const pending = h.session.execute('connection_connect_codex', {
      name: 'Mi servicio',
      url: h.url,
    });
    await vi.waitFor(() => expect(h.runtime.approvals.list()).toHaveLength(1));
    expect(h.register).not.toHaveBeenCalled();
    expect(h.preflight).not.toHaveBeenCalled();
    expect(h.auth).not.toHaveBeenCalled();
    expect(h.open).not.toHaveBeenCalled();
    h.runtime.approvals.resolve(h.runtime.approvals.list()[0].id, true);
    await pending;
    expect(h.register).toHaveBeenCalledTimes(1);
    expect(h.preflight).toHaveBeenCalledTimes(1);
    const entry = h.manager.list()[0];
    expect(entry).toMatchObject({ engine: 'codex', state: 'unverified' });
    const operation = h.session.execute('connection_call', {
      connectionId: entry.id,
      tool: 'read',
      arguments: { value: 'approved' },
    });
    await vi.waitFor(() => expect(h.runtime.approvals.list()).toHaveLength(1));
    expect(h.call).not.toHaveBeenCalled();
    h.runtime.approvals.resolve(h.runtime.approvals.list()[0].id, true);
    await operation;
    expect(h.call).toHaveBeenCalledTimes(1);
    expect(h.manager.list()[0].state).toBe('available');
    expect(h.sdk).not.toHaveBeenCalled();
    const restored = new ConnectionManager(join(h.root, 'connections'), h.sdk);
    await restored.initialize();
    expect(restored.list()[0]).toMatchObject({ engine: 'codex', state: 'unverified', tools: [] });
    expect(h.call).toHaveBeenCalledTimes(1);
  } finally {
    await h.session.dispose();
  }
});

it('refreshes a registered catalogue for a reader without registration, OAuth or a tool call', async () => {
  const h = await fixture();
  const entry = await h.manager.remember('Mi servicio', h.url);
  await h.manager.adoptOfficial(entry.id, managedMcpTarget(h.url).name);
  const reader = h.runtime.createSession({
    taskId: 'reader',
    role: 'tester',
    project: h.root,
    officialConnections: {
      registration: new OfficialMcpRegistration(join(h.root, 'unused'), async () => {
        throw Error('must not register');
      }),
      open: h.open,
      authentication: h.auth,
    },
  });
  try {
    const result = await reader.execute('connection_check', { connectionId: entry.id });
    expect(JSON.stringify(result)).toContain('read');
    expect(h.manager.list()[0].tools.map((t) => t.name)).toEqual(['read']);
    expect(h.manager.list()[0].state).toBe('unverified');
    expect(h.open).toHaveBeenCalledTimes(1);
    expect(h.auth).not.toHaveBeenCalled();
    expect(h.register).not.toHaveBeenCalled();
    expect(h.call).not.toHaveBeenCalled();
    expect(h.sdk).not.toHaveBeenCalled();
    expect(h.runtime.approvals.list()).toHaveLength(0);
    let release!: () => void;
    const active = h.manager.provision(
      entry.id,
      new AbortController().signal,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    try {
      await expect(reader.execute('connection_check', { connectionId: entry.id })).rejects.toThrow(
        'operación activa',
      );
      expect(h.open).toHaveBeenCalledTimes(1);
    } finally {
      release();
      await active;
    }
    await h.manager.disable(entry.id);
    await expect(reader.execute('connection_check', { connectionId: entry.id })).rejects.toThrow(
      'desactivada',
    );
    expect(h.open).toHaveBeenCalledTimes(1);
    await expect(reader.execute('connection_check', { connectionId: 'unknown' })).rejects.toThrow(
      'no existe',
    );
  } finally {
    await reader.dispose();
    await h.session.dispose();
  }
});

it('denial saves only the disabled local record and never contacts the provider', async () => {
  const h = await fixture();
  try {
    const pending = h.session.execute('connection_connect_codex', {
      name: 'Mi servicio',
      url: h.url,
    });
    const rejected = expect(pending).rejects.toThrow('no fue autorizada');
    await vi.waitFor(() => expect(h.runtime.approvals.list()).toHaveLength(1));
    h.runtime.approvals.resolve(h.runtime.approvals.list()[0].id, false);
    await rejected;
    expect(h.manager.list()[0].enabled).toBe(false);
    for (const fn of [h.preflight, h.auth, h.register, h.open, h.call, h.sdk])
      expect(fn).not.toHaveBeenCalled();
  } finally {
    await h.session.dispose();
  }
});

it('invalidates an approved operation when its tool definition changes and never dispatches it', async () => {
  const h = await fixture();
  try {
    const pending = h.session.execute('connection_connect_codex', {
      name: 'Mi servicio',
      url: h.url,
    });
    await vi.waitFor(() => expect(h.runtime.approvals.list()).toHaveLength(1));
    h.runtime.approvals.resolve(h.runtime.approvals.list()[0].id, true);
    await pending;
    const operation = h.session.execute('connection_call', {
      connectionId: h.manager.list()[0].id,
      tool: 'read',
      arguments: {},
    });
    const rejected = expect(operation).rejects.toThrow('cambió desde la aprobación');
    await vi.waitFor(() => expect(h.runtime.approvals.list()).toHaveLength(1));
    h.open.mockImplementation(async () => ({
      listTools: async () => ({ tools: [{ name: 'read', inputSchema: { type: 'string' } }] }),
      callTool: h.call,
      close: async () => {},
    }));
    h.runtime.approvals.resolve(h.runtime.approvals.list()[0].id, true);
    await rejected;
    expect(h.call).not.toHaveBeenCalled();
    expect(h.manager.list()[0].uncertain).toBeUndefined();
  } finally {
    await h.session.dispose();
  }
});

it('disabling during official login cancels authentication without opening tools or re-enabling access', async () => {
  const h = await fixture(true);
  try {
    const pending = h.session.execute('connection_connect_codex', {
      name: 'Mi servicio',
      url: h.url,
    });
    await vi.waitFor(() => expect(h.runtime.approvals.list()).toHaveLength(1));
    h.runtime.approvals.resolve(h.runtime.approvals.list()[0].id, true);
    await vi.waitFor(() =>
      expect(h.authentication.list()[0]?.authorizationUrl).toContain('provider.example'),
    );
    expect(h.authentication.list()[0].service).toBe('Mi servicio');
    await h.manager.disable(h.manager.list()[0].id);
    await pending;
    expect(h.authentication.list()[0].status).toBe('cancelled');
    expect(h.manager.list()[0]).toMatchObject({ enabled: false, state: 'blocked' });
    expect(h.open).not.toHaveBeenCalled();
    expect(h.call).not.toHaveBeenCalled();
  } finally {
    await h.session.dispose();
  }
});
it('drains a pending official login before normal session closure and reports cancellation as an error result', async () => {
  const h = await fixture(true);
  try {
    const pending = h.session.execute('connection_connect_codex', {
      name: 'Mi servicio',
      url: h.url,
    });
    await vi.waitFor(() => expect(h.runtime.approvals.list()).toHaveLength(1));
    h.runtime.approvals.resolve(h.runtime.approvals.list()[0].id, true);
    await vi.waitFor(() => expect(h.authentication.list()[0]?.authorizationUrl).toBeTruthy());
    let finished = false;
    const drained = h.session.waitForIdle(new AbortController().signal).then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    h.authentication.cancel(h.authentication.list()[0].id);
    expect((await pending).isError).toBe(true);
    await drained;
    expect(finished).toBe(true);
    expect(h.open).not.toHaveBeenCalled();
  } finally {
    await h.session.dispose();
  }
});

it('does not register or authenticate after a refused provider preflight', async () => {
  const h = await fixture();
  try {
    h.preflight.mockRejectedValueOnce(new Error('El proveedor ha denegado el acceso (403).'));
    const pending = h.session.execute('connection_connect_codex', {
      name: 'Mi servicio',
      url: h.url,
    });
    const rejected = expect(pending).rejects.toThrow('403');
    await vi.waitFor(() => expect(h.runtime.approvals.list()).toHaveLength(1));
    h.runtime.approvals.resolve(h.runtime.approvals.list()[0].id, true);
    await rejected;
    expect(h.register).not.toHaveBeenCalled();
    expect(h.auth).not.toHaveBeenCalled();
    expect(h.open).not.toHaveBeenCalled();
  } finally {
    await h.session.dispose();
  }
});
