import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import { ConversationLibrary } from '../src/execution/conversationLibrary.js';
import { DisabledExecutor } from '../src/execution/optionalExecutors.js';
import { TeamCoordinator } from '../src/execution/teamCoordinator.js';
import type { OfficialExecutor } from '../src/execution/types.js';
import { createHttpServer } from '../src/httpServer.js';

const roots: string[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'office-queue-http-'));
  roots.push(root);
  const project = join(root, 'project');
  mkdirSync(project);
  const library = new ConversationLibrary(join(root, 'history'));
  const saved = library.register(project);
  library.setAutonomy(saved.id, false);
  const id = library.create(saved.id).id;
  const execute = vi.fn<OfficialExecutor['execute']>();
  const team = new TeamCoordinator(
    {
      codex: {
        provider: 'codex',
        engine: 'codex-app-server',
        execute,
        diagnose: async () => ({
          checkedAt: Date.now(),
          plan: 'plus',
          quota: [],
          models: [{ id: 'gpt-6.1-sol', efforts: ['low', 'medium', 'high'] }],
        }),
      },
      claude: new DisabledExecutor('claude'),
    },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    library,
  );
  const { app, port } = await createHttpServer({
    embedded: false,
    token: 'hook-only',
    store: new AgentStateStore(),
    team,
  });
  apps.push(app);
  const headers = { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` };
  const snapshot = await app.inject({ url: '/api/team', headers });
  const control = { ...headers, 'x-office-control': snapshot.json().controlToken };
  const post = (route: string, payload: unknown, auth = control) =>
    app.inject({
      method: 'POST',
      url: `/api/team/conversations/${route}`,
      headers: auth,
      payload: payload as object,
    });
  return { app, id, library, team, execute, headers, control, post };
}

describe('conversation queue HTTP controls', () => {
  it('requires the same-origin local control token for every queue and steering mutation', async () => {
    const h = await fixture();
    for (const route of ['queue', 'queue/update', 'queue/remove', 'queue/continue', 'apply-now']) {
      const body = { id: h.id, inputId: randomUUID(), message: 'Prueba' };
      expect((await h.post(route, body, { ...h.control, 'x-office-control': '' })).statusCode).toBe(
        403,
      );
      expect(
        (await h.post(route, body, { ...h.control, origin: 'https://attacker.invalid' }))
          .statusCode,
      ).toBe(403);
      expect(
        (await h.post(route, body, { ...h.control, host: 'attacker.invalid' })).statusCode,
      ).toBe(403);
    }
    expect(h.library.pendingInputs()).toEqual([]);
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('rejects malformed requests and references without changing the queue or running a model', async () => {
    const h = await fixture();
    const base = { id: h.id, inputId: randomUUID(), message: 'Petición' };
    for (const body of [
      {},
      [],
      { ...base, inputId: '../outside' },
      { ...base, message: 'x'.repeat(12001) },
      { ...base, officeMode: 'yes' },
      { ...base, allowWrites: 'all' },
      { ...base, budgetMode: 'unlimited' },
      { ...base, attachmentIds: ['C:\\private\\secret.png'] },
      { ...base, id: randomUUID() },
    ]) {
      expect([400, 409]).toContain((await h.post('queue', body)).statusCode);
    }
    expect([400, 409]).toContain((await h.post('apply-now', {})).statusCode);
    expect(h.library.pendingInputs()).toEqual([]);
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('provides idempotent queue creation and revision-protected edit/removal via HTTP', async () => {
    const h = await fixture();
    // An explicit hold permits inspection of the persisted queue before its timer can dispatch.
    h.library.holdPending(h.id, true);
    const body = { id: h.id, inputId: randomUUID(), message: 'Pendiente' };
    expect((await h.post('queue', body)).statusCode).toBe(200);
    expect((await h.post('queue', body)).statusCode).toBe(200);
    expect(h.library.pendingInputs()).toHaveLength(1);
    expect((await h.post('queue', { ...body, message: 'Otro contenido' })).statusCode).toBe(409);
    const revision = h.library.pendingInputs()[0].revision;
    expect(
      (await h.post('queue/update', { ...body, revision, message: 'Editado' })).statusCode,
    ).toBe(200);
    expect((await h.post('queue/remove', { ...body, revision })).statusCode).toBe(409);
    expect(h.library.pendingInputs()[0].content).toBe('Editado');
    expect((await h.post('queue/remove', { ...body, revision: revision + 1 })).statusCode).toBe(
      200,
    );
    expect(h.library.pendingInputs()).toEqual([]);
    expect(h.execute).not.toHaveBeenCalled();
  });
});
