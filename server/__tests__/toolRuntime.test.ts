import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { OfficeToolRuntime, type OfficeToolSession } from '../src/tools/toolRuntime.js';

describe('office browser runtime (local fixture, no AI)', () => {
  const cleanup: Array<() => Promise<unknown>> = [];
  afterEach(async () => {
    for (const dispose of cleanup.splice(0).reverse()) await dispose();
  });
  async function fixture(
    role: 'developer' | 'tester',
    trustPreview = true,
    proxyTo?: string,
    classifiedBody?: string,
    allowWrites?: boolean,
  ) {
    let posts = 0;
    let upgrades = 0;
    let workers = 0;
    const server = createServer((req, res) => {
      if (req.url === '/worker.js') {
        workers++;
        res.setHeader('content-type', 'text/javascript');
        res.end('self.addEventListener("fetch",()=>{});');
        return;
      }
      if (req.method === 'POST') {
        posts++;
        if (proxyTo) {
          void fetch(proxyTo, { method: 'POST', body: 'proxy-write' }).then(() =>
            res.end('proxied'),
          );
          return;
        }
        res.end('saved');
        return;
      }
      res.setHeader('content-type', 'text/html');
      res.end(
        "<title>Fixture visual</title><h1>Prueba local</h1><input id=\"name\"><button id=\"save\" onclick=\"fetch('/save',{method:'POST',body:document.querySelector('#name').value}).then(()=>document.querySelector('h1').textContent='Guardado')\">Guardar</button>" +
          "<script>if(location.search.includes('websocket')){const ws=new WebSocket('ws://'+location.host+'/stream');ws.onopen=()=>ws.send('external-write');ws.onclose=()=>console.log('SOCKET_BLOCKED');}if(location.search.includes('worker')){navigator.serviceWorker.register('/worker.js').catch(()=>console.log('WORKER_BLOCKED'));}</script>",
      );
    });
    server.on('upgrade', (_request, socket) => {
      upgrades++;
      socket.destroy();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanup.push(
      () =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    );
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const stateDir = await mkdtemp(join(tmpdir(), 'office-tools-'));
    cleanup.push(() => rm(stateDir, { recursive: true, force: true }));
    let screenshots = 0;
    const runtime = new OfficeToolRuntime({
      stateDir,
      saveArtifact: async () => ({ id: `image-${++screenshots}` }),
    });
    const session = runtime.createSession({
      taskId: 'fixture',
      role,
      allowWrites,
      project: stateDir,
      previewOrigins: trustPreview ? [origin] : [],
      verifiedLocalOperations:
        classifiedBody === undefined
          ? []
          : [
              {
                url: origin + '/save',
                method: 'POST',
                bodySha256: createHash('sha256').update(classifiedBody).digest('hex'),
                evidence:
                  'Fixture exclusivamente local: registra un contador, no realiza conexiones.',
              },
            ],
    });
    cleanup.push(() => session.dispose());
    return {
      runtime,
      session,
      origin,
      posts: () => posts,
      upgrades: () => upgrades,
      workers: () => workers,
    };
  }
  async function open(session: OfficeToolSession, url: string) {
    await session.execute('browser_open', { url });
  }
  it('reads, captures, resizes and allows local writes only for the programmer', async () => {
    const { session, runtime, origin, posts } = await fixture('developer');
    await open(session, origin);
    expect(JSON.stringify(await session.execute('browser_read'))).toContain('Prueba local');
    await session.execute('browser_viewport', { mode: 'mobile' });
    const screenshot = await session.execute('browser_screenshot');
    expect(screenshot.content[0].type).toBe('image');
    expect(JSON.stringify(screenshot.content[1])).toContain('image-1');
    await session.execute('browser_fill', { selector: '#name', value: 'fixture' });
    await session.execute('browser_click', { selector: '#save' });
    await expect.poll(() => runtime.approvals.list().length).toBe(1);
    const [approval] = runtime.approvals.list();
    expect(approval.content).toContain('efectos no se han podido verificar');
    expect(posts()).toBe(0);
    runtime.approvals.resolve(approval.id, true);
    await expect.poll(posts).toBe(1);
    expect(session.capabilities().find((c) => c.id === 'browser')?.state).toBe('available');
  }, 30_000);
  it('only exempts the exact backend-classified local operation, not a changed body', async () => {
    const { session, runtime, origin, posts } = await fixture(
      'developer',
      true,
      undefined,
      'known',
    );
    await open(session, origin);
    await session.execute('browser_fill', { selector: '#name', value: 'different' });
    await session.execute('browser_click', { selector: '#save' });
    await expect.poll(() => runtime.approvals.list().length).toBe(1);
    expect(posts()).toBe(0);
    runtime.approvals.resolve(runtime.approvals.list()[0].id, false);
    await session.execute('browser_fill', { selector: '#name', value: 'known' });
    await session.execute('browser_click', { selector: '#save' });
    await expect.poll(posts).toBe(1);
    expect(runtime.approvals.list()).toHaveLength(0);
  }, 30_000);
  it('keeps credentials out of public approval snapshots without sending the request', async () => {
    const { session, runtime, origin, posts } = await fixture('developer');
    await open(session, origin);
    await session.execute('browser_fill', {
      selector: '#name',
      value: JSON.stringify({
        username: 'fixture-user',
        password: 'PRIVATE_PASSWORD_FIXTURE',
        access_token: 'PRIVATE_TOKEN_FIXTURE',
        message: 'reviewed public text',
      }),
    });
    await session.execute('browser_click', { selector: '#save' });
    await expect.poll(() => runtime.approvals.list().length).toBe(1);
    const snapshot = JSON.stringify(runtime.approvals.list());
    expect(snapshot).not.toContain('PRIVATE_PASSWORD_FIXTURE');
    expect(snapshot).not.toContain('PRIVATE_TOKEN_FIXTURE');
    expect(snapshot).toContain('reviewed public text');
    expect(posts()).toBe(0);
    runtime.approvals.resolve(runtime.approvals.list()[0].id, false);
  }, 30000);
  it('blocks WebSockets before a connection can send unreviewed frames', async () => {
    const { session, origin, upgrades } = await fixture('developer');
    await open(session, origin + '/?websocket');
    await expect
      .poll(async () => JSON.stringify(await session.execute('browser_console')))
      .toContain('SOCKET_BLOCKED');
    expect(upgrades()).toBe(0);
  }, 30_000);
  it('blocks Service Workers before they can bypass network approvals', async () => {
    const { session, origin, workers } = await fixture('developer');
    await open(session, origin + '/?worker');
    await expect
      .poll(async () => JSON.stringify(await session.execute('browser_console')))
      .toMatch(/Service Worker registration blocked|WORKER_BLOCKED/);
    expect(workers()).toBe(0);
  }, 30_000);
  it('does not dispatch an unknown local proxy operation before exact approval', async () => {
    let externalWrites = 0;
    const destination = createServer((request, response) => {
      if (request.method === 'POST') externalWrites++;
      response.end('ok');
    });
    await new Promise<void>((resolve) => destination.listen(0, '127.0.0.1', resolve));
    cleanup.push(
      () =>
        new Promise<void>((resolve) => {
          destination.closeAllConnections();
          destination.close(() => resolve());
        }),
    );
    const external = `http://127.0.0.1:${(destination.address() as { port: number }).port}`;
    const { session, runtime, origin, posts } = await fixture('developer', true, external);
    await open(session, origin);
    await session.execute('browser_click', { selector: '#save' });
    await expect.poll(() => runtime.approvals.list().length).toBe(1);
    expect(posts()).toBe(0);
    expect(externalWrites).toBe(0);
    const [approval] = runtime.approvals.list();
    expect(approval.destination).toBe(`${origin}/save`);
    runtime.approvals.resolve(approval.id, false);
    expect(posts()).toBe(0);
    expect(externalWrites).toBe(0);
  }, 30_000);
  it('cannot modify preview from a reader session and stops after cancellation', async () => {
    const { session, origin, posts } = await fixture('tester');
    await open(session, origin);
    await expect(
      session.execute('browser_fill', { selector: '#name', value: 'blocked' }),
    ).rejects.toThrow('lectura');
    expect(posts()).toBe(0);
    await session.dispose();
    await expect(session.execute('browser_read')).rejects.toThrow('detenido');
  }, 30_000);
  it('does not promote a programmer with explicit read-only permission', async () => {
    const { session, origin, posts } = await fixture(
      'developer',
      true,
      undefined,
      undefined,
      false,
    );
    await open(session, origin);
    await expect(
      session.execute('browser_fill', { selector: '#name', value: 'blocked' }),
    ).rejects.toThrow('lectura');
    expect(posts()).toBe(0);
  }, 30_000);
  it('requires one approval for interaction and a separate exact network-write approval', async () => {
    const { session, runtime, origin, posts } = await fixture('developer', false);
    await open(session, origin);
    const args = { selector: '#save' };
    const click = session.execute('browser_click', args);
    args.selector = '#different-operation';
    await expect.poll(() => runtime.approvals.list().length).toBe(1);
    const [interaction] = runtime.approvals.list();
    expect(interaction.content).toContain('#save');
    expect(interaction.content).not.toContain('#different-operation');
    expect(posts()).toBe(0);
    runtime.approvals.resolve(interaction.id, true);
    await click;
    await expect
      .poll(() => runtime.approvals.list().find((a) => a.tool === 'browser_network_write'))
      .toBeDefined();
    const [network] = runtime.approvals.list();
    expect(network.destination).toBe(`${origin}/save`);
    expect(network.content).toContain('POST');
    expect(posts()).toBe(0);
    runtime.approvals.resolve(network.id, false);
    expect(posts()).toBe(0);
  }, 30_000);
});
