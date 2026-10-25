import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type AppServerApprovalRequest,
  appServerThreadConfig,
  CodexAppServerExecutor,
} from '../src/execution/codexAppServerExecutor.js';
import type { AppServerProtocol } from '../src/execution/codexAppServerProtocol.js';
import { ExecutionBlocked } from '../src/execution/types.js';
import { managedMcpTarget } from '../src/tools/officialMcpRegistration.js';
import type { PluginMcpSelection } from '../src/tools/pluginMcpSession.js';
import { accountFixture, limitsFixture, modelsFixture } from './executionFixtures.js';

const roots: string[] = [];
const objectConfig = (value: unknown) => value as Record<string, unknown>;
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function harness(mode = 'success') {
  const root = mkdtempSync(join(tmpdir(), 'office-app-server-'));
  roots.push(root);
  const listeners = new Set<(method: string, params: Record<string, unknown>) => void>();
  const notification = (method: string, params: Record<string, unknown>) => {
    for (const listener of listeners) listener(method, params);
  };
  let accountChanged = false;
  let turnCount = 0;
  const disconnects = new Set<() => void>();
  let serverRequest: (
    method: string,
    params: Record<string, unknown>,
  ) => Promise<unknown> = async () => null;
  const protocol: AppServerProtocol = {
    request: vi.fn(async (method, params) => {
      if (method === 'initialize') return {};
      if (method === 'config/read')
        return {
          config: {
            ...(mode.startsWith('plugin-mcp')
              ? {
                  features: { hooks: false, plugins: true },
                  plugins: {
                    'fixture@local': { enabled: true },
                    'other@local': { enabled: mode === 'plugin-mcp-unsafe' },
                  },
                }
              : {}),
            ...(mode === 'namespace-collision'
              ? { mcp_servers: { office: { command: 'unrelated-server' } } }
              : {}),
            apps: {
              _default: { default_tools_approval_mode: 'prompt', approvals_reviewer: 'user' },
              ...(mode === 'unsafe-app'
                ? { github: { tools: { push: { approval_mode: 'approve' } } } }
                : {}),
            },
          },
        };
      if (method === 'account/read') {
        if (mode === 'initial-account-update') notification('account/updated', {});
        return mode === 'api'
          ? { account: { type: 'apiKey' } }
          : accountChanged
            ? { account: { ...accountFixture().account, email: 'other@example.invalid' } }
            : accountFixture();
      }
      if (method === 'account/rateLimits/read') return limitsFixture();
      if (method === 'model/list') {
        const result = modelsFixture();
        for (const entry of result.data)
          Object.assign(entry, {
            inputModalities: mode.startsWith('no-vision') ? ['text'] : ['text', 'image'],
          });
        return result;
      }
      if (method === 'thread/start' || method === 'thread/resume')
        return {
          thread: { id: 'thread-one' },
          cwd: params?.cwd,
          model: mode === 'wrong-model' ? 'other' : params?.model,
          modelProvider: 'openai',
          sandbox: {
            type:
              objectConfig(params?.config).default_permissions === ':workspace'
                ? 'workspaceWrite'
                : 'readOnly',
            networkAccess: false,
          },
          approvalPolicy: 'on-request',
        };
      if (method === 'turn/interrupt') return {};
      if (method === 'mcpServer/tool/call')
        return { content: [{ type: 'text', text: 'fixture-github-user' }] };
      if (method === 'turn/steer') return { turnId: 'turn-one' };
      if (method === 'app/list')
        return {
          data: [
            {
              id: 'github',
              name: 'GitHub',
              isAccessible: true,
              isEnabled: true,
              privateToken: 'never-return',
            },
          ],
          nextCursor: null,
        };
      if (method === 'app/installed')
        return { apps: [{ id: 'github', runtimeName: 'GitHub', enabled: true, callable: true }] };
      if (method === 'app/read')
        return {
          apps: [
            {
              id: 'announced-app',
              name: 'Fixture',
              installUrl: 'https://chatgpt.com/apps/fixture/announced-app',
            },
          ],
          missingAppIds: [],
        };
      if (method === 'skills/list')
        return {
          data: [
            {
              skills: [
                {
                  name: 'imagegen',
                  enabled: true,
                  path: '/private/skill',
                  description: 'private instructions',
                },
              ],
            },
          ],
        };
      if (method === 'mcpServerStatus/list')
        return {
          data: [
            {
              name: mode.startsWith('plugin-mcp')
                ? 'fixture-server'
                : mode === 'oauth-server'
                  ? 'fixture'
                  : 'codex_apps',
              ...(mode.startsWith('plugin-mcp') ? { pluginId: 'fixture@local' } : {}),
              authStatus: mode === 'oauth-server' ? 'oAuth' : 'bearerToken',
              tools: { tool: {} },
              resources: [{ secret: 'never-return' }],
            },
          ],
          nextCursor: null,
        };
      if (method === 'turn/start') {
        turnCount++;
        setImmediate(async () => {
          if (mode === 'wait' || mode === 'no-vision-wait') return;
          if (mode === 'app-approval')
            await serverRequest('mcpServer/elicitation/request', {
              threadId: 'thread-one',
              serverName: 'github',
              message: 'Publicar cambio revisado',
            });
          if (mode === 'account-change') {
            accountChanged = true;
            notification('account/updated', {});
            return;
          }
          if (mode !== 'no-usage')
            notification('thread/tokenUsage/updated', {
              threadId: 'thread-one',
              turnId: 'turn-one',
              tokenUsage: {
                total: {
                  inputTokens: 20 * turnCount,
                  outputTokens: 5 * turnCount,
                  cachedInputTokens: 3 * turnCount,
                },
              },
            });
          notification('item/completed', {
            threadId: 'thread-one',
            item: { id: 'item-one', type: 'agentMessage', text: '**Resultado privado**' },
          });
          if (mode === 'image-generation')
            notification('item/completed', {
              threadId: 'thread-one',
              item: {
                id: 'generated-one',
                type: 'imageGeneration',
                status: 'completed',
                result: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64'),
              },
            });
          notification('item/completed', {
            threadId: 'thread-one',
            item: { id: 'item-one', type: 'agentMessage', text: '**Resultado privado**' },
          });
          notification('turn/completed', {
            threadId: 'thread-one',
            turn: { id: 'turn-one', status: 'completed' },
          });
        });
        return { turn: { id: 'turn-one' } };
      }
      throw new Error(`Unexpected ${method}`);
    }),
    notify: vi.fn(),
    onNotification: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onRequest: (listener) => {
      serverRequest = listener;
    },
    onDisconnect: (listener) => {
      disconnects.add(listener);
      return () => {
        disconnects.delete(listener);
      };
    },
    close: vi.fn(async () => {
      for (const listener of disconnects) listener();
      listeners.clear();
      disconnects.clear();
    }),
  };
  const approvals = {
    request: vi.fn(async (_request: AppServerApprovalRequest): Promise<unknown> => ({
      decision: 'accept',
    })),
  };
  const logoutMcp = vi.fn(async () => {});
  const checkMcpEndpoint = vi.fn(async () => {});
  const protocolFactory = vi.fn(
    (_runtime: { executable: string; version: string }, _args: string[], _env: NodeJS.ProcessEnv) =>
      protocol,
  );
  const executor = new CodexAppServerExecutor(root, {
    logoutMcp,
    checkMcpEndpoint,
    env: {},
    discover: async () => ({ executable: '/official/codex', version: '0.163.0' }),
    protocol: protocolFactory,
    approvals,
    pollMs: 1000,
  });
  return {
    root,
    executor,
    checkMcpEndpoint,
    logoutMcp,
    protocolFactory,
    protocol,
    approvals,
    notification,
    ask: (method: string, params = {}) => serverRequest(method, params),
  };
}

describe('Codex App Server executor (fixtures, no inference)', () => {
  it('keeps the official process alive after model completion until backend tools settle', async () => {
    const h = harness();
    let release = () => {};
    const tools = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waitForTools = vi.fn(async () => tools);
    const pending = h.executor.execute({
      project: h.root,
      prompt: 'Fixture',
      model: 'gpt-6.1-sol',
      effort: 'low',
      waitForTools,
    });
    await vi.waitFor(() => expect(waitForTools).toHaveBeenCalledTimes(1));
    expect(h.protocol.close).not.toHaveBeenCalled();
    release();
    expect((await pending).status).toBe('completed');
    expect(h.protocol.close).toHaveBeenCalled();
  });
  it('cancels a tool-draining execution without waiting for a human authorization', async () => {
    const h = harness(),
      controller = new AbortController();
    const waitForTools = vi.fn(
      async (signal: AbortSignal) =>
        new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true }),
        ),
    );
    const pending = h.executor.execute({
      project: h.root,
      prompt: 'Fixture',
      model: 'gpt-6.1-sol',
      effort: 'low',
      signal: controller.signal,
      waitForTools,
    });
    await vi.waitFor(() => expect(waitForTools).toHaveBeenCalledTimes(1));
    controller.abort();
    expect((await pending).status).toBe('cancelled');
    expect(h.protocol.close).toHaveBeenCalled();
  });
  it('reads the complete directory beyond ten pages and independently records installed runtime', async () => {
    const h = harness(),
      original = h.protocol.request;
    h.protocol.request = vi.fn(async (method, params) => {
      if (method !== 'app/list') return original(method, params);
      const page = params?.cursor ? Number(params.cursor) : 0;
      return {
        data: [{ id: `app-${page}`, name: `Application ${page}` }],
        nextCursor: page < 10 ? String(page + 1) : null,
      };
    });
    const result = await h.executor.discoverTools(h.root);
    expect(result.apps.items).toHaveLength(11);
    expect(result.apps.verified).toBe(true);
    expect(result.installedApps).toMatchObject({
      verified: true,
      items: [{ id: 'github', callable: true }],
    });
  });
  it('uses only official read-only app methods without exposing sessions or starting inference', async () => {
    const h = harness(),
      controller = new AbortController();
    const client = await h.executor.openApplications(controller.signal);
    await client.list('page-two');
    await client.read(['announced-app']);
    await client.installed(true);
    expect(h.protocol.request).toHaveBeenCalledWith('app/list', { limit: 100, cursor: 'page-two' });
    expect(h.protocol.request).toHaveBeenCalledWith('app/read', {
      appIds: ['announced-app'],
      includeTools: false,
    });
    expect(h.protocol.request).toHaveBeenCalledWith('app/installed', { forceRefresh: true });
    expect(
      vi
        .mocked(h.protocol.request)
        .mock.calls.some(([method]) => method === 'turn/start' || method === 'thread/start'),
    ).toBe(false);
    controller.abort();
    await expect(client.installed(true)).rejects.toMatchObject({ code: 'cancelled_by_user' });
    await client.close();
  });
  it('preserves a denied app directory without leaking the provider response or falling back', async () => {
    const h = harness();
    const original = h.protocol.request;
    h.protocol.request = vi.fn(async (method, params) => {
      if (method === 'app/list') throw new Error('HTTP 403 PRIVATE_PROVIDER_RESPONSE');
      return original(method, params);
    });
    const client = await h.executor.openApplications(new AbortController().signal);
    await expect(client.list()).rejects.toMatchObject({
      code: 'apps_metadata_unavailable',
      message: expect.stringContaining('403'),
    });
    expect(
      vi.mocked(h.protocol.request).mock.calls.some(([method]) => method === 'app/installed'),
    ).toBe(false);
    await client.close();
  });
  function managedHarness() {
    const h = harness(),
      target = managedMcpTarget('https://office-fixture.invalid/mcp');
    const original = h.protocol.request;
    let changed = false,
      unrelated = false;
    h.protocol.request = vi.fn(async (method, params) => {
      if (method === 'config/read') {
        const result = (await original(method, params)) as { config: Record<string, unknown> };
        return {
          ...result,
          layers: [
            { name: { type: 'user', file: join(h.root, 'config.toml') }, version: 'fixture-1' },
          ],
          config: {
            ...result.config,
            mcp_servers: {
              [target.name]: {
                url: changed ? 'https://other.invalid/mcp' : target.url,
                enabled: true,
              },
              unrelated: { command: 'must-stay-disabled' },
            },
          },
        };
      }
      if (method === 'mcpServerStatus/list')
        return {
          data: [
            {
              name: unrelated ? 'unrelated' : target.name,
              authStatus: 'unsupported',
              tools: { read: { inputSchema: { type: 'object' }, description: 'Read fixture' } },
            },
          ],
          nextCursor: null,
        };
      return original(method, params);
    });
    return {
      ...h,
      target,
      change: () => {
        changed = true;
      },
      unrelated: () => {
        unrelated = true;
      },
    };
  }
  it('uses a fixed official HTTP MCP target, checks included quota and never starts inference', async () => {
    const h = managedHarness(),
      signal = new AbortController().signal;
    const client = await h.executor.openManagedMcp(h.root, h.target, signal);
    expect(h.checkMcpEndpoint).toHaveBeenCalledWith(h.target.url, signal);
    expect((await client.listTools()).tools).toMatchObject([
      { name: 'read', description: 'Read fixture' },
    ]);
    await client.callTool({ name: 'read', arguments: { path: 'fixture' } });
    expect(h.protocol.request).toHaveBeenCalledWith('mcpServer/tool/call', {
      threadId: 'thread-one',
      server: h.target.name,
      tool: 'read',
      arguments: { path: 'fixture' },
    });
    const request = vi.mocked(h.protocol.request),
      start = request.mock.calls.find(([method]) => method === 'thread/start')![1]!;
    expect(objectConfig(start.config).mcp_servers).toMatchObject({
      unrelated: { enabled: false },
      [h.target.name]: { enabled: true },
    });
    expect(request.mock.calls.some(([method]) => method === 'turn/start')).toBe(false);
    expect(
      request.mock.calls.filter(([method]) => method === 'account/rateLimits/read').length,
    ).toBeGreaterThanOrEqual(3);
    await client.close();
  });
  it('restricts OAuth discovery and login to the registered official destination', async () => {
    const h = managedHarness();
    const client = await h.executor.openManagedAuthentication(
      h.target,
      new AbortController().signal,
    );
    await client.request('mcpServerStatus/list', { serverName: 'injected' });
    expect(h.protocol.request).toHaveBeenCalledWith('mcpServerStatus/list', {
      serverName: h.target.name,
    });
    await expect(client.request('mcpServer/oauth/login', { name: 'other' })).rejects.toMatchObject({
      code: 'auth_method_denied',
    });
    await expect(client.request('config/read')).rejects.toMatchObject({
      code: 'auth_method_denied',
    });
    await expect(client.logout('other')).rejects.toMatchObject({ code: 'auth_method_denied' });
    expect(h.logoutMcp).not.toHaveBeenCalled();
    h.change();
    await expect(client.logout(h.target.name)).rejects.toMatchObject({
      code: 'mcp_target_changed',
    });
    expect(h.logoutMcp).not.toHaveBeenCalled();
    await expect(
      client.request('mcpServer/oauth/login', { name: h.target.name }),
    ).rejects.toMatchObject({ code: 'mcp_target_changed' });
    expect(
      vi
        .mocked(h.protocol.request)
        .mock.calls.some(([method]) => method === 'mcpServer/oauth/login'),
    ).toBe(false);
    await client.close();
  });
  it('forwards a registered OAuth logout through the managed adapter to the official CLI', async () => {
    const h = managedHarness();
    const original = h.protocol.request;
    h.protocol.request = vi.fn(async (method, params) =>
      method === 'mcpServerStatus/list'
        ? { data: [{ name: h.target.name, authStatus: 'oAuth', tools: {} }], nextCursor: null }
        : original(method, params),
    );
    const client = await h.executor.openManagedAuthentication(
      h.target,
      new AbortController().signal,
    );
    await client.logout(h.target.name);
    expect(h.logoutMcp).toHaveBeenCalledTimes(1);
    expect(h.logoutMcp).toHaveBeenCalledWith(
      expect.anything(),
      h.target.name,
      expect.anything(),
      expect.anything(),
    );
    await client.close();
  });
  it('refuses a changed official URL or a catalogue from another server before dispatch', async () => {
    const h = managedHarness(),
      client = await h.executor.openManagedMcp(h.root, h.target, new AbortController().signal);
    h.unrelated();
    await expect(client.callTool({ name: 'read', arguments: {} })).rejects.toMatchObject({
      code: 'mcp_catalogue_invalid',
    });
    h.change();
    await expect(client.listTools()).rejects.toMatchObject({ code: 'mcp_target_changed' });
    expect(
      vi.mocked(h.protocol.request).mock.calls.some(([method]) => method === 'mcpServer/tool/call'),
    ).toBe(false);
    await client.close();
  });
  it('does not launch the official MCP transport after a refused public preflight', async () => {
    const h = managedHarness();
    h.checkMcpEndpoint.mockRejectedValueOnce(new Error('403'));
    await expect(
      h.executor.openManagedMcp(h.root, h.target, new AbortController().signal),
    ).rejects.toThrow('403');
    expect(h.protocolFactory).not.toHaveBeenCalled();
  });
  it('closes the owned connection on cancellation and rejects subsequent calls', async () => {
    const h = managedHarness(),
      controller = new AbortController();
    const client = await h.executor.openManagedMcp(h.root, h.target, controller.signal);
    controller.abort();
    await expect(client.listTools()).rejects.toMatchObject({ code: 'cancelled_by_user' });
    expect(h.protocol.close).toHaveBeenCalled();
  });
  it('writes only a generated public MCP entry with the official user-layer version and no arbitrary file path', async () => {
    const h = harness(),
      target = managedMcpTarget('https://office-fixture.invalid/mcp'),
      file = join(h.root, 'user-config.toml');
    const request = vi.mocked(h.protocol.request),
      original = request.getMockImplementation()!;
    let entry: Record<string, unknown> | undefined,
      version = 'v1';
    request.mockImplementation(async (method, params) => {
      if (method === 'config/read' && params?.includeLayers === true)
        return {
          config: { mcp_servers: entry ? { [target.name]: entry } : {} },
          layers: [{ name: { type: 'user', file }, version, config: {} }],
        };
      if (method === 'config/value/write') {
        entry = { url: target.url, enabled: true };
        version = 'v2';
        return { status: 'ok', filePath: file, version };
      }
      return original(method, params);
    });
    const client = await h.executor.openMcpRegistration(new AbortController().signal),
      expected = await client.inspect(target);
    await expect(
      client.register(target, { ...expected, file: join(h.root, 'another.toml') }),
    ).rejects.toMatchObject({ code: 'mcp_registration_changed' });
    await expect(
      client.inspect({ ...target, name: 'arbitrary.configuration' }),
    ).rejects.toMatchObject({ code: 'mcp_registration_target_invalid' });
    await client.register(target, expected);
    expect(request).toHaveBeenCalledWith('config/value/write', {
      keyPath: `mcp_servers.${target.name}`,
      value: { url: target.url, enabled: true, default_tools_approval_mode: 'prompt' },
      mergeStrategy: 'replace',
      filePath: file,
      expectedVersion: 'v1',
    });
    await expect(client.register(target, expected)).rejects.toMatchObject({
      code: 'mcp_registration_changed',
    });
    expect(request.mock.calls.filter(([method]) => method === 'config/value/write')).toHaveLength(
      1,
    );
    expect(
      request.mock.calls.some(
        ([method]) => method === 'turn/start' || method === 'mcpServer/oauth/login',
      ),
    ).toBe(false);
    await client.close();
  });
  it('does not write when the official user layer cannot be verified or the operation is cancelled', async () => {
    const h = harness(),
      controller = new AbortController(),
      target = managedMcpTarget('https://office-fixture.invalid/mcp'),
      client = await h.executor.openMcpRegistration(controller.signal);
    await expect(client.inspect(target)).rejects.toMatchObject({
      code: 'mcp_user_config_unverified',
    });
    controller.abort();
    await expect(client.inspect(target)).rejects.toMatchObject({ code: 'cancelled_by_user' });
    expect(h.protocol.request).not.toHaveBeenCalledWith('config/value/write', expect.anything());
    await client.close();
  });
  const selection: PluginMcpSelection = {
    pluginId: 'public',
    nativeId: 'fixture@local',
    name: 'fixture',
    marketplace: 'local',
    fingerprint: 'v1',
    pluginIds: ['fixture@local', 'other@local'],
    servers: ['fixture-server'],
  };
  it('opens an isolated native MCP context and binds each RPC to the selected plugin without inference', async () => {
    const h = harness('plugin-mcp'),
      client = await h.executor.openPluginMcp(h.root, selection, new AbortController().signal);
    expect((await client.list()).data).toHaveLength(1);
    await expect(client.call('unrelated-server', 'tool', {})).rejects.toMatchObject({
      code: 'plugin_tool_unavailable',
    });
    await expect(client.call('fixture-server', '__proto__', {})).rejects.toMatchObject({
      code: 'plugin_tool_unavailable',
    });
    await client.call('fixture-server', 'tool', { message: 'approved' });
    expect(h.protocol.request).toHaveBeenCalledWith('mcpServer/tool/call', {
      threadId: 'thread-one',
      server: 'fixture-server',
      tool: 'tool',
      arguments: { message: 'approved' },
    });
    expect(h.protocol.request).not.toHaveBeenCalledWith('turn/start', expect.anything());
    const started = vi.mocked(h.protocol.request).mock.calls.find(([m]) => m === 'thread/start')!;
    expect(objectConfig(started[1]?.config)).toMatchObject({
      'features.plugins': true,
      'features.hooks': false,
      plugins: { 'fixture@local': { enabled: true }, 'other@local': { enabled: false } },
    });
    expect(h.protocolFactory.mock.calls[0][1]).toContain('features.hooks=false');
    await client.close();
    await expect(client.list()).rejects.toMatchObject({ code: 'cancelled_by_user' });
  });
  it('refuses to connect if another plugin remains enabled in the effective configuration', async () => {
    const h = harness('plugin-mcp-unsafe');
    await expect(
      h.executor.openPluginMcp(h.root, selection, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'plugin_isolation_unconfirmed' });
    expect(h.protocol.request).not.toHaveBeenCalledWith('thread/start', expect.anything());
  });
  it('only signs out a current OAuth catalogue entry through the fixed official command', async () => {
    const h = harness('oauth-server'),
      controller = new AbortController();
    const client = await h.executor.openAuthentication(controller.signal);
    await expect(client.logout('unregistered')).rejects.toMatchObject({
      code: 'auth_server_changed',
    });
    expect(h.logoutMcp).not.toHaveBeenCalled();
    await client.logout('fixture');
    expect(h.logoutMcp).toHaveBeenCalledWith(
      { executable: '/official/codex', version: '0.163.0' },
      'fixture',
      expect.anything(),
      controller.signal,
    );
    await client.close();
    await expect(client.logout('fixture')).rejects.toMatchObject({ code: 'cancelled_by_user' });
    expect(h.logoutMcp).toHaveBeenCalledTimes(1);
  });
  it('refuses MCP logout of the bearer-token apps bridge', async () => {
    const h = harness(),
      client = await h.executor.openAuthentication(new AbortController().signal);
    await expect(client.logout('codex_apps')).rejects.toMatchObject({
      code: 'auth_server_changed',
    });
    expect(h.logoutMcp).not.toHaveBeenCalled();
    await client.close();
  });
  it.each(['incomplete', 'duplicate'] as const)(
    'refuses a %s OAuth catalogue before logout',
    async (mode) => {
      const h = harness('oauth-server');
      const client = await h.executor.openAuthentication(new AbortController().signal);
      const request = vi.mocked(h.protocol.request),
        original = request.getMockImplementation()!;
      request.mockImplementation(async (method, params) => {
        if (method !== 'mcpServerStatus/list') return original(method, params);
        if (!params?.cursor)
          return { data: [{ name: 'fixture', authStatus: 'oAuth' }], nextCursor: 'page-2' };
        return mode === 'incomplete'
          ? {}
          : { data: [{ name: 'fixture', authStatus: 'oAuth' }], nextCursor: null };
      });
      await expect(client.logout('fixture')).rejects.toMatchObject({ code: 'auth_server_changed' });
      expect(h.logoutMcp).not.toHaveBeenCalled();
      await client.close();
    },
  );
  it('owns the technical thread and invokes only the official bridge without model inference', async () => {
    const h = harness(),
      client = await h.executor.openIntegrations(h.root, new AbortController().signal);
    expect(await client.call('github.get_user_login', {})).toMatchObject({
      content: [{ type: 'text', text: 'fixture-github-user' }],
    });
    expect(h.protocol.request).toHaveBeenCalledWith('mcpServer/tool/call', {
      threadId: 'thread-one',
      server: 'codex_apps',
      tool: 'github.get_user_login',
      arguments: {},
    });
    expect(h.protocol.request).not.toHaveBeenCalledWith('turn/start', expect.anything());
    await client.close();
  });
  it('restricts the authentication client to registered status and OAuth operations', async () => {
    const h = harness(),
      controller = new AbortController();
    const client = await h.executor.openAuthentication(controller.signal);
    await expect(client.request('plugin/install', {})).rejects.toMatchObject({
      code: 'auth_method_denied',
    });
    const notify = vi.fn();
    const remove = client.onNotification(notify);
    h.notification('mcpServer/oauthLogin/completed', {
      name: 'fixture',
      loginId: 'attempt',
      success: true,
    });
    expect(notify).toHaveBeenCalledOnce();
    remove();
    controller.abort();
    await expect(client.request('mcpServerStatus/list')).rejects.toMatchObject({
      code: 'cancelled_by_user',
    });
    await client.close();
  });
  it('exposes only official plugin metadata and lifecycle methods and stops after cancellation', async () => {
    const h = harness(),
      controller = new AbortController();
    const client = await h.executor.openPluginManagement(controller.signal);
    await expect(client.request('turn/start', {})).rejects.toMatchObject({
      code: 'plugin_method_denied',
    });
    expect(h.protocol.request).not.toHaveBeenCalledWith('turn/start', expect.anything());
    controller.abort();
    await expect(client.request('plugin/list', {})).rejects.toMatchObject({
      code: 'cancelled_by_user',
    });
    await client.close();
  });
  it('does not silently start another thread if resuming the Chief fails', async () => {
    const h = harness();
    const options = {
      project: h.root,
      prompt: 'Coordina',
      officeRole: 'chief' as const,
      objectiveSessionKey: 'goal',
    };
    await h.executor.execute(options);
    const request = vi.mocked(h.protocol.request);
    const implementation = request.getMockImplementation()!;
    request.mockImplementation(async (method, params) => {
      if (method === 'thread/resume') throw new Error('Disconnected');
      return implementation(method, params);
    });
    const result = await h.executor.execute(options);
    expect(result.status).toBe('blocked');
    expect(request.mock.calls.filter(([method]) => method === 'thread/start')).toHaveLength(1);
  });
  it('resumes only the same Chief objective and counts each turn once', async () => {
    const h = harness();
    const options = {
      project: h.root,
      prompt: 'Coordina',
      officeRole: 'chief' as const,
      objectiveSessionKey: 'objective-a',
    };
    const first = await h.executor.execute(options);
    const second = await h.executor.execute({
      ...options,
      prompt: 'Continúa con la entrega del Tester',
    });
    expect(first).toMatchObject({
      status: 'completed',
      sessionMode: 'new',
      inputTokens: 20,
      outputTokens: 5,
    });
    expect(second).toMatchObject({
      status: 'completed',
      sessionMode: 'resume',
      sessionId: first.sessionId,
      inputTokens: 20,
      outputTokens: 5,
      cachedInputTokens: 3,
    });
    expect(h.protocol.request).toHaveBeenCalledWith(
      'thread/resume',
      expect.objectContaining({ threadId: first.sessionId }),
    );
    h.executor.releaseObjectiveSession('objective-a');
    const next = await h.executor.execute(options);
    expect(next.sessionMode).toBe('new');
  });
  it('keeps specialists and other objectives in new independent conversations', async () => {
    const h = harness();
    await h.executor.execute({
      project: h.root,
      prompt: 'Coordina',
      officeRole: 'chief',
      objectiveSessionKey: 'a',
    });
    const specialist = await h.executor.execute({
      project: h.root,
      prompt: 'Revisa',
      officeRole: 'tester',
      objectiveSessionKey: 'a',
    });
    const other = await h.executor.execute({
      project: h.root,
      prompt: 'Otro objetivo',
      officeRole: 'chief',
      objectiveSessionKey: 'b',
    });
    expect(specialist.sessionMode).toBe('new');
    expect(other.sessionMode).toBe('new');
    expect(h.protocol.request).not.toHaveBeenCalledWith('thread/resume', expect.anything());
  });
  it('refuses inherited MCP configuration in the private broker namespace', async () => {
    const h = harness('namespace-collision');
    const record = await h.executor.execute({
      project: h.root,
      prompt: 'work',
      toolServer: { url: 'http://127.0.0.1:9999/mcp', token: 'ephemeral' },
    });
    expect(record).toMatchObject({ status: 'blocked', reasonCode: 'tool_namespace_conflict' });
    expect(h.protocol.request).not.toHaveBeenCalledWith('turn/start', expect.anything());
  });
  it('accepts an initial account notification only after rechecking the same identity', async () => {
    const h = harness('initial-account-update');
    const record = await h.executor.execute({ project: h.root, prompt: 'work' });
    expect(record.status).toBe('completed');
  });
  it('discovers sanitized installed capabilities without starting a model turn', async () => {
    const h = harness();
    const catalog = await h.executor.discoverTools(h.root);
    expect(catalog.apps.items).toEqual([
      { id: 'github', name: 'GitHub', connected: true, enabled: true },
    ]);
    expect(catalog.skills.items).toEqual([{ name: 'imagegen', enabled: true }]);
    expect(catalog.mcp.items).toEqual([
      { name: 'codex_apps', authStatus: 'bearerToken', tools: 1 },
    ]);
    expect(JSON.stringify(catalog)).not.toContain('never-return');
    expect(JSON.stringify(catalog)).not.toContain('/private');
    expect(h.protocol.request).not.toHaveBeenCalledWith('turn/start', expect.anything());
  });
  it('holds app execution until an individual approval has been resolved', async () => {
    const h = harness('app-approval');
    let accept: ((value: unknown) => void) | undefined;
    h.approvals.request.mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          accept = resolve;
        }),
    );
    const output = vi.fn();
    const pending = h.executor.execute({
      project: h.root,
      prompt: 'publish the reviewed change',
      onOutput: output,
    });
    await vi.waitFor(() => expect(accept).toBeTypeOf('function'));
    expect(output).not.toHaveBeenCalled();
    accept!({ action: 'accept', content: {} });
    expect((await pending).status).toBe('completed');
    expect(output).toHaveBeenCalledOnce();
  });
  it('stores native image output as an artifact without putting base64 in the receipt', async () => {
    const h = harness('image-generation');
    const artifact = vi.fn();
    const record = await h.executor.execute({
      project: h.root,
      prompt: 'draw',
      artifactDirectory: h.root,
      onArtifact: artifact,
    });
    expect(record.status).toBe('completed');
    expect(artifact).toHaveBeenCalledOnce();
    expect(readFileSync(artifact.mock.calls[0][0]).subarray(0, 4)).toEqual(
      Buffer.from([137, 80, 78, 71]),
    );
    expect(readFileSync(join(h.root, `${record.id}.json`), 'utf8')).not.toContain('iVBORw0KGgo');
  });
  it('runs one new thread with included quota, explicit model and safe receipt', async () => {
    const h = harness();
    const output = vi.fn();
    const result = await h.executor.execute({
      project: h.root,
      prompt: 'private prompt',
      onOutput: output,
    });
    expect(result).toMatchObject({
      status: 'completed',
      engine: 'codex-app-server',
      sessionMode: 'new',
      inputTokens: 20,
      outputTokens: 5,
      cachedInputTokens: 3,
    });
    expect(output).toHaveBeenCalledTimes(1);
    const receipt = readFileSync(join(h.root, `${result.id}.json`), 'utf8');
    expect(receipt).not.toContain('private prompt');
    expect(receipt).not.toContain('Resultado privado');
    expect(h.protocol.close).toHaveBeenCalledOnce();
  });
  it.each([
    ['api', 'subscription_unverified'],
    ['wrong-model', 'model_unconfirmed'],
    ['no-usage', 'usage_unknown'],
    ['account-change', 'account_changed'],
    ['unsafe-app', 'apps_approval_unverified'],
  ])('blocks or pauses %s', async (mode, reason) => {
    const h = harness(mode);
    const result = await h.executor.execute({ project: h.root, prompt: 'work' });
    expect(result.reasonCode).toBe(reason);
    expect(result.status).not.toBe('completed');
  });
  it('uses multimodal localImage inputs only after the model confirms image support', async () => {
    const h = harness();
    const image = join(h.root, 'test.png');
    writeFileSync(image, Buffer.from([1]));
    const result = await h.executor.execute({
      project: h.root,
      prompt: 'inspect',
      imagePaths: [image],
    });
    expect(result.status).toBe('completed');
    expect(h.protocol.request).toHaveBeenCalledWith(
      'turn/start',
      expect.objectContaining({
        input: [
          { type: 'text', text: 'inspect' },
          { type: 'localImage', path: image },
        ],
      }),
    );
    const missing = harness('no-vision');
    const blocked = await missing.executor.execute({
      project: missing.root,
      prompt: 'inspect',
      imagePaths: [image],
    });
    expect(blocked.reasonCode).toBe('image_model_unverified');
  });
  it('cancels the owned turn without resuming or retrying', async () => {
    const h = harness('wait');
    const controller = new AbortController();
    const promise = h.executor.execute({
      project: h.root,
      prompt: 'work',
      signal: controller.signal,
    });
    await vi.waitFor(() =>
      expect(h.protocol.request).toHaveBeenCalledWith('turn/start', expect.anything()),
    );
    controller.abort();
    const result = await promise;
    expect(result.status).toBe('cancelled');
    expect(h.protocol.request).toHaveBeenCalledWith('turn/interrupt', {
      threadId: 'thread-one',
      turnId: 'turn-one',
    });
  });
  it('routes individual approvals, rejects session grants and never forwards authentication requests', async () => {
    const h = harness('wait');
    const controller = new AbortController();
    const pending = h.executor.execute({
      project: h.root,
      prompt: 'work',
      allowWrites: true,
      signal: controller.signal,
    });
    await vi.waitFor(() =>
      expect(h.protocol.request).toHaveBeenCalledWith('turn/start', expect.anything()),
    );
    expect(await h.ask('item/commandExecution/requestApproval')).toEqual({ decision: 'accept' });
    h.approvals.request.mockResolvedValueOnce({ decision: 'acceptForSession' });
    expect(await h.ask('item/commandExecution/requestApproval')).toEqual({ decision: 'decline' });
    expect(await h.ask('account/chatgptAuthTokens/refresh')).toEqual({ decision: 'decline' });
    expect(await h.ask('item/permissions/requestApproval')).toEqual({
      permissions: {},
      scope: 'turn',
    });
    expect(await h.ask('item/fileChange/requestApproval', { grantRoot: 'C:/' })).toEqual({
      decision: 'decline',
    });
    expect(h.approvals.request).toHaveBeenCalledTimes(2);
    controller.abort();
    await pending;
  });
  it('accepts a known local patch without asking again and retains role and scope restrictions', async () => {
    const h = harness('wait');
    const controller = new AbortController();
    const pending = h.executor.execute({
      project: h.root,
      prompt: 'work',
      allowWrites: true,
      signal: controller.signal,
    });
    await vi.waitFor(() =>
      expect(h.protocol.request).toHaveBeenCalledWith('turn/start', expect.anything()),
    );
    const request = { threadId: 'thread-one', turnId: 'turn-one', itemId: 'patch' };
    h.notification('item/started', {
      ...request,
      item: {
        id: 'patch',
        type: 'fileChange',
        status: 'inProgress',
        changes: [{ path: join(h.root, 'new.mjs'), kind: { type: 'add' }, diff: '+local' }],
      },
    });
    expect(await h.ask('item/fileChange/requestApproval', request)).toEqual({ decision: 'accept' });
    expect(await h.ask('item/fileChange/requestApproval', request)).toEqual({
      decision: 'decline',
    });
    expect(h.approvals.request).not.toHaveBeenCalled();
    controller.abort();
    await pending;
  });
  it('pins network-restricted local permissions and only the owned MCP bridge', () => {
    const config = appServerThreadConfig({
      project: '/project',
      prompt: 'work',
      allowWrites: true,
      toolServer: { url: 'http://127.0.0.1:9999/mcp', token: 'ephemeral' },
    });
    expect(config).toMatchObject({
      default_permissions: ':workspace',
      'sandbox_workspace_write.network_access': false,
      'features.multi_agent': false,
      'features.apps': true,
      apps: { _default: { default_tools_approval_mode: 'prompt', approvals_reviewer: 'user' } },
    });
    expect(Object.keys(config.mcp_servers as object)).toEqual(['office']);
    if (process.platform === 'win32') {
      expect(config['features.prefer_mxc']).toBe(true);
      expect(config['windows.sandbox']).toBe('elevated');
    }
    expect(objectConfig(config.mcp_servers).office).toMatchObject({
      enabled: true,
      required: true,
      default_tools_approval_mode: 'approve',
    });
    expect(() =>
      appServerThreadConfig({
        project: '/p',
        prompt: 'work',
        toolServer: { url: 'https://external.invalid', token: 'x' },
      }),
    ).toThrow();
  });
});

describe('native steering (fixtures, no inference)', () => {
  it('streams observed commands and public reasoning summaries without exposing obvious credentials', async () => {
    const h = harness('wait'),
      progress = vi.fn(),
      output = vi.fn(),
      controller = new AbortController();
    const pending = h.executor.execute({
      project: h.root,
      prompt: 'work',
      onProgress: progress,
      onOutput: output,
      signal: controller.signal,
    });
    await vi.waitFor(() =>
      expect(h.protocol.request).toHaveBeenCalledWith('turn/start', expect.anything()),
    );
    h.notification('item/started', {
      threadId: 'thread-one',
      item: { id: 'cmd', type: 'commandExecution', command: 'npm test' },
    });
    h.notification('item/commandExecution/outputDelta', {
      threadId: 'thread-one',
      itemId: 'cmd',
      delta: '\nTests passed',
    });
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: 'Ejecutando un comando',
        detail: 'npm test\nTests passed',
        completed: false,
      }),
    );
    h.notification('item/reasoning/summaryTextDelta', {
      threadId: 'thread-one',
      itemId: 'think',
      delta: 'Revisando el resultado',
    });
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Pensando', detail: 'Revisando el resultado' }),
    );
    h.notification('item/started', {
      threadId: 'thread-one',
      item: { id: 'secret', type: 'commandExecution', command: 'export API_KEY=private' },
    });
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ detail: '[Contenido sensible ocultado]' }),
    );
    h.notification('item/completed', {
      threadId: 'thread-one',
      item: {
        id: 'think',
        type: 'reasoning',
        summary: ['Resumen público completo', 'Comprobar las fuentes'],
      },
    });
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: 'Pensando',
        detail: 'Resumen público completo\n\nComprobar las fuentes',
        completed: true,
      }),
    );
    h.notification('item/completed', {
      threadId: 'thread-one',
      item: {
        id: 'update',
        type: 'agentMessage',
        phase: 'commentary',
        text: 'Voy a buscar la documentación oficial',
      },
    });
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ detail: 'Voy a buscar la documentación oficial' }),
    );
    h.notification('item/started', {
      threadId: 'thread-one',
      item: {
        id: 'tool',
        type: 'mcpToolCall',
        tool: 'project_list',
        arguments: { path: 'server' },
      },
    });
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Usando una herramienta: project_list' }),
    );
    h.notification('item/completed', {
      threadId: 'thread-one',
      item: {
        id: 'decision',
        type: 'agentMessage',
        phase: 'final_answer',
        text: 'OFFICE_DECISION {"action":"complete","message":"Resultado"}',
      },
    });
    const { parseOfficeDecision } = await import('../src/execution/officeLoop.js');
    expect(parseOfficeDecision(output.mock.calls.map(([text]) => text).join(''))).toEqual({
      action: 'complete',
      message: 'Resultado',
    });
    controller.abort();
    await pending;
  });
  async function running(mode = 'wait') {
    const h = harness(mode);
    const controller = new AbortController();
    const pending = h.executor.execute({
      project: h.root,
      prompt: 'initial',
      executionSessionKey: 'owned-task',
      signal: controller.signal,
    });
    await vi.waitFor(() =>
      expect(h.protocol.request).toHaveBeenCalledWith('turn/start', expect.anything()),
    );
    return { ...h, controller, pending };
  }

  it('uses the owned active turn and sends a repeated message exactly once', async () => {
    const h = await running();
    expect(h.executor.supportsSteering).toBe(true);
    const input = { id: 'message-one', text: 'Use blue instead' };
    expect(await h.executor.steer('owned-task', input)).toEqual({
      status: 'accepted',
      turnId: 'turn-one',
    });
    expect(await h.executor.steer('owned-task', input)).toEqual({
      status: 'accepted',
      turnId: 'turn-one',
    });
    const calls = vi
      .mocked(h.protocol.request)
      .mock.calls.filter(([method]) => method === 'turn/steer');
    expect(calls).toEqual([
      [
        'turn/steer',
        {
          threadId: 'thread-one',
          expectedTurnId: 'turn-one',
          clientUserMessageId: 'message-one',
          input: [{ type: 'text', text: 'Use blue instead' }],
        },
      ],
    ]);
    await expect(
      h.executor.steer('owned-task', { ...input, text: 'different' }),
    ).rejects.toMatchObject({ code: 'steering_conflict' });
    expect(await h.executor.steer('foreign-task', input)).toEqual({ status: 'not_running' });
    h.controller.abort();
    await h.pending;
    expect(await h.executor.steer('owned-task', input)).toMatchObject({ status: 'accepted' });
    expect(await h.executor.steer('owned-task', { id: 'new', text: 'later' })).toEqual({
      status: 'not_running',
    });
  });

  it('deduplicates concurrent calls and preserves uncertain delivery without retrying', async () => {
    const h = await running();
    const original = vi.mocked(h.protocol.request).getMockImplementation()!;
    let fail: ((error: Error) => void) | undefined;
    vi.mocked(h.protocol.request).mockImplementation((method, params) =>
      method === 'turn/steer'
        ? new Promise((_resolve, reject) => {
            fail = reject;
          })
        : original(method, params),
    );
    const input = { id: 'uncertain', text: 'change' };
    const first = h.executor.steer('owned-task', input);
    const second = h.executor.steer('owned-task', input);
    fail!(new ExecutionBlocked('app_server_timeout', 'timeout'));
    expect(await first).toEqual({ status: 'unknown' });
    expect(await second).toEqual({ status: 'unknown' });
    expect(await h.executor.steer('owned-task', input)).toEqual({ status: 'unknown' });
    expect(
      vi.mocked(h.protocol.request).mock.calls.filter(([method]) => method === 'turn/steer'),
    ).toHaveLength(1);
    h.controller.abort();
    await h.pending;
  });

  it('does not send to a completed turn while final verification is still running', async () => {
    const h = await running();
    h.notification('thread/tokenUsage/updated', {
      threadId: 'thread-one',
      tokenUsage: { total: { inputTokens: 20, outputTokens: 5 } },
    });
    h.notification('turn/completed', {
      threadId: 'thread-one',
      turn: { id: 'turn-one', status: 'completed' },
    });
    expect(await h.executor.steer('owned-task', { id: 'late', text: 'new task' })).toEqual({
      status: 'not_running',
    });
    expect((await h.pending).status).toBe('completed');
    expect(h.protocol.request).not.toHaveBeenCalledWith('turn/steer', expect.anything());
  });

  it('treats a definite rejection racing with completion as not running', async () => {
    const h = await running();
    const original = vi.mocked(h.protocol.request).getMockImplementation()!;
    vi.mocked(h.protocol.request).mockImplementation(async (method, params) => {
      if (method !== 'turn/steer') return original(method, params);
      h.notification('thread/tokenUsage/updated', {
        threadId: 'thread-one',
        tokenUsage: { total: { inputTokens: 20, outputTokens: 5 } },
      });
      h.notification('turn/completed', {
        threadId: 'thread-one',
        turn: { id: 'turn-one', status: 'completed' },
      });
      throw new ExecutionBlocked('app_server_rejected', 'turn no longer active');
    });
    expect(await h.executor.steer('owned-task', { id: 'racing', text: 'change' })).toEqual({
      status: 'not_running',
    });
    expect((await h.pending).status).toBe('completed');
  });

  it('preserves observed usage on a coordinator redirection instead of recording a false completion', async () => {
    const h = await running();
    h.notification('thread/tokenUsage/updated', {
      threadId: 'thread-one',
      tokenUsage: { total: { inputTokens: 20, outputTokens: 5, cachedInputTokens: 3 } },
    });
    h.controller.abort('redirected_by_user');
    expect(await h.pending).toMatchObject({
      status: 'cancelled',
      reasonCode: 'redirected_by_user',
      inputTokens: null,
      outputTokens: null,
      observedUsage: { inputTokens: 20, outputTokens: 5, cachedInputTokens: 3 },
    });
  });

  it('does not report acceptance when the native response confirms a different turn', async () => {
    const h = await running();
    const original = vi.mocked(h.protocol.request).getMockImplementation()!;
    vi.mocked(h.protocol.request).mockImplementation(async (method, params) =>
      method === 'turn/steer' ? { turnId: 'foreign-turn' } : original(method, params),
    );
    expect(await h.executor.steer('owned-task', { id: 'unverified', text: 'change' })).toEqual({
      status: 'unknown',
    });
    h.controller.abort();
    await h.pending;
  });

  it('invalidates old native approvals and permits a new revision without aborting the model', async () => {
    const h = await running();
    let accept: ((response: unknown) => void) | undefined;
    let approvalSignal: AbortSignal | undefined;
    h.approvals.request.mockImplementationOnce(async (request) => {
      approvalSignal = request.signal;
      return new Promise((resolve) => {
        accept = resolve;
      });
    });
    const approval = h.ask('mcpServer/elicitation/request');
    await vi.waitFor(() => expect(accept).toBeTypeOf('function'));
    expect(approvalSignal!.aborted).toBe(false);
    await h.executor.steer('owned-task', { id: 'revised', text: 'do something else' });
    expect(approvalSignal!.aborted).toBe(true);
    accept!({ action: 'accept', content: {} });
    expect(await approval).toEqual({ action: 'decline' });
    expect(h.controller.signal.aborted).toBe(false);
    expect(await h.ask('mcpServer/elicitation/request')).toEqual({ decision: 'accept' });
    h.controller.abort('redirected_by_user');
    expect(await h.pending).toMatchObject({
      status: 'cancelled',
      reasonCode: 'redirected_by_user',
    });
  });

  it('validates image files and confirms vision even when the initial input was text only', async () => {
    const h = await running();
    const image = join(h.root, 'image.png');
    writeFileSync(image, Buffer.from([1]));
    expect(
      await h.executor.steer('owned-task', { id: 'visual', text: 'see this', imagePaths: [image] }),
    ).toMatchObject({ status: 'accepted' });
    expect(h.protocol.request).toHaveBeenCalledWith(
      'turn/steer',
      expect.objectContaining({
        input: [
          { type: 'text', text: 'see this' },
          { type: 'localImage', path: image },
        ],
      }),
    );
    await expect(
      h.executor.steer('owned-task', {
        id: 'invalid',
        text: 'see this',
        imagePaths: ['relative.png'],
      }),
    ).rejects.toMatchObject({ code: 'invalid_images' });
    h.controller.abort();
    await h.pending;
    const unsupported = await running('no-vision-wait');
    await expect(
      unsupported.executor.steer('owned-task', {
        id: 'visual',
        text: 'see this',
        imagePaths: [image],
      }),
    ).rejects.toMatchObject({ code: 'image_model_unverified' });
    unsupported.controller.abort();
    await unsupported.pending;
  });

  it('always releases the execution when protocol cleanup fails', async () => {
    const h = await running();
    vi.mocked(h.protocol.close).mockRejectedValue(new Error('close failed'));
    h.controller.abort();
    expect(await h.pending).toMatchObject({ reasonCode: 'cancelled_by_user' });
    expect(await h.executor.steer('owned-task', { id: 'closed', text: 'later' })).toEqual({
      status: 'not_running',
    });
    // A second run acquires the same lease rather than remaining blocked by cleanup.
    vi.mocked(h.protocol.close).mockResolvedValue();
    const controller = new AbortController();
    controller.abort();
    expect(
      await h.executor.execute({ project: h.root, prompt: 'next', signal: controller.signal }),
    ).toMatchObject({ status: 'cancelled' });
  });
});
