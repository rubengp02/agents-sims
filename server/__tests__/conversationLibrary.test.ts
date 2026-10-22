import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TeamSnapshot } from '../../core/src/team.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { ConversationLibrary } from '../src/execution/conversationLibrary.js';
import { DisabledExecutor } from '../src/execution/optionalExecutors.js';
import { TeamCoordinator } from '../src/execution/teamCoordinator.js';
import type { OfficialExecutor } from '../src/execution/types.js';
import { createHttpServer } from '../src/httpServer.js';

const apps: FastifyInstance[] = [];
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'office-conversations-'));
  roots.push(root);
  const project = join(root, 'project');
  mkdirSync(project);
  writeFileSync(
    join(project, 'package.json'),
    JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }),
  );
  return { root, project, directory: join(root, 'library') };
}
async function open(f: ReturnType<typeof fixture>, output = 'Respuesta anterior completa') {
  const library = new ConversationLibrary(f.directory);
  const diagnose = vi.fn<OfficialExecutor['diagnose']>(async () => ({
    checkedAt: Date.now(),
    plan: 'plus',
    quota: [],
    models: [{ id: 'gpt-6.1-sol', efforts: ['low', 'medium', 'high'] }],
  }));
  const execute = vi.fn<OfficialExecutor['execute']>(async (options) => {
    options.onOutput?.(output);
    options.onOutput?.('\nOFFICE_RESULT {"status":"completed"}');
    return {
      version: 1,
      id: 'fixture-run',
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
      inputTokens: 20,
      outputTokens: 4,
    };
  });
  const team = new TeamCoordinator(
    { codex: { provider: 'codex', diagnose, execute }, claude: new DisabledExecutor('claude') },
    undefined,
    undefined,
    undefined,
    undefined,
    join(f.root, 'checkpoint.json'),
    undefined,
    library,
  );
  const { app, port } = await createHttpServer({
    embedded: false,
    token: 'fixture',
    store: new AgentStateStore(),
    team,
  });
  apps.push(app);
  const headers = { host: `127.0.0.1:${port}` };
  const state = () => app.inject({ url: '/api/team', headers });
  const token = (await state()).json().controlToken;
  const post = (route: string, payload: object = {}) =>
    app.inject({
      method: 'POST',
      url: `/api/team/${route}`,
      headers: { ...headers, 'x-office-control': token },
      payload,
    });
  const setup = async () => {
    expect(
      (
        await post('projects', {
          project: f.project,
          name: 'Mi proyecto',
          instructions: 'Responde en español y conserva el contrato.',
        })
      ).statusCode,
    ).toBe(200);
    const projectId = (await state()).json<TeamSnapshot>().library!.selectedProjectId!;
    expect((await post('conversations', { projectId })).statusCode).toBe(200);
    return (await state()).json<TeamSnapshot>().library!.selected!.id;
  };
  const settled = async () => {
    await vi.waitFor(() => expect(team.snapshot().running).toBe(false));
    return (await state()).json<TeamSnapshot>();
  };
  return { library, team, app, state, post, setup, execute, diagnose, settled, headers };
}

describe('saved conversations and project approvals (offline)', () => {
  it('keeps project identity, instructions, selected conversation and draft across restart', async () => {
    const f = fixture();
    const first = await open(f);
    const id = await first.setup();
    await first.post('conversations/draft', { id, draft: 'Mi siguiente pregunta' });
    await first.app.close();
    const restored = await open(f);
    const state = (await restored.state()).json<TeamSnapshot>();
    expect(state.library?.selected).toMatchObject({
      id,
      draft: 'Mi siguiente pregunta',
      messages: [],
    });
    expect(state.library?.projects[0]).toMatchObject({
      name: 'Mi proyecto',
      instructions: 'Responde en español y conserva el contrato.',
    });
    expect(restored.execute).not.toHaveBeenCalled();
    expect(restored.diagnose).not.toHaveBeenCalled();
  });

  it('saves the full response, reopens it, and supplies context to an explicit follow-up', async () => {
    const f = fixture();
    const output = 'INICIO\n' + 'x'.repeat(25000) + '\nFINAL RECORDADO';
    const first = await open(f, output);
    const id = await first.setup();
    expect(
      (await first.post('conversations/message', { id, message: 'Primera pregunta' })).statusCode,
    ).toBe(200);
    expect(first.execute).not.toHaveBeenCalled();
    await first.post('start');
    const finished = await first.settled();
    expect(finished.tasks[0].output).toHaveLength(20000);
    expect(finished.library?.selected?.messages[1].content).toBe(
      output + '\nOFFICE_RESULT {"status":"completed"}',
    );
    await first.app.close();

    const restored = await open(f, 'Respuesta al seguimiento');
    expect(
      (await restored.state()).json<TeamSnapshot>().library?.selected?.messages[1].content,
    ).toContain('FINAL RECORDADO');
    expect(
      (
        await restored.post('conversations/message', {
          id,
          message: 'Continúa con una explicación',
        })
      ).statusCode,
    ).toBe(200);
    expect(restored.execute).not.toHaveBeenCalled();
    await restored.post('resume');
    await restored.post('start');
    const state = await restored.settled();
    expect(restored.execute).toHaveBeenCalledTimes(1);
    const prompt = restored.execute.mock.calls[0][0].prompt;
    expect(prompt).toContain('Responde en español y conserva el contrato.');
    expect(prompt).toContain('FINAL RECORDADO');
    expect(prompt).toContain('Primera pregunta');
    expect(state.library?.selected?.messages).toHaveLength(4);
  });

  it('keeps separate conversations and can read them when the project folder has moved', async () => {
    const f = fixture();
    const first = await open(f);
    const id = await first.setup();
    await first.post('conversations/message', { id, message: 'Mensaje que no debe perderse' });
    const projectId = (await first.state()).json<TeamSnapshot>().library!.selectedProjectId!;
    await first.post('conversations', { projectId });
    const otherId = (await first.state()).json<TeamSnapshot>().library!.selected!.id;
    expect(otherId).not.toBe(id);
    await first.app.close();
    renameSync(f.project, f.project + '-moved');
    const restored = await open(f);
    expect((await restored.post('conversations/select', { id })).statusCode).toBe(200);
    const state = (await restored.state()).json<TeamSnapshot>();
    expect(state.library?.selected?.messages[0].content).toBe('Mensaje que no debe perderse');
    expect(state.library?.conversations).toHaveLength(2);
    expect(state.library?.checks?.available).toBe(false);
    expect(restored.execute).not.toHaveBeenCalled();
  });

  it('requires current human approval, persists it, and runs the approved local script', async () => {
    const f = fixture();
    const first = await open(f);
    await first.setup();
    const before = (await first.state()).json<TeamSnapshot>().library!;
    expect(
      first.library.checksFor(first.library.project(before.selectedProjectId!).path)?.has('test'),
    ).toBe(false);
    expect(
      (
        await first.post('projects/checks', {
          projectId: before.selectedProjectId,
          fingerprint: before.checks!.fingerprint,
          ids: ['test'],
        })
      ).statusCode,
    ).toBe(200);
    await first.app.close();
    const restored = await open(f);
    const project = restored.library.project(before.selectedProjectId!);
    expect((await restored.state()).json<TeamSnapshot>().library?.checks?.checks[0].approved).toBe(
      true,
    );
    expect(
      await restored.library
        .checksFor(project.path)!
        .run(['test'], project.path, new AbortController().signal),
    ).toMatchObject([{ id: 'test', exitCode: 0, passed: true }]);
    expect(
      restored.library.checksFor(project.path)!.covers(['test'], ['Cualquier requisito']),
    ).toBe(false);
    writeFileSync(
      join(f.project, 'package.json'),
      JSON.stringify({ scripts: { test: 'node -e "process.exit(7)"' } }),
    );
    expect(restored.library.checksFor(project.path)!.has('test')).toBe(false);
    expect(
      (
        await restored.post('projects/checks', {
          projectId: project.id,
          fingerprint: before.checks!.fingerprint,
          ids: ['test'],
        })
      ).statusCode,
    ).toBe(409);
    expect(restored.execute).not.toHaveBeenCalled();
  });

  it('rejects foreign conversation/project links and protects every history mutation', async () => {
    const f = fixture();
    const h = await open(f);
    const id = await h.setup();
    const other = join(f.root, 'other');
    mkdirSync(other);
    expect(
      (
        await h.post('tasks', {
          conversationId: id,
          project: other,
          role: 'developer',
          title: 'x',
          prompt: 'x',
        })
      ).statusCode,
    ).toBe(409);
    for (const route of [
      'projects',
      'projects/checks',
      'conversations',
      'conversations/select',
      'conversations/draft',
      'conversations/message',
    ]) {
      expect(
        (
          await h.app.inject({
            method: 'POST',
            url: `/api/team/${route}`,
            headers: h.headers,
            payload: {},
          })
        ).statusCode,
      ).toBe(403);
    }
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('recovers a backup while preserving the damaged original; refuses to overwrite two corrupt copies', () => {
    const f = fixture();
    const library = new ConversationLibrary(f.directory);
    const project = library.register(f.project, 'Proyecto');
    const conversation = library.create(project.id);
    library.draft(conversation.id, 'Último borrador');
    const file = join(f.directory, 'conversations.json');
    writeFileSync(file, 'DAMAGED');
    const recovered = new ConversationLibrary(f.directory);
    expect(recovered.snapshot().warning).toContain('copia de seguridad');
    expect(recovered.snapshot().selected?.id).toBe(conversation.id);
    expect(readFileSync(file, 'utf8')).toBe('DAMAGED');
    recovered.draft(conversation.id, 'Recuperado');
    expect(new ConversationLibrary(f.directory).snapshot().selected?.draft).toBe('Recuperado');
    writeFileSync(file, 'BAD_MAIN');
    writeFileSync(file + '.bak', 'BAD_BACKUP');
    const blocked = new ConversationLibrary(f.directory);
    expect(blocked.snapshot().writable).toBe(false);
    expect(() => blocked.create(project.id)).toThrow();
    expect(readFileSync(file, 'utf8')).toBe('BAD_MAIN');
  });

  it('keeps unsaved text in memory and reports a write failure instead of claiming it was saved', () => {
    const f = fixture();
    const library = new ConversationLibrary(f.directory);
    const project = library.register(f.project);
    const conversation = library.create(project.id);
    library.draft(conversation.id, 'Guardado');
    const file = join(f.directory, 'conversations.json');
    mkdirSync(file + '.tmp');
    expect(() => library.draft(conversation.id, 'Todavía en memoria')).toThrow();
    expect(library.snapshot().selected?.draft).toBe('Todavía en memoria');
    expect(library.snapshot().warning).toContain('No se ha podido guardar');
    expect(new ConversationLibrary(f.directory).snapshot().selected?.draft).toBe('Guardado');
    rmSync(file + '.tmp', { recursive: true });
    library.draft(conversation.id, 'Todavía en memoria');
    expect(new ConversationLibrary(f.directory).snapshot().selected?.draft).toBe(
      'Todavía en memoria',
    );
  });

  it('can recover a missing primary file from its backup without overwriting that backup', () => {
    const f = fixture();
    const library = new ConversationLibrary(f.directory);
    const project = library.register(f.project);
    const conversation = library.create(project.id);
    library.draft(conversation.id, 'Más reciente');
    const file = join(f.directory, 'conversations.json');
    renameSync(file, file + '.missing');
    const recovered = new ConversationLibrary(f.directory);
    expect(recovered.snapshot().selected?.id).toBe(conversation.id);
    recovered.draft(conversation.id, 'Recuperado desde la copia');
    expect(new ConversationLibrary(f.directory).snapshot().selected?.draft).toBe(
      'Recuperado desde la copia',
    );
  });

  it('invalidates existing runner handles when approval is revoked and keeps projects separate', () => {
    const f = fixture();
    const library = new ConversationLibrary(f.directory);
    const project = library.register(f.project);
    const catalog = library.snapshot().checks!;
    library.approve(project.id, catalog.fingerprint, ['test']);
    const runner = library.checksFor(project.path)!;
    library.approve(project.id, catalog.fingerprint, []);
    expect(library.checksFor(project.path)!.has('test')).toBe(false);
    const other = join(f.root, 'other');
    mkdirSync(other);
    writeFileSync(join(other, 'package.json'), readFileSync(join(f.project, 'package.json')));
    const second = library.register(other);
    expect(library.checksFor(second.path)!.has('test')).toBe(false);
    expect(library.snapshot().projects).toHaveLength(2);
    return expect(
      runner.run(['test'], project.path, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'checks_changed' });
  });
});
