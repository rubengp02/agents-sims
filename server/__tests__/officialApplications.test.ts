import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { applicationUrl, OfficialApplications } from '../src/tools/officialApplications.js';
import { OfficialAuthentication } from '../src/tools/officialAuthentication.js';
import { OfficeToolRuntime } from '../src/tools/toolRuntime.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'office-apps-'));
  roots.push(root);
  let connected = false,
    url = 'https://chatgpt.com/apps/fixture/app-fixture';
  const list = vi.fn(async () => ({
    data: [{ id: 'app-fixture', name: 'Fixture', installUrl: url, isAccessible: true }],
    nextCursor: null,
  }));
  const installed = vi.fn(async () => ({
    apps: [{ id: 'app-fixture', runtimeName: 'Fixture', enabled: connected, callable: connected }],
  }));
  const read = vi.fn(async () => ({
    apps: [{ id: 'app-fixture', name: 'Fixture', installUrl: url, secret: 'DO_NOT_RETURN' }],
    missingAppIds: [],
  }));
  const open = vi.fn(async () => ({ list, read, installed, close: async () => {} }));
  const apps = new OfficialApplications(open),
    auth = new OfficialAuthentication(root);
  await auth.initialize();
  const runtime = new OfficeToolRuntime({ stateDir: root, authentications: auth });
  const session = runtime.createSession({
    taskId: 'task',
    role: 'chief',
    project: root,
    applications: apps,
  });
  const id = (await apps.list(new AbortController().signal)).apps[0].id;
  return {
    root,
    apps,
    auth,
    runtime,
    session,
    id,
    list,
    read,
    installed,
    connect: () => {
      connected = true;
    },
    change: () => {
      url = 'https://chatgpt.com/apps/changed/app-fixture';
    },
  };
}

it('keeps installed runtime distinct from a denied directory and only reads announced app identities', async () => {
  const h = await fixture(),
    signal = new AbortController().signal;
  try {
    h.list.mockRejectedValue(new Error('403'));
    await expect(h.apps.list(signal)).rejects.toThrow('403');
    const result = await h.apps.installed(signal);
    expect(result).toMatchObject({
      source: 'installed',
      apps: [{ id: h.id, enabled: false, callable: false }],
    });
    expect(await h.apps.prepare(h.id, signal, 'installed')).toMatchObject({
      nativeId: 'app-fixture',
      source: 'installed',
    });
    const calls = h.read.mock.calls.length;
    await expect(h.apps.prepare('guessed-id', signal, 'installed')).rejects.toThrow('no aparece');
    expect(h.read).toHaveBeenCalledTimes(calls);
    expect(JSON.stringify(result)).not.toContain('DO_NOT_RETURN');
  } finally {
    await h.session.dispose();
  }
});
it('reads plugin-announced identities without substituting a denied directory or accepting guessed apps', async () => {
  const h = await fixture(),
    signal = new AbortController().signal;
  try {
    h.list.mockRejectedValue(new Error('403'));
    const offered = [{ id: 'app-fixture', name: 'Fixture' }];
    expect(await h.apps.prepare(h.id, signal, 'plugin', offered)).toMatchObject({
      source: 'plugin',
      nativeId: 'app-fixture',
    });
    await expect(h.apps.prepare(h.id, signal, 'plugin')).rejects.toThrow('Falta comprobar');
    await expect(h.apps.prepare('guessed', signal, 'plugin', offered)).rejects.toThrow(
      'no aparece',
    );
  } finally {
    await h.session.dispose();
  }
});

it('waits for approval and a fresh official callable state, never accepting human assertion alone', async () => {
  const h = await fixture();
  try {
    const pending = h.session.execute('app_connect', { appId: h.id });
    await vi.waitFor(() => expect(h.runtime.approvals.list()).toHaveLength(1));
    expect(h.auth.list()).toHaveLength(0);
    h.runtime.approvals.resolve(h.runtime.approvals.list()[0].id, true);
    await vi.waitFor(() =>
      expect(h.auth.list()[0]?.authorizationUrl).toContain('chatgpt.com/apps/'),
    );
    const entry = h.auth.list()[0];
    expect(entry.kind).toBe('application');
    h.connect();
    expect(await h.auth.checkApplication(entry.id)).toBe(true);
    await pending;
    expect(h.auth.list()[0]).toMatchObject({ status: 'authenticated' });
    expect(h.auth.list()[0].authorizationUrl).toBeUndefined();
    const saved = await readFile(join(h.root, entry.id + '.json'), 'utf8');
    expect(saved).not.toContain('https://');
    expect(saved).not.toContain('DO_NOT_RETURN');
    const restored = new OfficialAuthentication(h.root);
    await restored.initialize();
    expect(restored.list()[0].status).toBe('authenticated');
    expect(await restored.checkApplication(entry.id)).toBe(false);
    expect(h.installed).toHaveBeenCalledWith(true);
  } finally {
    await h.session.dispose();
  }
});

it('ends a non-callable hosted check without asking the user to sign in repeatedly', async () => {
  const h = await fixture();
  try {
    const pending = h.session.execute('app_connect', { appId: h.id });
    await vi.waitFor(() => expect(h.runtime.approvals.list()).toHaveLength(1));
    h.runtime.approvals.resolve(h.runtime.approvals.list()[0].id, true);
    await vi.waitFor(() => expect(h.auth.list()[0]?.authorizationUrl).toBeTruthy());
    const id = h.auth.list()[0].id;
    expect(await h.auth.checkApplication(id)).toBe(false);
    await pending;
    expect(h.auth.list()[0]).toMatchObject({ status: 'failed' });
    expect(h.auth.list()[0].reason).toContain('No necesitas repetir');
    expect(h.auth.list()[0].authorizationUrl).toBeUndefined();
    expect(await h.auth.checkApplication(id)).toBe(false);
    const restored = new OfficialAuthentication(h.root);
    await restored.initialize();
    expect(restored.list()[0].status).toBe('failed');
  } finally {
    await h.session.dispose();
  }
});

it('skips repeated sign-in for an already callable app without authorizing operations', async () => {
  const h = await fixture();
  try {
    h.connect();
    const result = await h.session.execute('app_connect', { appId: h.id, source: 'installed' });
    expect(JSON.stringify(result)).toContain('no hace falta repetir');
    expect(h.runtime.approvals.list()).toHaveLength(0);
    expect(h.auth.list()).toHaveLength(0);
  } finally {
    await h.session.dispose();
  }
});

it('rejects changed connection data after approval and never opens its link', async () => {
  const h = await fixture();
  try {
    const pending = h.session.execute('app_connect', { appId: h.id });
    const rejected = expect(pending).rejects.toThrow('cambió desde la propuesta');
    await vi.waitFor(() => expect(h.runtime.approvals.list()).toHaveLength(1));
    h.change();
    h.runtime.approvals.resolve(h.runtime.approvals.list()[0].id, true);
    await rejected;
    expect(h.auth.list()).toHaveLength(0);
  } finally {
    await h.session.dispose();
  }
});

it('cancels pending hosted authentication on session disposal and preserves a public receipt', async () => {
  const h = await fixture();
  const pending = h.session.execute('app_connect', { appId: h.id });
  await vi.waitFor(() => expect(h.runtime.approvals.list()).toHaveLength(1));
  h.runtime.approvals.resolve(h.runtime.approvals.list()[0].id, true);
  await vi.waitFor(() => expect(h.auth.list()).toHaveLength(1));
  await h.session.dispose();
  await pending;
  expect(h.auth.list()[0].status).toBe('cancelled');
  expect(await h.auth.checkApplication(h.auth.list()[0].id)).toBe(false);
  expect(await readFile(join(h.root, h.auth.list()[0].id + '.json'), 'utf8')).not.toContain(
    'https://',
  );
});

it('restores an interrupted hosted connection as cancelled without reopening or continuing it', async () => {
  const h = await fixture();
  try {
    const pending = h.session.execute('app_connect', { appId: h.id });
    await vi.waitFor(() => expect(h.runtime.approvals.list()).toHaveLength(1));
    h.runtime.approvals.resolve(h.runtime.approvals.list()[0].id, true);
    await vi.waitFor(() => expect(h.auth.list()[0]?.authorizationUrl).toBeTruthy());
    const restored = new OfficialAuthentication(h.root);
    await restored.initialize();
    expect(restored.list()[0]).toMatchObject({ kind: 'application', status: 'cancelled' });
    expect(restored.list()[0].authorizationUrl).toBeUndefined();
    await h.session.dispose();
    await pending;
  } finally {
    await h.session.dispose();
  }
});

it.each([
  'https://example.com/apps/fixture/app',
  'https://user:secret@chatgpt.com/apps/fixture/app',
  'https://chatgpt.com/apps/fixture/app?token=secret',
  'https://chatgpt.com/redirect',
  'http://chatgpt.com/apps/fixture/app',
])('rejects noncanonical or credential-bearing app links: %s', (url) => {
  expect(() => applicationUrl(url)).toThrow();
});
