import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import { ConversationLibrary } from '../src/execution/conversationLibrary.js';
import { DisabledExecutor } from '../src/execution/optionalExecutors.js';
import { TeamCoordinator } from '../src/execution/teamCoordinator.js';
import type { ExecuteOptions, OfficialExecutor, RunRecord } from '../src/execution/types.js';
import { createHttpServer } from '../src/httpServer.js';
import { OfficeServices } from '../src/tools/officeServices.js';

const roots: string[] = [],
  apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});
async function harness(
  engine: OfficialExecutor['engine'] = 'codex-app-server',
  reuseRoot?: string,
) {
  const root = reuseRoot ?? mkdtempSync(join(tmpdir(), 'office-tools-http-'));
  if (!reuseRoot) roots.push(root);
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, 'app.ts'), '// static local fixture');
  const services = new OfficeServices(join(root, 'tools'), join(root, 'host'));
  await services.initialize();
  const execute = vi.fn(async (options: ExecuteOptions): Promise<RunRecord> => {
    options.onOutput?.(
      'Imagen comprobada en una ejecución simulada\nOFFICE_RESULT {"status":"completed"}',
    );
    return {
      version: 1,
      id: randomUUID(),
      provider: 'codex',
      billing: 'subscription-only',
      status: 'completed',
      project: options.project,
      requestedModel: options.model!,
      requestedEffort: options.effort!,
      confirmedModel: null,
      sessionId: 'fixture-session',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      reasonCode: null,
      inputTokens: 12,
      outputTokens: 8,
    };
  });
  const codex: OfficialExecutor = {
    provider: 'codex',
    engine,
    diagnose: async () => ({
      checkedAt: Date.now(),
      plan: 'plus',
      quota: [],
      models: [{ id: 'gpt-6.1-sol', efforts: ['low'] }],
    }),
    execute,
  };
  const library = new ConversationLibrary(join(root, 'library'));
  const team = new TeamCoordinator(
    { codex, claude: new DisabledExecutor('claude') },
    undefined,
    undefined,
    undefined,
    undefined,
    join(root, 'checkpoint.json'),
    undefined,
    library,
    services,
  );
  const { app, port } = await createHttpServer({
    embedded: false,
    token: 'unrelated-hook-token',
    store: new AgentStateStore(),
    team,
  });
  apps.push(app);
  const headers = { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` };
  const state = await app.inject({ url: '/api/team', headers });
  const control = { ...headers, 'x-office-control': state.json().controlToken };
  if (!library.snapshot().selected) {
    const saved = team.saveProject(project, 'Proyecto visual');
    team.selectProject(saved.id);
  }
  const id = library.snapshot().selected!.id;
  const png = await sharp({ create: { width: 4, height: 3, channels: 3, background: 'blue' } })
    .png()
    .toBuffer();
  return { app, root, project, headers, control, team, library, services, id, png, execute };
}
describe('office tools and image HTTP boundary (real storage, simulated inference)', () => {
  it('serves only registered connection receipts without contacting providers or running models', async () => {
    const h = await harness();
    const connection = await h.services.connections.remember('Ejemplo', 'https://example.com/mcp');
    const url = `/api/team/connections/${connection.id}/operations`;
    const response = await h.app.inject({ url, headers: h.headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      recordingStartedAt: expect.any(Number),
      operations: [],
    });
    const foreign = await h.app.inject({
      url,
      headers: { ...h.headers, origin: 'https://other.example' },
    });
    expect(foreign.statusCode).toBe(403);
    const unknown = await h.app.inject({
      url: '/api/team/connections/not-registered/operations',
      headers: h.headers,
    });
    expect(unknown.statusCode).not.toBe(200);
    expect(h.execute).not.toHaveBeenCalled();
  });
  it('protects tools and artifacts from cross-origin requests and all mutations without the local token', async () => {
    const h = await harness();
    const tools = await h.app.inject({ url: '/api/team/tools', headers: h.headers });
    expect(tools.statusCode).toBe(200);
    expect(tools.json().capabilities.length).toBeGreaterThan(0);
    for (const url of [
      '/api/team/attachments',
      '/api/team/tools/check',
      '/api/team/tool-approvals/unknown',
      '/api/team/authentication/unknown/cancel',
      '/api/team/connections/unknown/disable',
      '/api/team/connections/unknown/review',
      '/api/team/tool-operations/unknown/review',
    ]) {
      expect(
        (await h.app.inject({ method: 'POST', url, headers: h.headers, payload: {} })).statusCode,
      ).toBe(403);
      expect(
        (
          await h.app.inject({
            method: 'POST',
            url,
            headers: { ...h.control, origin: 'https://attacker.invalid' },
            payload: {},
          })
        ).statusCode,
      ).toBe(403);
    }
    expect(
      (
        await h.app.inject({
          url: '/api/team/tools',
          headers: { ...h.headers, 'sec-fetch-site': 'cross-site' },
        })
      ).statusCode,
    ).toBe(403);
    expect(h.execute).not.toHaveBeenCalled();
  });
  it('cancels authentication only through the local authenticated route', async () => {
    const h = await harness();
    const cancel = vi
      .spyOn(h.services.authentications, 'cancel')
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    const result = await h.app.inject({
      method: 'POST',
      url: '/api/team/authentication/auth-1/cancel',
      headers: h.control,
      payload: {},
    });
    expect(result.statusCode).toBe(200);
    expect(cancel).toHaveBeenCalledWith('auth-1');
    const expired = await h.app.inject({
      method: 'POST',
      url: '/api/team/authentication/auth-1/cancel',
      headers: h.control,
      payload: {},
    });
    expect(expired.statusCode).toBe(409);
    expect(expired.json().code).toBe('auth_expired');
  });
  it('routes connection disabling only through the authenticated local control', async () => {
    const h = await harness();
    const disable = vi.spyOn(h.services.connections, 'disable').mockResolvedValueOnce({
      id: 'connection-1',
      enabled: false,
      reason: 'Acceso local desactivado',
    });
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/team/connections/connection-1/disable',
      headers: h.control,
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(disable).toHaveBeenCalledWith('connection-1');
    expect(h.execute).not.toHaveBeenCalled();
  });
  it('defers an unclosed receipt while work is active without changing it or executing work on review', async () => {
    const h = await harness(),
      id = randomUUID(),
      directory = join(h.services.directory, 'plugin-operations');
    mkdirSync(directory, { recursive: true });
    const file = join(directory, id + '.json'),
      original = JSON.stringify({
        id,
        status: 'dispatching',
        operation: 'install',
        preview: { plugin: { id: 'plugin-public', name: 'Local fixture' } },
        conversationId: h.id,
      });
    writeFileSync(file, original);
    const listed = await h.app.inject({ url: '/api/team/tool-operations', headers: h.headers });
    expect(listed.statusCode).toBe(200);
    const operation = listed.json().operations[0];
    expect(operation).toMatchObject({
      receiptId: id,
      status: 'pending',
      destination: 'Local fixture',
      conversationId: h.id,
    });
    const request = {
      method: 'POST' as const,
      url: `/api/team/tool-operations/${operation.id}/review`,
      headers: h.control,
    };
    expect(
      (await h.app.inject({ ...request, payload: { reviewed: true, outcome: 'unknown' } }))
        .statusCode,
    ).toBe(409);
    const snapshot = h.team.snapshot(),
      active = vi.spyOn(h.team, 'snapshot').mockReturnValue({ ...snapshot, running: true });
    expect(
      (await h.app.inject({ ...request, payload: { reviewed: true, outcome: 'completed' } })).json()
        .code,
    ).toBe('office_still_running');
    active.mockRestore();
    expect(
      (await h.app.inject({ ...request, payload: { reviewed: true, outcome: 'not_completed' } }))
        .statusCode,
    ).toBe(200);
    expect(readFileSync(file, 'utf8')).toBe(original);
    expect(
      (await h.app.inject({ url: '/api/team/tool-operations', headers: h.headers })).json()
        .operations[0],
    ).toMatchObject({
      status: 'reviewed',
      originalStatus: 'dispatching',
      review: { outcome: 'not_completed' },
    });
    expect(
      (await h.app.inject({ ...request, payload: { reviewed: true, outcome: 'completed' } }))
        .statusCode,
    ).toBe(409);
    expect(h.execute).not.toHaveBeenCalled();
  });
  it('requires explicit human acknowledgement before clearing an uncertain result', async () => {
    const h = await harness();
    const acknowledge = vi
      .spyOn(h.services.connections, 'acknowledge')
      .mockResolvedValue({ id: 'connection-1', reviewed: true });
    const request = {
      method: 'POST' as const,
      url: '/api/team/connections/connection-1/review',
      headers: h.control,
    };
    const missingReview = await h.app.inject({ ...request, payload: {} });
    expect(missingReview.statusCode).toBe(409);
    expect(missingReview.json().code).toBe('connection_review_required');
    expect(acknowledge).not.toHaveBeenCalled();
    expect((await h.app.inject({ ...request, payload: { reviewed: true } })).statusCode).toBe(200);
    expect(acknowledge).toHaveBeenCalledWith('connection-1');
    expect(h.execute).not.toHaveBeenCalled();
  });
  it('allows human review of a closed uncertain result while unrelated office work continues', async () => {
    const h = await harness(),
      id = randomUUID(),
      directory = join(h.services.directory, 'plugin-operations');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, id + '.json'),
      JSON.stringify({
        id,
        status: 'review_required',
        operation: 'install',
        preview: { plugin: { name: 'Fixture' } },
      }),
    );
    const current = h.team.snapshot(),
      active = vi.spyOn(h.team, 'snapshot').mockReturnValue({ ...current, running: true });
    const record = (
      await h.app.inject({ url: '/api/team/tool-operations', headers: h.headers })
    ).json().operations[0];
    const result = await h.app.inject({
      method: 'POST',
      url: `/api/team/tool-operations/${record.id}/review`,
      headers: h.control,
      payload: { reviewed: true, outcome: 'completed' },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().running).toBe(true);
    expect(h.execute).not.toHaveBeenCalled();
    active.mockRestore();
  });
  it('validates actual image bytes, binds a persistent draft, and rejects cross-conversation reuse', async () => {
    const h = await harness();
    const upload = await h.app.inject({
      method: 'POST',
      url: '/api/team/attachments',
      headers: h.control,
      payload: { conversationId: h.id, name: '../captura.png', data: h.png.toString('base64') },
    });
    expect(upload.statusCode).toBe(200);
    const artifact = upload.json().artifact;
    expect(artifact.name).toBe('captura.png');
    expect(artifact).not.toHaveProperty('path');
    expect(upload.body).not.toContain(h.root);
    const draft = await h.app.inject({
      method: 'POST',
      url: '/api/team/conversations/draft',
      headers: h.control,
      payload: { id: h.id, draft: 'Revisa la imagen', attachmentIds: [artifact.id] },
    });
    expect(draft.statusCode).toBe(200);
    expect(draft.json().library.selected.draftAttachments).toEqual([artifact]);
    const image = await h.app.inject({
      url: `/api/team/artifacts/${artifact.id}`,
      headers: h.headers,
    });
    expect(image.headers['content-type']).toContain('image/png');
    expect(image.rawPayload).toEqual(h.png);
    expect(image.headers['cross-origin-resource-policy']).toBe('same-origin');
    const download = await h.app.inject({
      url: `/api/team/artifacts/${artifact.id}?download=1`,
      headers: h.headers,
    });
    expect(download.headers['content-disposition']).toContain('attachment;');
    expect(
      (
        await h.app.inject({
          url: `/api/team/artifacts/${artifact.id}`,
          headers: { ...h.headers, origin: 'https://attacker.invalid' },
        })
      ).statusCode,
    ).toBe(403);
    h.team.createConversation(h.library.snapshot().projects[0].id);
    const otherId = h.library.snapshot().selected!.id;
    const steal = await h.app.inject({
      method: 'POST',
      url: '/api/team/conversations/draft',
      headers: h.control,
      payload: { id: otherId, draft: 'Otra conversación', attachmentIds: [artifact.id] },
    });
    expect(steal.statusCode).not.toBe(200);
    expect(h.services.artifacts.get(artifact.id).conversationId).toBe(h.id);
    const fake = await h.app.inject({
      method: 'POST',
      url: '/api/team/attachments',
      headers: h.control,
      payload: {
        conversationId: h.id,
        name: 'falsa.png',
        data: Buffer.from('<html>not an image</html>').toString('base64'),
      },
    });
    expect(fake.statusCode).not.toBe(200);
    expect(
      (await h.app.inject({ url: '/api/team/artifacts/..%2Fmanifest.json', headers: h.headers }))
        .statusCode,
    ).not.toBe(200);
    const reopened = new ConversationLibrary(join(h.root, 'library'));
    reopened.select(h.id);
    expect(reopened.snapshot().selected!.draftAttachments?.[0].id).toBe(artifact.id);
    expect(h.execute).not.toHaveBeenCalled();
  });
  it('sends trusted image paths to the configured executor and preserves images with the completed history', async () => {
    const h = await harness();
    const originalExecution = h.execute.getMockImplementation()!;
    h.execute.mockImplementationOnce(async (options) => {
      const file = join(options.artifactDirectory!, 'proposal.png');
      writeFileSync(file, h.png);
      options.onArtifact?.(file);
      return originalExecution(options);
    });
    const artifact = await h.services.artifacts.put({
      name: 'captura.png',
      bytes: h.png,
      kind: 'attachment',
      conversationId: h.id,
    });
    const sent = await h.app.inject({
      method: 'POST',
      url: '/api/team/conversations/send',
      headers: h.control,
      payload: {
        id: h.id,
        message: 'Analiza la imagen',
        officeMode: false,
        attachmentIds: [artifact.id],
      },
    });
    expect(sent.statusCode).toBe(200);
    await vi.waitFor(() => expect(h.team.snapshot().tasks[0].status).toBe('completed'), {
      timeout: 5000,
    });
    await vi.waitFor(() => expect(h.team.snapshot().running).toBe(false));
    expect(h.execute).toHaveBeenCalledOnce();
    const options = h.execute.mock.calls[0][0];
    expect(options.imagePaths).toHaveLength(1);
    expect(existsSync(options.imagePaths![0])).toBe(true);
    expect(readFileSync(options.imagePaths![0])).toEqual(h.png);
    const request = h.library
      .snapshot()
      .selected!.messages.find((message) => message.kind === 'request')!;
    expect(request.attachments?.[0].id).toBe(artifact.id);
    expect(h.library.snapshot().selected!.draftAttachments ?? []).toEqual([]);
    const reopened = new ConversationLibrary(join(h.root, 'library'));
    expect(
      reopened.snapshot().selected!.messages.find((message) => message.kind === 'request')
        ?.attachments?.[0].id,
    ).toBe(artifact.id);
    const generated = h.team.snapshot().tasks[0].artifacts![0];
    const followup = await h.app.inject({
      method: 'POST',
      url: '/api/team/conversations/send',
      headers: h.control,
      payload: {
        id: h.id,
        message: 'Modifica la propuesta anterior',
        officeMode: false,
        attachmentIds: [],
      },
    });
    expect(followup.statusCode).toBe(200);
    await vi.waitFor(() => expect(h.execute).toHaveBeenCalledTimes(2));
    expect(h.execute.mock.calls[1][0].imagePaths).toHaveLength(2);
    expect(h.execute.mock.calls[1][0].imagePaths![0]).toBe(
      await h.services.artifacts.path(generated.id),
    );
  });
  it('rejects image execution with the legacy engine instead of switching engines silently', async () => {
    const h = await harness('codex-cli');
    const artifact = await h.services.artifacts.put({
      name: 'captura.png',
      bytes: h.png,
      kind: 'attachment',
      conversationId: h.id,
    });
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/team/conversations/prepare',
      headers: h.control,
      payload: { id: h.id, message: 'Analiza', attachmentIds: [artifact.id] },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('image_engine_unavailable');
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.team.snapshot().tasks).toEqual([]);
  });
  it('resolves only a single registered approval and checks typed fields on the server', async () => {
    const h = await harness();
    const pending = h.services.runtime.approvals.requestFields({
      taskId: 'fixture-task',
      tool: 'Elige destino',
      destination: 'Servicio simulado',
      content: 'Selecciona una carpeta pública',
      args: {},
      fields: [
        { name: 'folder', label: 'Carpeta', type: 'string', required: true, options: ['A', 'B'] },
      ],
    });
    const id = h.services.runtime.approvals.list()[0].id;
    const invalid = await h.app.inject({
      method: 'POST',
      url: `/api/team/tool-approvals/${id}`,
      headers: h.control,
      payload: { approved: true, values: { folder: 'C' } },
    });
    expect(invalid.statusCode).not.toBe(200);
    expect(h.services.runtime.approvals.list()).toHaveLength(1);
    const approve = await h.app.inject({
      method: 'POST',
      url: `/api/team/tool-approvals/${id}`,
      headers: h.control,
      payload: { approved: true, values: { folder: 'A' } },
    });
    expect(approve.statusCode).toBe(200);
    expect(await pending).toEqual({ approved: true, values: { folder: 'A' } });
    expect(
      (
        await h.app.inject({
          method: 'POST',
          url: `/api/team/tool-approvals/${id}`,
          headers: h.control,
          payload: { approved: true, values: { folder: 'A' } },
        })
      ).statusCode,
    ).toBe(409);
  });
});
