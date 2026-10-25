import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';

import { DisabledExecutor } from '../src/execution/optionalExecutors.js';
import { TeamCoordinator } from '../src/execution/teamCoordinator.js';
import type { OfficialExecutor } from '../src/execution/types.js';
import { OfficeServices } from '../src/tools/officeServices.js';
import { managedMcpTarget } from '../src/tools/officialMcpRegistration.js';

it('recognizes the managed adapter without enabling unknown or disabled servers or claiming verified operations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'office-managed-discovery-'));
  const services = new OfficeServices(root, join(root, 'host'));
  await services.initialize();
  const entry = await services.connections.remember('Mi servicio', 'https://example.com/mcp');
  const target = managedMcpTarget(entry.url);
  await services.connections.adoptOfficial(entry.id, target.name);
  const open = vi.fn(async () => {
    throw Error('discovery must not execute');
  });
  const executor: OfficialExecutor & {
    discoverTools: () => Promise<
      import('../src/execution/codexAppServerExecutor.js').AppServerToolDiscovery
    >;
  } = {
    provider: 'codex',
    engine: 'codex-app-server',
    diagnose: async () => {
      throw Error('no inference or quota request');
    },
    execute: async () => {
      throw Error('no model');
    },
    openManagedMcp: open,
    discoverTools: async () => ({
      checkedAt: Date.now(),
      cliVersion: 'fixture',
      apps: { verified: false, items: [], errorCode: 'app_server_access_challenge' },
      skills: { verified: true, items: [] },
      mcp: {
        verified: true,
        items: [
          { name: target.name, authStatus: 'oAuth', tools: 3 },
          { name: 'unknown', authStatus: 'oAuth', tools: 2 },
        ],
      },
    }),
  };
  const team = new TeamCoordinator(
    { codex: executor, claude: new DisabledExecutor('claude') },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    services,
  );
  try {
    await team.refreshTools();
    const adapted = services.capabilities().find((c) => c.id === `mcp:${target.name}`)!;
    expect(adapted).toMatchObject({ name: 'Conexión: Mi servicio', state: 'unverified' });
    expect(adapted.reason).toContain('connection_check');
    expect(adapted.reason).toContain('connection_call con aprobación específica');
    expect(adapted.reason).not.toContain('falta un adaptador');
    expect(services.capabilities().find((c) => c.id === 'mcp:unknown')?.state).toBe('blocked');
    await services.connections.disable(entry.id);
    await team.refreshTools();
    expect(services.capabilities().find((c) => c.id === `mcp:${target.name}`)).toMatchObject({
      state: 'blocked',
      reason: expect.stringContaining('desactivado'),
    });
    expect(open).not.toHaveBeenCalled();
    await services.connections.adoptOfficial(entry.id, target.name);
    delete executor.openManagedMcp;
    await team.refreshTools();
    expect(services.capabilities().find((c) => c.id === `mcp:${target.name}`)).toMatchObject({
      state: 'blocked',
      reason: expect.stringContaining('falta un adaptador'),
    });
  } finally {
    await team.shutdown();
    await services.close();
    await rm(root, { recursive: true, force: true });
  }
});
