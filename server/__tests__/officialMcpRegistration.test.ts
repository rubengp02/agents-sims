import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type ManagedMcpRegistrationClient,
  managedMcpTarget,
  OfficialMcpRegistration,
} from '../src/tools/officialMcpRegistration.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'office-mcp-registration-'));
  roots.push(root);
  let exists = false,
    matches = false,
    version = 'v1';
  const inspect = vi.fn<ManagedMcpRegistrationClient['inspect']>(async () => ({
    exists,
    matches,
    version,
    file: join(root, 'isolated-config.toml'),
  }));
  const register = vi.fn<ManagedMcpRegistrationClient['register']>(async () => {
    exists = true;
    matches = true;
    version = 'v2';
  });
  const close = vi.fn(async () => {}),
    open = vi.fn(async () => ({ inspect, register, close }));
  const manager = new OfficialMcpRegistration(join(root, 'mcp-registrations'), open);
  const connection = {
    id: 'connection-fixture',
    name: 'Fixture service',
    url: 'https://office-fixture.invalid/mcp',
  };
  return {
    root,
    manager,
    open,
    inspect,
    register,
    close,
    connection,
    signal: new AbortController().signal,
    change: () => {
      version = 'other-version';
    },
    existing: (match: boolean) => {
      exists = true;
      matches = match;
    },
  };
}
describe('official MCP registration (simulated configuration RPC, no provider access)', () => {
  it('prepares public data without writing, then verifies the registration from a new client', async () => {
    const h = await fixture(),
      proposal = await h.manager.prepare(h.connection, h.signal);
    expect(h.register).not.toHaveBeenCalled();
    expect(JSON.stringify(proposal)).not.toContain('isolated-config.toml');
    expect(await h.manager.apply(proposal.id, h.signal)).toMatchObject({ status: 'registered' });
    expect(h.register).toHaveBeenCalledTimes(1);
    expect(h.open).toHaveBeenCalledTimes(3);
    expect(h.close).toHaveBeenCalledTimes(3);
    await expect(h.manager.apply(proposal.id, h.signal)).rejects.toThrow('ya terminó');
  });
  it('never overwrites a competing entry or a changed configuration version', async () => {
    const h = await fixture(),
      proposal = await h.manager.prepare(h.connection, h.signal);
    h.change();
    await expect(h.manager.apply(proposal.id, h.signal)).rejects.toThrow('cambió');
    expect(h.register).not.toHaveBeenCalled();
    h.existing(false);
    await expect(h.manager.prepare(h.connection, h.signal)).rejects.toThrow('sobrescribirá');
  });
  it('reuses an existing matching registration without sending a write or claiming authentication', async () => {
    const h = await fixture();
    h.existing(true);
    const proposal = await h.manager.prepare(h.connection, h.signal);
    expect(proposal.alreadyRegistered).toBe(true);
    expect((await h.manager.operations())[0]).toMatchObject({ status: 'registered' });
    expect(h.register).not.toHaveBeenCalled();
    expect(proposal.preview.scope).toContain('No inicia sesión');
  });
  it('retains an uncertain write and blocks a fresh proposal after restart instead of replaying it', async () => {
    const h = await fixture(),
      proposal = await h.manager.prepare(h.connection, h.signal);
    h.register.mockRejectedValueOnce(new Error('PRIVATE backend failure'));
    await expect(h.manager.apply(proposal.id, h.signal)).rejects.toThrow('No se pudo confirmar');
    const restored = new OfficialMcpRegistration(join(h.root, 'mcp-registrations'), h.open);
    expect(JSON.stringify(await restored.operations())).not.toContain('PRIVATE');
    await expect(restored.prepare(h.connection, h.signal)).rejects.toThrow('resultado incierto');
    expect(h.register).toHaveBeenCalledTimes(1);
  });
  it('rejects credential-bearing, local and insecure URLs and generates the server name deterministically', () => {
    for (const url of [
      'http://example.com',
      'https://user:secret@example.com',
      'https://example.com/?token=secret',
      'https://127.0.0.1/mcp',
      'https://localhost./mcp',
      'https://[::1]/mcp',
    ])
      expect(() => managedMcpTarget(url)).toThrow();
    expect(managedMcpTarget('https://example.com/mcp')).toEqual(
      managedMcpTarget('https://example.com/mcp'),
    );
    expect(managedMcpTarget('https://example.com/mcp').name).toMatch(
      /^office-managed-[a-f0-9]{24}$/,
    );
  });
});
