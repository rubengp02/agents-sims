import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExecutionBlocked } from '../src/execution/types.js';
import { OfficialPlugins, type PluginClient } from '../src/tools/officialPlugins.js';
import { OperationReviewRegistry } from '../src/tools/operationReviews.js';
import type { PluginMcpSelection } from '../src/tools/pluginMcpSession.js';
import { OfficeToolRuntime } from '../src/tools/toolRuntime.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'office-plugin-lifecycle-'));
  roots.push(root);
  let installed = false,
    version = '1',
    fail = false,
    missing = false,
    incomplete = false,
    duplicate = false;
  let skills: Array<Record<string, unknown>> = [];
  let source: Record<string, unknown> = { type: 'remote' };
  let remotePluginId: string | undefined = 'plugin_remote_fixture';
  let remoteContents: unknown = '# Remote skill',
    changeVersionOnRead = false;
  const summary = () => ({
    id: 'plugin-id',
    name: 'fixture',
    installed,
    enabled: installed,
    version,
    source,
    remotePluginId,
    availability: 'AVAILABLE',
    installPolicy: 'AVAILABLE',
  });
  const request = vi.fn<PluginClient['request']>(async (method) => {
    if (method === 'plugin/list')
      return {
        marketplaces: [
          {
            name: 'official-fixture',
            plugins: missing
              ? []
              : duplicate
                ? [summary(), { ...summary(), version: 'conflicting-version' }]
                : [summary()],
          },
        ],
        marketplaceLoadErrors: incomplete ? [{ message: 'not exposed' }] : [],
      };
    if (method === 'plugin/read')
      return {
        plugin: {
          summary: summary(),
          description: 'Fixture package',
          skills,
          apps: [{ id: 'fixture-app', name: 'Fixture' }],
          mcpServers: ['fixture'],
          hooks: [],
        },
      };
    if (method === 'plugin/skill/read') {
      if (changeVersionOnRead) version = '2';
      return { contents: remoteContents };
    }
    if (method === 'plugin/install') {
      if (fail) throw new Error('lost response');
      installed = true;
      return { appsNeedingAuth: [{ id: 'fixture-app', name: 'Fixture' }] };
    }
    if (method === 'plugin/uninstall') {
      installed = false;
      missing = true;
      return {};
    }
    throw new Error('unexpected');
  });
  const open = async () => ({
    request,
    configuredPluginNames: ['configured-but-not-catalogued@local'],
    close: async () => {},
  });
  const cache = join(root, 'plugins', 'cache');
  const nativeCall = vi.fn(
    async (_server: string, _tool: string, _args: Record<string, unknown>) => ({
      content: [{ type: 'text', text: 'NATIVE_FIXTURE_OK' }],
    }),
  );
  const nativeClose = vi.fn(async () => {});
  const nativeOpen = vi.fn(async (_selection: PluginMcpSelection, _signal: AbortSignal) => ({
    list: async () => ({
      data: [
        {
          name: 'fixture',
          pluginId: 'plugin-id',
          tools: {
            operation: { description: 'Fixture operation', inputSchema: { type: 'object' } },
          },
        },
      ],
    }),
    call: nativeCall,
    close: nativeClose,
  }));
  const manager = new OfficialPlugins(root, open, cache, nativeOpen);
  const pluginId = (await manager.list(root, new AbortController().signal)).plugins[0].id;
  const runtime = new OfficeToolRuntime({ stateDir: root });
  const session = runtime.createSession({
    taskId: 'chief',
    role: 'chief',
    project: root,
    plugins: manager,
  });
  return {
    root,
    cache,
    pluginId,
    manager,
    nativeCall,
    nativeOpen,
    nativeClose,
    runtime,
    session,
    request,
    open,
    installed: () => {
      installed = true;
    },
    localSource: () => {
      source = { type: 'local', path: join(root, 'source') };
    },
    skills: (entries: Array<Record<string, unknown>>) => {
      skills = entries;
    },
    version: () => {
      version = '2';
    },
    remoteId: (value: string | undefined) => {
      remotePluginId = value;
    },
    remoteSkill: (contents: unknown, changeVersion = false) => {
      remoteContents = contents;
      changeVersionOnRead = changeVersion;
    },
    fail: () => {
      fail = true;
    },
    incomplete: () => {
      incomplete = true;
    },
    duplicate: () => {
      duplicate = true;
    },
  };
}
describe('official plugin lifecycle (RPC fixtures, no real installation)', () => {
  it('loads complete remote instructions for a reader using catalogue identity, without inventing local files', async () => {
    const h = await fixture(),
      signal = new AbortController().signal;
    h.installed();
    h.skills([{ name: 'remote-demo', enabled: true }]);
    const text = '# Complete remote instructions\n' + 'á🙂 context\n'.repeat(6000);
    h.remoteSkill(text);
    const reader = h.runtime.createSession({
      taskId: 'remote-reader',
      role: 'tester',
      allowWrites: false,
      project: h.root,
      plugins: h.manager,
    });
    try {
      const capabilities = await h.manager.capabilities(h.root, h.pluginId, signal);
      const skill = capabilities.skills[0];
      expect(skill).toMatchObject({ state: 'unverified', resourcesAvailable: false });
      const response = await reader.execute('plugin_skill_read', {
        pluginId: h.pluginId,
        skillId: skill.id,
        remotePluginId: 'untrusted',
      });
      const data = JSON.parse(response.content.find((item) => item.type === 'text')!.text);
      expect(data).toMatchObject({ text, complete: true, origin: 'official_remote' });
      expect(data.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(h.request).toHaveBeenCalledWith('plugin/skill/read', {
        remoteMarketplaceName: 'official-fixture',
        remotePluginId: 'plugin_remote_fixture',
        skillName: 'remote-demo',
      });
      await expect(
        h.manager.readSkill(h.root, h.pluginId, skill.id, signal, { path: '../credentials' }),
      ).rejects.toThrow('no expone');
      expect(
        h.request.mock.calls.filter(([method]) => method === 'plugin/skill/read'),
      ).toHaveLength(1);
      expect(h.runtime.approvals.list()).toEqual([]);
      expect(h.nativeCall).not.toHaveBeenCalled();
    } finally {
      await reader.dispose();
      await h.session.dispose();
    }
  });
  it.each([null, ''])(
    'does not claim complete remote instructions from an unavailable response (%s)',
    async (contents) => {
      const h = await fixture(),
        signal = new AbortController().signal;
      h.installed();
      h.skills([{ name: 'remote-demo', enabled: true }]);
      h.remoteSkill(contents);
      try {
        const skill = (await h.manager.capabilities(h.root, h.pluginId, signal)).skills[0];
        await expect(h.manager.readSkill(h.root, h.pluginId, skill.id, signal)).rejects.toThrow(
          'texto completo',
        );
      } finally {
        await h.session.dispose();
      }
    },
  );
  it('rejects remote instructions when their approved package changes during reading', async () => {
    const h = await fixture(),
      signal = new AbortController().signal;
    h.installed();
    h.skills([{ name: 'remote-demo', enabled: true }]);
    h.remoteSkill('# Changed package', true);
    try {
      const skill = (await h.manager.capabilities(h.root, h.pluginId, signal)).skills[0];
      await expect(h.manager.readSkill(h.root, h.pluginId, skill.id, signal)).rejects.toThrow(
        'cambió',
      );
    } finally {
      await h.session.dispose();
    }
  });
  it('rejects remote installation without an advertised identity, before asking or dispatching', async () => {
    const h = await fixture();
    h.remoteId(undefined);
    try {
      expect(
        (await h.manager.list(h.root, new AbortController().signal)).plugins[0].manageable,
      ).toBe(false);
      await expect(h.session.execute('plugin_install', { pluginId: h.pluginId })).rejects.toThrow(
        'identificador remoto',
      );
      expect(h.runtime.approvals.list()).toEqual([]);
      expect(h.request.mock.calls.some(([method]) => method === 'plugin/install')).toBe(false);
    } finally {
      await h.session.dispose();
    }
  });
  it('invalidates the approved remote identity without changing the managed history identity', async () => {
    const h = await fixture(),
      signal = new AbortController().signal;
    try {
      const proposal = await h.manager.prepare(h.root, h.pluginId, 'install', signal);
      h.remoteId('plugin_remote_replacement');
      expect((await h.manager.list(h.root, signal)).plugins[0].id).toBe(h.pluginId);
      await expect(h.manager.apply(h.root, proposal.id, signal)).rejects.toThrow('han cambiado');
      expect(h.request.mock.calls.some(([method]) => method === 'plugin/install')).toBe(false);
    } finally {
      await h.session.dispose();
    }
  });
  it('announces applications and only supplies connection identities for an installed enabled plugin', async () => {
    const h = await fixture(),
      signal = new AbortController().signal;
    try {
      const before = await h.manager.capabilities(h.root, h.pluginId, signal);
      expect(before.apps[0]).toMatchObject({
        source: 'plugin',
        pluginId: h.pluginId,
        state: 'blocked',
      });
      await expect(h.manager.applicationOffers(h.root, h.pluginId, signal)).rejects.toThrow(
        'instalado y habilitado',
      );
      h.installed();
      expect(await h.manager.applicationOffers(h.root, h.pluginId, signal)).toEqual([
        { id: 'fixture-app', name: 'Fixture' },
      ]);
      const after = await h.manager.capabilities(h.root, h.pluginId, signal);
      expect(after.apps[0].id).not.toBe('fixture-app');
      expect(after.apps[0].state).toBe('unverified');
    } finally {
      await h.session.dispose();
    }
  });
  it('requires a human review before preparing another uncertain installation and never reuses the original proposal', async () => {
    const h = await fixture(),
      root = join(h.root, 'human-review'),
      signal = new AbortController().signal;
    const manager = new OfficialPlugins(join(root, 'plugin-operations'), h.open, h.cache),
      proposal = await manager.prepare(h.root, h.pluginId, 'install', signal);
    h.fail();
    await expect(manager.apply(h.root, proposal.id, signal)).rejects.toThrow('incierto');
    await expect(manager.prepare(h.root, h.pluginId, 'install', signal)).rejects.toThrow(
      'resultado incierto',
    );
    const registry = new OperationReviewRegistry(root),
      [receipt] = await registry.list();
    await registry.acknowledge(receipt.id, 'not_completed');
    const next = await manager.prepare(h.root, h.pluginId, 'install', signal);
    expect(next.id).not.toBe(proposal.id);
    await expect(manager.apply(h.root, proposal.id, signal)).rejects.toThrow('ya se utilizó');
    expect(h.request.mock.calls.filter(([method]) => method === 'plugin/install')).toHaveLength(1);
    await h.session.dispose();
  });
  it.each(['local', 'remote'] as const)(
    'checks installed state without duplicate inventory reads for a %s source',
    async (kind) => {
      const h = await fixture(),
        signal = new AbortController().signal;
      if (kind === 'local') h.localSource();
      const proposal = await h.manager.prepare(h.root, h.pluginId, 'install', signal);
      h.request.mockClear();
      expect((await h.manager.apply(h.root, proposal.id, signal)).status).toBe('verified');
      const lists = h.request.mock.calls.filter(([method]) => method === 'plugin/list');
      expect(lists.map(([, params]) => params?.forceRefetch)).toEqual([true, kind === 'remote']);
      await h.session.dispose();
    },
  );
  it('connects a selected native plugin only after approval and requires a new exact approval for each operation', async () => {
    const h = await fixture();
    h.installed();
    await expect(h.session.execute('plugin_mcp_tools', { pluginId: h.pluginId })).rejects.toThrow(
      'Programador',
    );
    expect(h.nativeOpen).not.toHaveBeenCalled();
    const writer = h.runtime.createSession({
      taskId: 'writer',
      role: 'developer',
      allowWrites: true,
      project: h.root,
      plugins: h.manager,
    });
    const connect = writer.execute('plugin_mcp_tools', { pluginId: h.pluginId });
    await vi.waitFor(() => expect(h.runtime.approvals.list()).toHaveLength(1));
    expect(h.nativeOpen).not.toHaveBeenCalled();
    expect(h.runtime.approvals.list()[0].content).toContain('Hooks desactivados');
    h.runtime.approvals.resolve(h.runtime.approvals.list()[0].id, true);
    const connected = JSON.parse((await connect).content.find((c) => c.type === 'text')!.text) as {
      connectionId: string;
      tools: Array<{ id: string }>;
    };
    expect(h.nativeOpen.mock.calls[0][0].pluginIds).toContain(
      'configured-but-not-catalogued@local',
    );
    const args = {
      connectionId: connected.connectionId,
      toolId: connected.tools[0].id,
      arguments: { message: 'approved' },
    };
    const operation = writer.execute('plugin_mcp_call', args);
    await vi.waitFor(() => expect(h.runtime.approvals.list()).toHaveLength(1));
    expect(h.nativeCall).not.toHaveBeenCalled();
    args.arguments.message = 'changed after request';
    const approval = h.runtime.approvals.list()[0];
    h.runtime.approvals.resolve(approval.id, true);
    expect(JSON.stringify(await operation)).toContain('completed');
    expect(h.nativeCall).toHaveBeenCalledWith('fixture', 'operation', { message: 'approved' });
    expect(h.runtime.approvals.resolve(approval.id, true)).toBe(false);
    const denied = writer.execute('plugin_mcp_call', args);
    await vi.waitFor(() => expect(h.runtime.approvals.list()).toHaveLength(1));
    h.runtime.approvals.resolve(h.runtime.approvals.list()[0].id, false);
    await expect(denied).rejects.toThrow('no fue autorizada');
    expect(h.nativeCall).toHaveBeenCalledTimes(1);
    await writer.dispose();
    expect(h.nativeClose).toHaveBeenCalledTimes(1);
    await h.session.dispose();
  });
  it('loads complete local skill instructions and relative resources for a reader without executing anything', async () => {
    const h = await fixture(),
      signal = new AbortController().signal;
    const directory = join(h.cache, 'official-fixture', 'fixture', '1', 'skills', 'demo');
    await mkdir(join(directory, 'references'), { recursive: true });
    const text = '# Skill completa\n' + 'á🙂 referencia\n'.repeat(6000);
    await writeFile(join(directory, 'SKILL.md'), text);
    await writeFile(join(directory, 'references', 'guide.md'), 'Referencia completa');
    await writeFile(join(directory, '.env'), 'PRIVATE_FIXTURE');
    h.installed();
    h.skills([
      {
        name: 'demo',
        description: 'Instrucciones',
        enabled: true,
        path: join(directory, 'SKILL.md'),
      },
    ]);
    const capabilities = await h.manager.capabilities(h.root, h.pluginId, signal);
    expect(JSON.stringify(capabilities)).not.toContain(directory);
    expect(capabilities.mcpServers[0].state).toBe('unverified');
    const skillId = capabilities.skills[0].id;
    const session = h.runtime.createSession({
      taskId: 'tester',
      role: 'tester',
      allowWrites: false,
      project: h.root,
      plugins: h.manager,
    });
    try {
      const response = JSON.stringify(
        await session.execute('plugin_skill_read', { pluginId: h.pluginId, skillId }),
      );
      expect(response).toContain('Skill completa');
      const loaded = await h.manager.readSkill(h.root, h.pluginId, skillId, signal);
      expect(loaded).toMatchObject({ text, complete: true });
      expect(
        await h.manager.readSkill(h.root, h.pluginId, skillId, signal, {
          path: 'references/guide.md',
        }),
      ).toMatchObject({ text: 'Referencia completa', eof: true });
      await expect(
        h.manager.readSkill(h.root, h.pluginId, skillId, signal, { path: '.env' }),
      ).rejects.toThrow('fuera');
      await expect(
        h.manager.readSkill(h.root, h.pluginId, skillId, signal, { path: '../SKILL.md' }),
      ).rejects.toThrow('fuera');
      expect(h.request.mock.calls.every(([m]) => ['plugin/list', 'plugin/read'].includes(m))).toBe(
        true,
      );
      expect(h.runtime.approvals.list()).toEqual([]);
    } finally {
      await session.dispose();
      await h.session.dispose();
    }
  });
  it('rejects disabled skills, fabricated identities and paths outside their installed plugin', async () => {
    const h = await fixture(),
      signal = new AbortController().signal;
    const directory = join(h.cache, 'official-fixture', 'fixture', '1');
    await mkdir(directory, { recursive: true });
    await writeFile(join(h.root, 'SKILL.md'), 'OUTSIDE_FIXTURE');
    h.skills([{ name: 'demo', enabled: true, path: join(h.root, 'SKILL.md') }]);
    let skillId = (await h.manager.capabilities(h.root, h.pluginId, signal)).skills[0].id;
    await expect(h.manager.readSkill(h.root, h.pluginId, skillId, signal)).rejects.toThrow(
      'instalado',
    );
    h.installed();
    await expect(h.manager.readSkill(h.root, h.pluginId, skillId, signal)).rejects.toThrow('fuera');
    await expect(h.manager.readSkill(h.root, h.pluginId, 'fabricated', signal)).rejects.toThrow(
      'no está habilitada',
    );
    h.skills([{ name: 'demo', enabled: false, path: join(directory, 'SKILL.md') }]);
    skillId = (await h.manager.capabilities(h.root, h.pluginId, signal)).skills[0].id;
    await expect(h.manager.readSkill(h.root, h.pluginId, skillId, signal)).rejects.toThrow(
      'no está habilitada',
    );
    await h.session.dispose();
  });
  it('reads a bundled skill only from the exact official staging package and reports that origin', async () => {
    const h = await fixture(),
      signal = new AbortController().signal;
    const directory = join(
      h.root,
      '.tmp',
      'bundled-marketplaces',
      'official-fixture',
      'plugins',
      'fixture',
      'skills',
      'demo',
    );
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'SKILL.md'), 'BUNDLED_SKILL');
    h.installed();
    h.skills([{ name: 'demo', enabled: true, path: join(directory, 'SKILL.md') }]);
    const skillId = (await h.manager.capabilities(h.root, h.pluginId, signal)).skills[0].id;
    expect(await h.manager.readSkill(h.root, h.pluginId, skillId, signal)).toMatchObject({
      text: 'BUNDLED_SKILL',
      complete: true,
      origin: 'official_bundled_source',
    });
    await h.session.dispose();
  });
  it('rejects an installed package root redirected outside the cache', async () => {
    const h = await fixture(),
      signal = new AbortController().signal;
    const outside = join(h.root, 'outside'),
      market = join(h.cache, 'official-fixture');
    await mkdir(outside, { recursive: true });
    await mkdir(market, { recursive: true });
    await writeFile(join(outside, 'SKILL.md'), 'OUTSIDE_FIXTURE');
    await symlink(outside, join(market, 'fixture'), 'junction');
    h.installed();
    h.skills([{ name: 'demo', enabled: true, path: join(market, 'fixture', 'SKILL.md') }]);
    const skillId = (await h.manager.capabilities(h.root, h.pluginId, signal)).skills[0].id;
    await expect(h.manager.readSkill(h.root, h.pluginId, skillId, signal)).rejects.toThrow(
      'enlaces',
    );
    await h.session.dispose();
  });
  it('rejects a skill when its plugin changes during the read and never returns stale content', async () => {
    const h = await fixture(),
      signal = new AbortController().signal;
    const directory = join(h.cache, 'official-fixture', 'fixture', '1');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'SKILL.md'), 'VERSION_ONE');
    h.installed();
    h.skills([{ name: 'demo', enabled: true, path: join(directory, 'SKILL.md') }]);
    const skillId = (await h.manager.capabilities(h.root, h.pluginId, signal)).skills[0].id;
    const original = h.request.getMockImplementation()!;
    let reads = 0;
    h.request.mockImplementation(async (method, params) => {
      if (method === 'plugin/read' && ++reads === 2) h.version();
      return original(method, params);
    });
    await expect(h.manager.readSkill(h.root, h.pluginId, skillId, signal)).rejects.toThrow(
      'cambió',
    );
    await expect(
      h.manager.readSkill(h.root, h.pluginId, skillId, AbortSignal.abort()),
    ).rejects.toThrow('cancelado');
    await h.session.dispose();
  });
  it('supports search and pagination without pretending a page is the complete catalogue', async () => {
    const h = await fixture(),
      signal = new AbortController().signal;
    expect(await h.manager.list(h.root, signal, 'FIXTURE', 0, 1)).toMatchObject({
      total: 1,
      catalogueTotal: 1,
      nextOffset: null,
    });
    expect((await h.manager.list(h.root, signal, 'unavailable')).plugins).toEqual([]);
    expect((await h.manager.list(h.root, signal, '', 1, 1)).plugins).toEqual([]);
    await expect(h.manager.list(h.root, signal, '', -1, 1)).rejects.toThrow('desplazamiento');
    await h.session.dispose();
  });
  it('shows duplicate conflicts without treating the catalogue as empty or permitting mutation', async () => {
    const h = await fixture();
    h.duplicate();
    const catalogue = await h.manager.list(h.root, new AbortController().signal);
    expect(catalogue.plugins).toHaveLength(1);
    expect(catalogue.plugins[0].manageable).toBe(false);
    await expect(
      h.manager.prepare(h.root, h.pluginId, 'install', new AbortController().signal),
    ).rejects.toThrow('ambiguos');
    await h.session.dispose();
  });
  it('binds installation to approved source and verifies without granting future actions', async () => {
    const h = await fixture();
    const pending = h.session.execute('plugin_install', {
      pluginId: h.pluginId,
      marketplacePath: 'C:/untrusted',
      command: 'arbitrary',
    });
    await vi.waitFor(() => expect(h.runtime.approvals.list()).toHaveLength(1));
    expect(h.request.mock.calls.some(([m]) => m === 'plugin/install')).toBe(false);
    const approval = h.runtime.approvals.list()[0];
    expect(approval.content).toContain('official-fixture');
    h.runtime.approvals.resolve(approval.id, true);
    expect(JSON.stringify(await pending)).toContain('verified');
    expect(h.request).toHaveBeenCalledWith(
      'plugin/install',
      expect.objectContaining({
        pluginName: 'plugin_remote_fixture',
        remoteMarketplaceName: 'official-fixture',
      }),
    );
    expect(JSON.stringify(h.request.mock.calls)).not.toContain('untrusted');
    expect(h.runtime.approvals.resolve(approval.id, true)).toBe(false);
    await h.session.dispose();
  });
  it('invalidates a proposal if the version changes before approval', async () => {
    const h = await fixture();
    const pending = h.session.execute('plugin_install', { pluginId: h.pluginId });
    const rejected = expect(pending).rejects.toThrow('han cambiado');
    await vi.waitFor(() => expect(h.runtime.approvals.list()).toHaveLength(1));
    h.version();
    h.runtime.approvals.resolve(h.runtime.approvals.list()[0].id, true);
    await rejected;
    expect(h.request.mock.calls.some(([m]) => m === 'plugin/install')).toBe(false);
    await h.session.dispose();
  });
  it('keeps uncertain dispatches spent across restart and never retries', async () => {
    const h = await fixture();
    const signal = new AbortController().signal;
    const proposal = await h.manager.prepare(h.root, h.pluginId, 'install', signal);
    h.fail();
    await expect(h.manager.apply(h.root, proposal.id, signal)).rejects.toThrow('incierto');
    const receipt = JSON.parse(await readFile(join(h.root, proposal.id + '.json'), 'utf8'));
    expect(receipt.status).toBe('review_required');
    const restored = new OfficialPlugins(h.root, h.open);
    expect(await restored.operations()).toEqual([
      expect.objectContaining({ id: proposal.id, status: 'review_required' }),
    ]);
    await expect(restored.apply(h.root, proposal.id, signal)).rejects.toThrow('ya se utilizó');
    expect(h.request.mock.calls.filter(([m]) => m === 'plugin/install')).toHaveLength(1);
    await h.session.dispose();
  });
  it('preserves safe failure diagnostics without storing provider payloads or retrying', async () => {
    const h = await fixture(),
      signal = new AbortController().signal;
    const proposal = await h.manager.prepare(h.root, h.pluginId, 'install', signal);
    const original = h.request.getMockImplementation()!;
    h.request.mockImplementation(async (method, params) => {
      if (method === 'plugin/install')
        throw new ExecutionBlocked('app_server_disconnected', 'PRIVATE_PROVIDER_PAYLOAD');
      return original(method, params);
    });
    await expect(h.manager.apply(h.root, proposal.id, signal)).rejects.toThrow('incierto');
    const serialized = await readFile(join(h.root, proposal.id + '.json'), 'utf8');
    expect(JSON.parse(serialized)).toMatchObject({
      status: 'review_required',
      failureCode: 'app_server_disconnected',
      failureStage: 'request',
      updatedAt: expect.any(Number),
    });
    expect(serialized).not.toContain('PRIVATE_PROVIDER_PAYLOAD');
    await expect(h.manager.prepare(h.root, h.pluginId, 'install', signal)).rejects.toThrow();
    expect(h.request.mock.calls.filter(([method]) => method === 'plugin/install')).toHaveLength(1);
    await h.session.dispose();
  });
  it.each(['local', 'remote'])(
    'verifies removal of a %s plugin with the correct native identity',
    async (kind) => {
      const h = await fixture(),
        signal = new AbortController().signal;
      if (kind === 'local') h.localSource();
      const install = await h.manager.prepare(h.root, h.pluginId, 'install', signal);
      await h.manager.apply(h.root, install.id, signal);
      const remove = await h.manager.prepare(h.root, h.pluginId, 'uninstall', signal);
      expect(await h.manager.apply(h.root, remove.id, signal)).toMatchObject({
        status: 'verified',
        plugin: { id: h.pluginId, installed: false },
      });
      expect(h.request).toHaveBeenCalledWith('plugin/uninstall', {
        pluginId: kind === 'remote' ? 'plugin_remote_fixture' : 'plugin-id',
      });
      await h.session.dispose();
    },
  );
  it('rejects missing IDs, incomplete catalogues and proposal paths', async () => {
    const h = await fixture(),
      signal = new AbortController().signal;
    await expect(h.manager.prepare(h.root, 'nonexistent', 'install', signal)).rejects.toThrow(
      'no aparece',
    );
    await expect(h.manager.apply(h.root, '../elsewhere', signal)).rejects.toThrow('no es válida');
    h.incomplete();
    await expect(h.manager.prepare(h.root, h.pluginId, 'install', signal)).rejects.toThrow(
      'comprobar completo',
    );
    await h.session.dispose();
  });
  it('does not install after denying or cancelling the request', async () => {
    const h = await fixture();
    const pending = h.session.execute('plugin_install', { pluginId: h.pluginId });
    const rejected = expect(pending).rejects.toThrow('detenido');
    await vi.waitFor(() => expect(h.runtime.approvals.list()).toHaveLength(1));
    await h.session.dispose();
    await rejected;
    expect(h.request.mock.calls.some(([m]) => m === 'plugin/install')).toBe(false);
  });
});
