import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type AuthenticationClient,
  authorizationUrl,
  OfficialAuthentication,
} from '../src/tools/officialAuthentication.js';
import { OfficeToolRuntime } from '../src/tools/toolRuntime.js';

const roots: string[] = [];
const disposals: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of disposals.splice(0).reverse()) await close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(timeout = 5000) {
  const root = await mkdtemp(join(tmpdir(), 'office-auth-'));
  roots.push(root);
  let status = 'notLoggedIn',
    persistLogin = false,
    early = false;
  const listeners = new Set<(m: string, p: Record<string, unknown>) => void>();
  const disconnects = new Set<() => void>();
  const event = (p: Record<string, unknown>) => {
    if (p.success === true && p.loginId === 'login-1' && p.name === 'fixture' && persistLogin)
      status = 'oAuth';
    for (const notify of listeners) notify('mcpServer/oauthLogin/completed', p);
  };
  const request = vi.fn<AuthenticationClient['request']>(async (method) => {
    if (method === 'mcpServerStatus/list')
      return { data: [{ name: 'fixture', authStatus: status }], nextCursor: null };
    if (method === 'mcpServer/oauth/login') {
      if (early) event({ name: 'fixture', loginId: 'login-1', success: true });
      return {
        authorizationUrl: 'https://provider.example/authorize?state=TRANSIENT_STATE',
        loginId: 'login-1',
      };
    }
    throw new Error('unsupported');
  });
  const close = vi.fn(async () => {});
  const logout = vi.fn(async () => {
    status = 'notLoggedIn';
  });
  const open = async () => ({
    logout,
    request,
    onNotification: (f: (m: string, p: Record<string, unknown>) => void) => {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
    onDisconnect: (f: () => void) => {
      disconnects.add(f);
      return () => {
        disconnects.delete(f);
      };
    },
    close,
  });
  const manager = new OfficialAuthentication(root, timeout);
  await manager.initialize();
  const id = (await manager.describe(open, new AbortController().signal)).servers[0].id;
  disposals.push(async () => {
    manager.close();
  });
  return {
    root,
    manager,
    id,
    request,
    open,
    close,
    logout,
    event,
    accept: () => {
      persistLogin = true;
    },
    early: () => {
      early = true;
      persistLogin = true;
    },
    status: (s: string) => {
      status = s;
    },
    disconnect: () => {
      for (const f of disconnects) f();
    },
  };
}
describe('official OAuth lifecycle (RPC fixtures, no credentials)', () => {
  it('classifies an abort as cancellation even when the transport disconnect listener runs first', async () => {
    const h = await fixture(),
      controller = new AbortController();
    controller.signal.addEventListener('abort', h.disconnect);
    const pending = h.manager.login(h.open, h.id, 'task', controller.signal);
    await vi.waitFor(() => expect(h.manager.list()[0]?.authorizationUrl).toBeTruthy());
    controller.abort();
    expect((await pending).status).toBe('cancelled');
    expect(h.manager.list()[0].reason).not.toContain('interrumpió');
  });
  it('approves a local OAuth logout, verifies with a new connection and retains its receipt', async () => {
    const h = await fixture();
    h.status('oAuth');
    const runtime = new OfficeToolRuntime({ stateDir: h.root, authentications: h.manager });
    const session = runtime.createSession({
      taskId: 'chief',
      role: 'chief',
      project: h.root,
      authenticationProvider: h.open,
    });
    disposals.push(() => session.dispose());
    const pending = session.execute('auth_disconnect', { serverId: h.id });
    await vi.waitFor(() => expect(runtime.approvals.list()).toHaveLength(1));
    expect(h.logout).not.toHaveBeenCalled();
    expect(runtime.approvals.list()[0].content).toContain('No cierra tu cuenta de ChatGPT');
    runtime.approvals.resolve(runtime.approvals.list()[0].id, true);
    expect(JSON.stringify(await pending)).toContain('signed_out');
    expect(h.logout).toHaveBeenCalledExactlyOnceWith('fixture');
    const restored = new OfficialAuthentication(h.root);
    await restored.initialize();
    expect(await restored.disconnectOperations()).toMatchObject([
      { service: 'fixture', status: 'signed_out' },
    ]);
    expect(h.logout).toHaveBeenCalledTimes(1);
  });
  it('blocks retry after an uncertain logout and recovers by checking state without resending', async () => {
    const h = await fixture(),
      signal = new AbortController().signal;
    h.status('oAuth');
    h.logout.mockRejectedValueOnce(new Error('provider diagnostic SECRET'));
    const receipt = await h.manager.disconnect(h.open, h.id, 'task', signal);
    expect(receipt.status).toBe('review_required');
    expect(JSON.stringify(receipt)).not.toContain('SECRET');
    const restored = new OfficialAuthentication(h.root);
    await restored.initialize();
    await expect(restored.disconnect(h.open, h.id, 'task', signal)).rejects.toThrow(
      'resultado incierto',
    );
    expect((await restored.checkDisconnect(h.open, receipt.id, signal)).status).toBe(
      'review_required',
    );
    h.status('notLoggedIn');
    expect((await restored.checkDisconnect(h.open, receipt.id, signal)).status).toBe('signed_out');
    expect(h.logout).toHaveBeenCalledTimes(1);
  });
  it('does not accept bridge bearer tokens or cancelled logout attempts', async () => {
    const h = await fixture();
    h.status('bearerToken');
    await expect(
      h.manager.disconnect(h.open, h.id, 'task', new AbortController().signal),
    ).rejects.toThrow('no expone');
    h.status('oAuth');
    expect((await h.manager.disconnect(h.open, h.id, 'task', AbortSignal.abort())).status).toBe(
      'failed',
    );
    expect(h.logout).not.toHaveBeenCalled();
  });
  it('does not create competing authorizations for the same registered service', async () => {
    const h = await fixture(),
      signal = new AbortController().signal;
    const pending = h.manager.login(h.open, h.id, 'first-task', signal);
    await vi.waitFor(() => expect(h.manager.list()[0]?.authorizationUrl).toBeTruthy());
    await expect(h.manager.login(h.open, h.id, 'second-task', signal)).rejects.toThrow('ya tiene');
    expect(h.request.mock.calls.filter(([m]) => m === 'mcpServer/oauth/login')).toHaveLength(1);
    h.manager.close();
    await pending;
  });
  it('publishes a transient URL, correlates the login, verifies state and excludes URL from disk and model result', async () => {
    const h = await fixture();
    h.accept();
    const pending = h.manager.login(h.open, h.id, 'task', new AbortController().signal);
    await vi.waitFor(() =>
      expect(h.manager.list()[0]?.authorizationUrl).toContain('TRANSIENT_STATE'),
    );
    const files = await readdir(h.root),
      receipt = await readFile(join(h.root, files[0]), 'utf8');
    expect(receipt).not.toContain('TRANSIENT_STATE');
    expect(receipt).not.toContain('authorizationUrl');
    h.event({ name: 'fixture', loginId: 'different-login', success: true });
    expect(h.manager.list()[0].status).toBe('awaiting_user');
    h.event({ name: 'wrong-server', loginId: 'login-1', success: true });
    expect(h.manager.list()[0].status).toBe('awaiting_user');
    h.event({ name: 'fixture', loginId: 'login-1', success: true });
    const result = await pending;
    expect(result.status).toBe('authenticated');
    expect(JSON.stringify(result)).not.toContain('TRANSIENT_STATE');
    expect(h.manager.list()[0].authorizationUrl).toBeUndefined();
  });
  it('handles completion arriving before the login response', async () => {
    const h = await fixture();
    h.early();
    expect((await h.manager.login(h.open, h.id, 'task', new AbortController().signal)).status).toBe(
      'authenticated',
    );
  });
  it('does not trust a success notification without subsequent OAuth evidence', async () => {
    const h = await fixture();
    const pending = h.manager.login(h.open, h.id, 'task', new AbortController().signal);
    await vi.waitFor(() => expect(h.manager.list()[0]?.authorizationUrl).toBeTruthy());
    h.event({ name: 'fixture', loginId: 'login-1', success: true });
    expect((await pending).status).toBe('failed');
  });
  it.each(['cancel', 'abort', 'disconnect', 'expiry'] as const)(
    'terminates %s and ignores later completion',
    async (mode) => {
      const h = await fixture(mode === 'expiry' ? 150 : 5000),
        controller = new AbortController();
      h.accept();
      const pending = h.manager.login(h.open, h.id, 'task', controller.signal);
      await vi.waitFor(() => expect(h.manager.list()[0]?.authorizationUrl).toBeTruthy());
      if (mode === 'cancel') h.manager.cancel(h.manager.list()[0].id);
      if (mode === 'abort') controller.abort();
      if (mode === 'disconnect') h.disconnect();
      const result = await pending;
      expect(result.status).toBe(
        mode === 'disconnect' ? 'failed' : mode === 'expiry' ? 'expired' : 'cancelled',
      );
      h.event({ name: 'fixture', loginId: 'login-1', success: true });
      expect(h.manager.list()[0].status).toBe(result.status);
      expect(h.manager.list()[0].authorizationUrl).toBeUndefined();
    },
  );
  it('restores unfinished attempts cancelled without URLs or automatic login', async () => {
    const h = await fixture(),
      pending = h.manager.login(h.open, h.id, 'task', new AbortController().signal);
    await vi.waitFor(() => expect(h.manager.list()[0]?.authorizationUrl).toBeTruthy());
    const restored = new OfficialAuthentication(h.root);
    await restored.initialize();
    expect(restored.list()[0]).toMatchObject({ status: 'cancelled' });
    expect(restored.list()[0].authorizationUrl).toBeUndefined();
    expect(h.request.mock.calls.filter(([m]) => m === 'mcpServer/oauth/login')).toHaveLength(1);
    h.manager.close();
    await pending;
  });
  it('refuses unsupported auth and skips already configured OAuth', async () => {
    const h = await fixture();
    h.status('bearerToken');
    await expect(
      h.manager.login(h.open, h.id, 'task', new AbortController().signal),
    ).rejects.toThrow('no expone');
    h.status('oAuth');
    expect((await h.manager.login(h.open, h.id, 'task', new AbortController().signal)).status).toBe(
      'authenticated',
    );
    expect(h.request.mock.calls.filter(([m]) => m === 'mcpServer/oauth/login')).toHaveLength(0);
  });
  it('waits for specific approval inside a tool session before starting OAuth', async () => {
    const h = await fixture();
    h.accept();
    const runtime = new OfficeToolRuntime({ stateDir: h.root, authentications: h.manager });
    const session = runtime.createSession({
      taskId: 'chief',
      role: 'chief',
      project: h.root,
      authenticationProvider: h.open,
    });
    disposals.push(() => session.dispose());
    const pending = session.execute('auth_connect', { serverId: h.id });
    await vi.waitFor(() => expect(runtime.approvals.list()).toHaveLength(1));
    expect(h.request.mock.calls.filter(([m]) => m === 'mcpServer/oauth/login')).toHaveLength(0);
    runtime.approvals.resolve(runtime.approvals.list()[0].id, true);
    await vi.waitFor(() => expect(h.manager.list()[0]?.authorizationUrl).toBeTruthy());
    h.event({ name: 'fixture', loginId: 'login-1', success: true });
    expect(JSON.stringify(await pending)).toContain('authenticated');
  });
  it('rejects unsafe authorization pages', () => {
    for (const url of [
      'javascript:alert(1)',
      'http://provider.example',
      'https://user:pass@provider.example',
      'https://localhost/path',
    ])
      expect(() => authorizationUrl(url)).toThrow();
  });
});
