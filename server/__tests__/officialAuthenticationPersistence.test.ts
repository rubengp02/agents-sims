import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';

import { OfficialApplications } from '../src/tools/officialApplications.js';
import { OfficialAuthentication } from '../src/tools/officialAuthentication.js';

const disk = vi.hoisted(() => ({ root: '', active: new Set<string>(), overlaps: 0 }));
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>();
  return {
    ...fs,
    rename: async (from: string, to: string) => {
      if (!disk.root || !to.startsWith(disk.root)) return fs.rename(from, to);
      if (disk.active.has(to)) {
        disk.overlaps++;
        throw Object.assign(new Error('Simulated Windows sharing conflict'), { code: 'EBUSY' });
      }
      disk.active.add(to);
      try {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return await fs.rename(from, to);
      } finally {
        disk.active.delete(to);
      }
    },
  };
});

it('persists a successful application check even while its initial receipt is being published', async () => {
  const root = await mkdtemp(join(tmpdir(), 'office-auth-persistence-'));
  disk.root = root;
  disk.overlaps = 0;
  const auth = new OfficialAuthentication(root);
  const apps = new OfficialApplications(async () => ({
    list: async () => ({ data: [] }),
    read: async () => ({ apps: [] }),
    installed: async () => ({ apps: [{ id: 'fixture', enabled: true, callable: true }] }),
    close: async () => {},
  }));
  await auth.initialize();
  const pending = auth.connectApplication(
    apps,
    {
      id: 'fixture-id',
      nativeId: 'fixture',
      name: 'Fixture',
      source: 'installed',
      fingerprint: 'fixture',
      url: 'https://chatgpt.com/apps/fixture/fixture',
    },
    'fixture-task',
    new AbortController().signal,
  );
  const settled = pending.catch((error: unknown) => error);
  try {
    await vi.waitFor(() => expect(disk.active.size).toBe(1));
    const id = auth.list()[0].id;
    expect(await auth.checkApplication(id)).toBe(true);
    expect(await settled).toMatchObject({ status: 'authenticated' });
    expect(disk.overlaps).toBe(0);
    const saved = JSON.parse(await readFile(join(root, id + '.json'), 'utf8'));
    expect(saved.status).toBe('authenticated');
    expect(saved.authorizationUrl).toBeUndefined();
    const restored = new OfficialAuthentication(root);
    await restored.initialize();
    expect(restored.list()[0].status).toBe('authenticated');
  } finally {
    auth.close();
    await settled;
    disk.root = '';
    await rm(root, { recursive: true, force: true });
  }
});
