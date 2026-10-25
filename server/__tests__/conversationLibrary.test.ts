import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TeamSnapshot } from '../../core/src/team.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { AdaptiveRuntime } from '../src/execution/adaptiveRuntime.js';
import { CODEX_TASK_PREFIX } from '../src/execution/codexExecutor.js';
import { ConversationLibrary } from '../src/execution/conversationLibrary.js';
import { DisabledExecutor } from '../src/execution/optionalExecutors.js';
import { TeamCoordinator } from '../src/execution/teamCoordinator.js';
import { ExecutionBlocked, type OfficialExecutor } from '../src/execution/types.js';
import { UsageHistory } from '../src/execution/usageHistory.js';
import { createHttpServer } from '../src/httpServer.js';
import { OfficeServices } from '../src/tools/officeServices.js';

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

function initOfficeGit(project: string) {
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', project, ...args], { windowsHide: true, stdio: 'pipe' });
  git('init');
  git('add', '.');
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-m',
    'fixture',
  );
}

function mockOffice(
  h: Awaited<ReturnType<typeof open>>,
  decisions: object[],
  worker?: (options: Parameters<OfficialExecutor['execute']>[0]) => string,
) {
  let index = 0;
  h.execute.mockImplementation(async (options) => {
    const text =
      options.officeRole === 'chief'
        ? 'OFFICE_DECISION ' + JSON.stringify(decisions[Math.min(index++, decisions.length - 1)])
        : (worker?.(options) ??
          'Entrega verificable del empleado.\nOFFICE_RESULT {"status":"completed"}');
    options.onOutput?.(text);
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
      sessionId: randomUUID(),
      startedAt: Date.now(),
      updatedAt: Date.now(),
      reasonCode: null,
      inputTokens: 20,
      outputTokens: 4,
    };
  });
}
async function open(
  f: ReturnType<typeof fixture>,
  output = 'Respuesta anterior completa',
  adaptive = false,
  services?: OfficeServices,
) {
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
    adaptive
      ? new AdaptiveRuntime(new UsageHistory(join(f.root, 'usage.json')), join(f.root, 'artifacts'))
      : undefined,
    library,
    services,
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
      payload:
        route === 'conversations/execute'
          ? {
              fingerprint: team
                .snapshot()
                .tasks.find((t) => t.id === (payload as { taskId?: string }).taskId)
                ?.confirmationFingerprint,
              ...payload,
            }
          : payload,
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
    await vi.waitFor(() => expect(team.snapshot().running).toBe(false), { timeout: 15000 });
    return (await state()).json<TeamSnapshot>();
  };
  return { library, team, app, state, post, setup, execute, diagnose, settled, headers };
}

describe('saved conversations and project approvals (offline)', () => {
  it('assigns the Chief role before model selection without weakening the light-code evidence gate', async () => {
    const f = fixture(),
      h = await open(f, 'Respuesta', true),
      id = await h.setup();
    h.diagnose.mockResolvedValue({
      checkedAt: Date.now(),
      plan: 'plus',
      quota: [],
      models: [
        { id: 'gpt-6-luna', efforts: ['low', 'medium', 'high'] },
        { id: 'gpt-6.1-sol', efforts: ['low', 'medium', 'high'] },
      ],
    });
    const office = (
      await h.post('conversations/prepare', { id, message: 'Resume este texto.', officeMode: true })
    ).json<TeamSnapshot>();
    const chief = office.tasks.at(-1)!;
    expect(chief.role).toBe('chief');
    expect(chief.choice?.model).toBe('gpt-6-luna');
    expect(chief.reasonCode).not.toBe('model_evidence_required');
    const code = await open(fixture(), 'Respuesta', true);
    const codeId = await code.setup();
    code.diagnose.mockResolvedValue(await h.diagnose());
    await code.post('conversations/prepare', {
      id: codeId,
      message: 'Resume este texto.',
      officeMode: false,
    });
    const coding = (await code.state()).json<TeamSnapshot>();
    expect(coding.tasks.at(-1)).toMatchObject({
      role: 'developer',
      status: 'blocked',
      reasonCode: 'model_evidence_required',
    });
  });
  it.each(['expired', 'authenticated', 'historical-expired'] as const)(
    'uses current personal sign-in evidence before dispatching reviews (%s)',
    async (scenario) => {
      const f = fixture(),
        host = join(f.root, 'host');
      mkdirSync(host);
      const services = new OfficeServices(join(f.root, 'private'), host);
      await services.initialize();
      const h = await open(f, 'Respuesta', true, services),
        id = await h.setup();
      let authTaskId: string | undefined;
      vi.spyOn(services.authentications, 'list').mockImplementation(() =>
        authTaskId
          ? [
              {
                id: 'fixture-auth',
                kind: 'application',
                taskId: scenario === 'historical-expired' ? 'earlier-task' : authTaskId,
                service: 'Vercel',
                status: scenario === 'authenticated' ? 'authenticated' : 'expired',
                reason: 'Fixture personal sign-in status',
                expiresAt: Date.now() - 1,
              },
            ]
          : [],
      );
      mockOffice(h, [
        {
          action: 'assign',
          role: 'tester',
          title: 'Revisa',
          task: 'Verifica la conexión',
          message: 'Revisa las evidencias',
        },
        { action: 'complete', message: 'Entrega revisada' },
      ]);
      const execute = h.execute.getMockImplementation()!;
      h.execute.mockImplementation(async (options) => {
        if (options.officeRole === 'chief' && !authTaskId) authTaskId = options.executionSessionKey;
        return execute(options);
      });
      await h.post('conversations/send', {
        id,
        message: 'Conecta la aplicación oficial',
        officeMode: true,
      });
      const state = await h.settled(),
        root = state.tasks.find((t) => !t.officeParentId)!;
      if (scenario === 'expired') {
        expect(root).toMatchObject({
          status: 'paused',
          reasonCode: 'office_human_required',
          humanRequest: { responseType: 'text' },
        });
        expect(root.humanRequest?.question).toContain('Vercel');
        expect(root.humanRequest?.question).toContain('inicio de sesión');
        expect(h.execute).toHaveBeenCalledTimes(1);
        expect(state.tasks.some((t) => t.role === 'tester')).toBe(false);
        const checkpoint = JSON.parse(readFileSync(join(f.root, 'checkpoint.json'), 'utf8'));
        expect(checkpoint.tasks.find((t: { id: string }) => t.id === root.id).humanRequest).toEqual(
          root.humanRequest,
        );
      } else {
        expect(root.status).toBe('completed');
        expect(h.execute.mock.calls.map(([options]) => options.officeRole)).toEqual([
          'chief',
          'tester',
          'chief',
        ]);
      }
      services.authentications.close();
    },
  );
  it('records project changes during read-only work without attributing them to the employee', async () => {
    const f = fixture(),
      h = await open(f, 'Respuesta', true),
      id = await h.setup();
    mockOffice(
      h,
      [
        {
          action: 'assign',
          role: 'architect',
          title: 'Estudia el proyecto',
          task: 'Analiza',
          message: 'Consulta los archivos',
        },
      ],
      (options) => {
        expect(options.allowWrites).toBe(false);
        // Simulate a concurrent editor changing the shared project during analysis.
        writeFileSync(join(f.project, 'external-edit.txt'), 'Cambio concurrente');
        return 'Análisis conservado\nOFFICE_RESULT {"status":"completed"}';
      },
    );
    expect(
      (await h.post('conversations/send', { id, message: 'Resume el proyecto', officeMode: true }))
        .statusCode,
    ).toBe(200);
    const state = await h.settled();
    expect(state.tasks[0]).toMatchObject({
      status: 'paused',
      reasonCode: 'project_changed_during_read',
    });
    expect(state.tasks[0].explanation).toContain('no identifica quién');
    expect(state.tasks[0].explanation).not.toContain('Un empleado');
    expect(state.tasks.at(-1)).toMatchObject({ role: 'architect', status: 'completed' });
    expect(h.execute).toHaveBeenCalledTimes(2);
    const saved = new ConversationLibrary(f.directory).snapshot();
    expect(
      saved.selected!.messages.some((m) => m.reasonCode === 'project_changed_during_read'),
    ).toBe(true);
    expect(saved.selected!.messages.some((m) => m.content.includes('Análisis conservado'))).toBe(
      true,
    );
  });
  it('delegates a project summary to the architect and reviews that delivery with the tester despite permanent write permission', async () => {
    const f = fixture(),
      h = await open(f, 'Respuesta', true),
      id = await h.setup();
    const analysis =
      'RESUMEN_DEL_ARQUITECTO: propósito, arquitectura, rutas principales y limitaciones verificadas.';
    mockOffice(
      h,
      [
        {
          action: 'assign',
          role: 'architect',
          title: 'Estudia el proyecto',
          task: 'Prepara el resumen con evidencias',
          message: 'El Arquitecto realiza el análisis',
        },
        {
          action: 'assign',
          role: 'tester',
          title: 'Verifica el resumen',
          task: 'Contrasta la entrega del Arquitecto con los archivos',
          message: 'El Tester revisa antes del cierre',
        },
        { action: 'complete', message: 'Resumen analizado y revisado por el equipo' },
      ],
      (options) =>
        (options.officeRole === 'architect' ? analysis : 'Resumen contrastado con los archivos') +
        '\nOFFICE_RESULT {"status":"completed"}',
    );
    expect(
      (
        await h.post('conversations/send', {
          id,
          message: 'Analiza el proyecto y hazme un resumen completo',
          officeMode: true,
        })
      ).statusCode,
    ).toBe(200);
    const state = await h.settled();
    expect(state.tasks[0]).toMatchObject({
      status: 'completed',
      allowWrites: true,
      office: { rounds: 3, phase: 'completed' },
    });
    expect(h.execute.mock.calls.map(([options]) => options.officeRole)).toEqual([
      'chief',
      'architect',
      'chief',
      'tester',
      'chief',
    ]);
    expect(h.execute.mock.calls.every(([options]) => !options.allowWrites)).toBe(true);
    for (const [options] of h.execute.mock.calls.filter(
      ([options]) => options.officeRole === 'chief',
    )) {
      const fullPrompt = CODEX_TASK_PREFIX + options.prompt;
      expect(fullPrompt).toContain('Puedes asignar encargos');
      expect(fullPrompt).not.toContain('No delegues');
    }
    const review = h.execute.mock.calls.find(([options]) => options.officeRole === 'tester')![0];
    expect(review.prompt).toContain(analysis);
    expect(review.prompt).toContain('Revisión independiente de las entregas de análisis');
    expect(review.prompt).not.toContain('OFFICE_REVIEW');
    expect(review.executionSessionKey).not.toBe(h.execute.mock.calls[1][0].executionSessionKey);
    expect(state.budgetReason).toBeNull();
  });
  it('keeps a failed unknown receipt while a new normal request verifies current quota instead of requiring historical token totals', async () => {
    const f = fixture(),
      h = await open(f, 'Respuesta', true),
      id = await h.setup();
    const execute = h.execute.getMockImplementation()!;
    h.execute.mockImplementationOnce(async (options) => ({
      ...(await execute(options)),
      id: randomUUID(),
      status: 'failed',
      reasonCode: 'cli_failed',
      inputTokens: null,
      outputTokens: null,
    }));
    await h.post('conversations/send', { id, message: 'Primer intento' });
    const failed = await h.settled();
    expect(failed.usageKnown).toBe(false);
    expect(failed.budgetReason).toBe('usage_unknown');
    const oldSample = JSON.parse(readFileSync(join(f.root, 'usage.json'), 'utf8')).samples[0];
    expect(oldSample.input).toBeNull();
    h.diagnose.mockClear();
    expect(
      (await h.post('conversations/send', { id, message: 'Nuevo encargo explícito' })).statusCode,
    ).toBe(200);
    const finished = await h.settled();
    expect(h.diagnose.mock.calls.length).toBeGreaterThan(1);
    expect(finished.tasks.at(-1)!.status).toBe('completed');
    expect(finished.usageKnown).toBe(false);
    expect(finished.runsUsed).toBe(2);
    expect(finished.tokensUsed).toBe(24);
    expect(JSON.parse(readFileSync(join(f.root, 'usage.json'), 'utf8')).samples[0]).toEqual(
      oldSample,
    );
    await expect(h.team.start()).rejects.toMatchObject({ code: 'usage_unknown' });
  });
  it('blocks current-quota recovery if verification fails and never resets the unknown history', async () => {
    const f = fixture(),
      h = await open(f, 'Respuesta', true),
      id = await h.setup();
    const root = (
      await h.post('conversations/prepare', { id, message: 'Continúa', officeMode: true })
    ).json<TeamSnapshot>().tasks[0];
    const file = join(f.root, 'checkpoint.json'),
      saved = JSON.parse(readFileSync(file, 'utf8'));
    saved.usageKnown = false;
    saved.budgetReason = 'usage_unknown';
    writeFileSync(file, JSON.stringify(saved));
    const reopened = await open(f, 'No ejecutar', true);
    reopened.diagnose.mockRejectedValue(
      new ExecutionBlocked('quota_unknown', 'Cuota no verificable'),
    );
    expect((await reopened.post('conversations/run-pending', { taskId: root.id })).statusCode).toBe(
      409,
    );
    expect(reopened.execute).not.toHaveBeenCalled();
    expect(reopened.team.snapshot().usageKnown).toBe(false);
    expect(() => reopened.team.resume()).toThrow();
  });
  it('recovers a zero-decision objective and leaves unfinished internal turns out of the next conversation request', async () => {
    const f = fixture(),
      h = await open(f, 'Respuesta', true),
      id = await h.setup();
    const root = (
      await h.post('conversations/prepare', {
        id,
        message: 'Analiza el proyecto',
        officeMode: true,
      })
    ).json<TeamSnapshot>().tasks[0];
    const file = join(f.root, 'checkpoint.json'),
      saved = JSON.parse(readFileSync(file, 'utf8'));
    saved.usageKnown = false;
    saved.budgetReason = null;
    saved.tasks[0].status = 'paused';
    saved.tasks[0].reasonCode = 'usage_unknown';
    saved.tasks.push({
      ...saved.tasks[0],
      id: randomUUID(),
      office: undefined,
      officeParentId: root.id,
      allowWrites: false,
      status: 'planned',
      reasonCode: null,
    });
    writeFileSync(file, JSON.stringify(saved));
    const reopened = await open(f, 'Respuesta', true);
    mockOffice(
      reopened,
      [
        {
          action: 'assign',
          role: 'architect',
          title: 'Analiza',
          task: 'Analiza el proyecto',
          message: 'Contexto',
        },
        {
          action: 'assign',
          role: 'tester',
          title: 'Revisa',
          task: 'Revisa las conclusiones',
          message: 'Revisión independiente',
        },
        { action: 'complete', message: 'Objetivo verificado' },
      ],
      () =>
        'Entrega verificada\nOFFICE_REVIEW {"findings":[]}\nOFFICE_RESULT {"status":"completed"}',
    );
    expect(reopened.execute).not.toHaveBeenCalled();
    expect((await reopened.post('conversations/run-pending', { taskId: root.id })).statusCode).toBe(
      200,
    );
    const finished = await reopened.settled();
    expect(finished.tasks.find((t) => t.id === root.id)!.status).toBe('completed');
    expect(finished.usageKnown).toBe(false);
    expect(reopened.execute).toHaveBeenCalledTimes(5);
    expect(
      (await reopened.post('conversations/send', { id, message: 'Siguiente encargo individual' }))
        .statusCode,
    ).toBe(200);
    expect((await reopened.settled()).tasks.at(-1)!.status).toBe('completed');
  });
  it.each([false, true])(
    'distinguishes an interrupted coordinator from an actual worker turn (worker: %s)',
    async (worker) => {
      const f = fixture(),
        h = await open(f, 'Respuesta', true),
        id = await h.setup();
      const root = (
        await h.post('conversations/prepare', { id, message: 'Analiza', officeMode: true })
      ).json<TeamSnapshot>().tasks[0];
      const file = join(f.root, 'checkpoint.json'),
        saved = JSON.parse(readFileSync(file, 'utf8'));
      saved.tasks[0].status = 'running';
      if (worker)
        saved.tasks.push({
          ...saved.tasks[0],
          id: randomUUID(),
          office: undefined,
          officeParentId: root.id,
          allowWrites: false,
        });
      writeFileSync(file, JSON.stringify(saved));
      const reopened = await open(f, 'No ejecutar', true);
      expect(reopened.team.snapshot().usageKnown).toBe(!worker);
      expect(reopened.execute).not.toHaveBeenCalled();
    },
  );
  it('recovers a legacy office blocked only by the Git requirement without dispatching or retaining an obsolete blocker', async () => {
    const f = fixture(),
      h = await open(f),
      id = await h.setup();
    await h.post('conversations/prepare', {
      id,
      message: 'Trabaja en esta carpeta',
      officeMode: true,
    });
    const checkpointFile = join(f.root, 'checkpoint.json');
    const checkpoint = JSON.parse(readFileSync(checkpointFile, 'utf8'));
    checkpoint.tasks[0].status = 'paused';
    checkpoint.tasks[0].reasonCode = 'review_git_required';
    checkpoint.tasks[0].output = 'La revisión por cambios necesita un repositorio Git verificable.';
    checkpoint.tasks[0].office.summary = checkpoint.tasks[0].output;
    writeFileSync(checkpointFile, JSON.stringify(checkpoint));
    const reopened = await open(f);
    expect(reopened.team.snapshot().tasks[0]).toMatchObject({
      status: 'paused',
      office: { phase: 'paused' },
    });
    expect(reopened.team.snapshot().tasks[0].output).toContain('sin crear un repositorio');
    expect(reopened.execute).not.toHaveBeenCalled();
    expect(
      reopened.library.snapshot().selected!.messages.find((m) => m.kind === 'response')!.content,
    ).toContain('Pulsa Ejecutar');
  });
  it('runs an already prepared objective with persistent project permissions and no extra consent fields', async () => {
    const f = fixture(),
      h = await open(f),
      id = await h.setup();
    const prepared = (
      await h.post('conversations/prepare', { id, message: 'Encargo ya preparado' })
    ).json<TeamSnapshot>().tasks[0];
    const reopened = await open(f);
    expect(reopened.team.snapshot().tasks[0].choice).toBeNull();
    expect(
      (await reopened.post('conversations/run-pending', { taskId: prepared.id })).statusCode,
    ).toBe(200);
    await reopened.settled();
    expect(reopened.execute).toHaveBeenCalledTimes(1);
    expect(reopened.execute.mock.calls[0][0].allowWrites).toBe(true);
    expect(reopened.library.snapshot().projects[0].autonomy).toBe(true);
  });
  it('sending authorizes project writes and quota once, persists autonomy, and never dispatches on restart', async () => {
    const f = fixture(),
      h = await open(f),
      id = await h.setup();
    expect(
      (await h.post('conversations/send', { id, message: 'Implementa el cambio' })).statusCode,
    ).toBe(200);
    await h.settled();
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.execute.mock.calls[0][0].allowWrites).toBe(true);
    expect(h.library.snapshot().projects[0].autonomy).toBe(true);
    expect(h.library.snapshot().checks!.checks.every((c) => c.approved)).toBe(true);
    const reopened = await open(f);
    expect(reopened.library.snapshot().projects[0].autonomy).toBe(true);
    expect(reopened.execute).not.toHaveBeenCalled();
    expect(
      (await reopened.post('conversations/send', { id, message: 'Continúa con otra mejora' }))
        .statusCode,
    ).toBe(200);
    await reopened.settled();
    expect(reopened.execute).toHaveBeenCalledTimes(1);
    expect(reopened.execute.mock.calls[0][0].allowWrites).toBe(true);
  });

  it('retains manual project selection, actual pauses, quota checks and local control protection', async () => {
    const f = fixture(),
      h = await open(f),
      id = await h.setup();
    const projectId = h.library.snapshot().selectedProjectId;
    await h.post('projects/autonomy', { projectId, enabled: false });
    expect((await h.post('conversations/send', { id, message: 'No ejecutes' })).statusCode).toBe(
      409,
    );
    expect(h.execute).not.toHaveBeenCalled();
    await h.post('projects/autonomy', { projectId, enabled: true });
    h.team.pause();
    expect(
      (await h.post('conversations/send', { id, message: 'No reanudar la pausa' })).statusCode,
    ).toBe(409);
    expect(h.execute).not.toHaveBeenCalled();
    const external = await h.app.inject({
      method: 'POST',
      url: '/api/team/conversations/send',
      headers: h.headers,
      payload: { id, message: 'Sin control local' },
    });
    expect(external.statusCode).toBe(403);
    const reopened = await open(f);
    reopened.diagnose.mockRejectedValue(new ExecutionBlocked('quota_unknown', 'Cuota desconocida'));
    reopened.team.resume();
    expect(
      (await reopened.post('conversations/send', { id, message: 'Revisa cuota' })).statusCode,
    ).toBe(409);
    expect(reopened.execute).not.toHaveBeenCalled();
  });
  it('does not dispatch another employee when subscription verification fails after the chief delivery', async () => {
    const f = fixture(),
      h = await open(f, 'Respuesta', true),
      id = await h.setup();
    mockOffice(h, [
      {
        action: 'assign',
        role: 'architect',
        title: 'Analiza',
        task: 'Analiza el contrato',
        message: 'Necesita contexto',
      },
    ]);
    const execute = h.execute.getMockImplementation()!;
    h.execute.mockImplementation(async (options) => {
      const receipt = await execute(options);
      h.diagnose.mockRejectedValue(
        new ExecutionBlocked('quota_unverified', 'No se puede verificar la cuota'),
      );
      return receipt;
    });
    const root = (
      await h.post('conversations/prepare', {
        id,
        message: 'Explica el proyecto',
        officeMode: true,
      })
    ).json<TeamSnapshot>().tasks[0];
    await h.post('conversations/execute', { taskId: root.id, quotaConfirmed: true });
    expect((await h.settled()).tasks[0].status).toBe('paused');
    expect(h.execute).toHaveBeenCalledTimes(1);
  });
  it.each(['cancel', 'pause', 'shutdown'] as const)(
    'stops autonomous dispatch on %s and never restores consent after restart',
    async (action) => {
      const f = fixture(),
        h = await open(f, 'Respuesta', true),
        id = await h.setup();
      let release!: () => void;
      h.execute.mockImplementation(async (options) => {
        await new Promise<void>((resolve) => {
          release = resolve;
          options.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        return {
          version: 1,
          id: randomUUID(),
          provider: 'codex',
          billing: 'subscription-only',
          status: 'cancelled',
          project: options.project,
          requestedModel: options.model!,
          requestedEffort: options.effort!,
          confirmedModel: null,
          sessionId: randomUUID(),
          startedAt: Date.now(),
          updatedAt: Date.now(),
          reasonCode: 'cancelled_by_user',
          inputTokens: 20,
          outputTokens: 4,
        };
      });
      const root = (
        await h.post('conversations/prepare', {
          id,
          message: 'Analiza el contrato',
          officeMode: true,
        })
      ).json<TeamSnapshot>().tasks[0];
      await h.post('conversations/execute', { taskId: root.id, quotaConfirmed: true });
      await vi.waitFor(() => expect(h.execute).toHaveBeenCalledTimes(1));
      if (action === 'shutdown') await h.team.shutdown();
      else if (action === 'pause') h.team.pause();
      else h.team.cancel(root.id);
      release();
      const state = await h.settled();
      expect(state.tasks[0].status).toBe(action === 'cancel' ? 'cancelled' : 'paused');
      expect(h.execute).toHaveBeenCalledTimes(1);
      const reopened = await open(f, 'No debe ejecutarse', true);
      expect(reopened.team.snapshot().running).toBe(false);
      expect(reopened.execute).not.toHaveBeenCalled();
      expect((await reopened.post('start', { taskId: root.id })).statusCode).not.toBe(200);
      expect(reopened.execute).not.toHaveBeenCalled();
    },
  );
  it('runs an autonomous chief/employee/reviewer cycle with one objective consent and visible handoffs', async () => {
    const f = fixture(),
      h = await open(f, 'Respuesta', true),
      id = await h.setup();
    mockOffice(h, [
      {
        action: 'assign',
        role: 'architect',
        title: 'Análisis',
        task: 'Analiza el contrato. '.repeat(500),
        message: 'Investiga primero',
      },
      {
        action: 'assign',
        role: 'tester',
        title: 'Verificación',
        task: 'Verifica el análisis',
        message: 'Comprueba las evidencias',
      },
      { action: 'complete', message: 'Objetivo explicado y revisado' },
    ]);
    const prepared = await h.post('conversations/prepare', {
      id,
      message: 'Explica el proyecto. '.repeat(500),
      officeMode: true,
    });
    const root = prepared.json<TeamSnapshot>().tasks[0];
    expect(root.office?.phase).toBe('prepared');
    expect(h.execute).not.toHaveBeenCalled();
    expect(
      (await h.post('conversations/execute', { taskId: root.id, quotaConfirmed: true })).statusCode,
    ).toBe(200);
    const state = await h.settled();
    expect(state.tasks.find((t) => t.id === root.id)).toMatchObject({
      status: 'completed',
      office: { phase: 'completed', rounds: 3 },
    });
    expect(h.execute.mock.calls.map(([o]) => o.officeRole)).toEqual([
      'chief',
      'architect',
      'chief',
      'tester',
      'chief',
    ]);
    expect(h.execute.mock.calls.every(([o]) => !o.allowWrites && o.timeoutMs === null)).toBe(true);
    expect(h.execute.mock.calls[2][0].prompt).toContain('Entrega verificable del empleado');
    expect(h.execute.mock.calls[3][0].executionSessionKey).not.toBe(
      h.execute.mock.calls[1][0].executionSessionKey,
    );
    expect(state.library!.selected!.messages.some((m) => m.role === 'architect')).toBe(true);
    expect(
      state.library!.selected!.messages.find((m) => m.id === `${root.id}-response`)?.content,
    ).toContain('aprobación final');
    const reopened = await open(f, 'No ejecutar', true);
    expect(reopened.team.snapshot().budgetReason).not.toBe('checkpoint_invalid');
    expect(reopened.team.snapshot().tasks[0].status).toBe('completed');
    expect(reopened.execute).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'repairs failed local checks and reviews the final write (Git: %s)',
    async (withGit) => {
      const f = fixture();
      writeFileSync(
        join(f.project, 'package.json'),
        JSON.stringify({ scripts: { test: 'node check.cjs' } }),
      );
      writeFileSync(
        join(f.project, 'check.cjs'),
        "const fs=require('node:fs');process.exit(fs.existsSync('result.txt')&&fs.readFileSync('result.txt','utf8')==='ready'?0:1)",
      );
      if (withGit) initOfficeGit(f.project);
      const h = await open(f, 'Respuesta', true),
        id = await h.setup();
      let writes = 0;
      mockOffice(
        h,
        [
          {
            action: 'assign',
            role: 'developer',
            title: 'Implementa',
            task: 'Implementa el resultado',
            message: 'Primer intento',
          },
          {
            action: 'assign',
            role: 'developer',
            title: 'Repara',
            task: 'Corrige la prueba fallida',
            message: 'La comprobación falló',
          },
          {
            action: 'assign',
            role: 'tester',
            title: 'Revisa',
            task: 'Revisa el diff final',
            message: 'Verificación independiente',
          },
          { action: 'complete', message: 'Resultado reparado y comprobado' },
        ],
        (options) => {
          if (options.officeRole === 'developer')
            writeFileSync(join(f.project, 'result.txt'), ++writes === 1 ? 'broken' : 'ready');
          return 'Entrega\nOFFICE_REVIEW {"findings":[]}\nOFFICE_RESULT {"status":"completed"}';
        },
      );
      const root = (
        await h.post('conversations/send', {
          id,
          message: 'Crea result.txt con ready',
          officeMode: true,
        })
      ).json<TeamSnapshot>().tasks[0];
      expect(root.role).toBe('chief');
      const state = await h.settled();
      expect(state.tasks[0].status).toBe('completed');
      expect(state.tasks.filter((t) => t.role === 'developer').map((t) => t.status)).toEqual([
        'failed',
        'completed',
      ]);
      expect(
        state.tasks.filter((t) => t.role === 'developer').map((t) => t.localChecks?.[0]?.passed),
      ).toEqual([false, true]);
      expect(
        h.execute.mock.calls.filter(([o]) => o.allowWrites).map(([o]) => o.officeRole),
      ).toEqual(['developer', 'developer']);
      expect(h.execute.mock.calls.find(([o]) => o.officeRole === 'tester')![0].prompt).toContain(
        'diff',
      );
      expect(readFileSync(join(f.project, 'result.txt'), 'utf8')).toBe('ready');
      const reopened = await open(f, 'No ejecutar', true);
      expect(reopened.team.snapshot().budgetReason).not.toBe('checkpoint_invalid');
      expect(reopened.team.snapshot().tasks[0]).toMatchObject({
        status: 'completed',
        role: 'chief',
        allowWrites: true,
      });
      expect(reopened.execute).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ action: 'complete', message: 'Sin evidencia' }, 'office_completion_unverified'],
    [{ action: 'human', message: 'Necesito una decisión creativa' }, 'office_human_required'],
    [
      {
        action: 'assign',
        role: 'developer',
        title: 'Escribe',
        task: 'Cambia archivos',
        message: 'Ampliar permisos',
      },
      'office_writes_not_authorized',
    ],
  ])(
    'stops the office for an unverified completion or missing human authority',
    async (decision, reason) => {
      const f = fixture(),
        h = await open(f, 'Respuesta', true),
        id = await h.setup();
      mockOffice(h, [decision]);
      const root = (
        await h.post('conversations/prepare', { id, message: 'Solo analiza', officeMode: true })
      ).json<TeamSnapshot>().tasks[0];
      await h.post('conversations/execute', { taskId: root.id, quotaConfirmed: true });
      expect((await h.settled()).tasks[0]).toMatchObject({ status: 'paused', reasonCode: reason });
      expect(h.execute).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [
      'Describe esta imagen y resume el proyecto. No modifiques archivos. Termina con cinco puntos.',
      'completed',
    ],
    ['Resume el proyecto completo.', 'paused'],
    ['Explica el botón y modifica el código.', 'paused'],
    ['Resume y publica el resultado.', 'paused'],
  ])(
    'keeps a direct answer proportionate without waiving review for %s',
    async (message, status) => {
      const f = fixture(),
        h = await open(f, 'Respuesta', true),
        id = await h.setup();
      mockOffice(h, [
        { action: 'complete', message: 'Cinco puntos basados en la imagen y el contexto.' },
      ]);
      const root = (
        await h.post('conversations/prepare', { id, message, officeMode: true, allowWrites: true })
      ).json<TeamSnapshot>().tasks[0];
      await h.post('conversations/execute', {
        taskId: root.id,
        quotaConfirmed: true,
        writesConfirmed: true,
      });
      const result = (await h.settled()).tasks[0];
      expect(result.status).toBe(status);
      expect(h.execute).toHaveBeenCalledTimes(1);
      if (status === 'completed') expect(result.output).not.toContain('revisión del Tester');
      else expect(result.reasonCode).toBe('office_completion_unverified');
    },
  );

  it('answers a summary and two follow-ups in the same chat with one Chief execution each', async () => {
    const f = fixture(),
      h = await open(f, 'Respuesta', true),
      id = await h.setup();
    mockOffice(h, [
      { action: 'complete', message: 'Resumen de la imagen y el proyecto.' },
      { action: 'complete', message: 'Pasos siguientes basados en el resumen.' },
      { action: 'complete', message: 'Versión final en cinco puntos.' },
    ]);
    for (const [index, message] of [
      'Describe esta imagen y resume el proyecto. No modifiques archivos.',
      'Incluye también los siguientes pasos.',
      'Reformúlalo en cinco puntos.',
    ].entries()) {
      const prepared = (
        await h.post('conversations/prepare', { id, message, officeMode: true, allowWrites: true })
      ).json<TeamSnapshot>();
      const root = prepared.tasks.filter((t) => !t.officeParentId).at(-1)!;
      await h.post('conversations/execute', {
        taskId: root.id,
        quotaConfirmed: true,
        writesConfirmed: true,
      });
      const state = await h.settled();
      expect(state.tasks.find((t) => t.id === root.id)?.status).toBe('completed');
      expect(h.execute).toHaveBeenCalledTimes(index + 1);
      expect(h.execute.mock.calls.at(-1)![0].officeRole).toBe('chief');
      if (index > 0)
        expect(h.execute.mock.calls.at(-1)![0].prompt).toContain(
          'Resumen de la imagen y el proyecto.',
        );
    }
  });

  it('does not accept a direct explanation when source files changed during the turn', async () => {
    const f = fixture(),
      h = await open(f, 'Respuesta', true),
      id = await h.setup();
    mockOffice(h, [{ action: 'complete', message: 'Resumen' }]);
    const execute = h.execute.getMockImplementation()!;
    h.execute.mockImplementation(async (options) => {
      const receipt = await execute(options);
      writeFileSync(join(f.project, 'unexpected.ts'), '// changed outside the read-only chief');
      return receipt;
    });
    const root = (
      await h.post('conversations/prepare', {
        id,
        message: 'Resume este proyecto brevemente.',
        officeMode: true,
        allowWrites: true,
      })
    ).json<TeamSnapshot>().tasks[0];
    await h.post('conversations/execute', {
      taskId: root.id,
      quotaConfirmed: true,
      writesConfirmed: true,
    });
    expect((await h.settled()).tasks[0]).toMatchObject({
      status: 'paused',
      reasonCode: 'office_completion_unverified',
    });
  });

  it('stops repeated worker deliveries without progress rather than spinning indefinitely', async () => {
    const f = fixture(),
      h = await open(f, 'Respuesta', true),
      id = await h.setup();
    mockOffice(h, [
      {
        action: 'assign',
        role: 'architect',
        title: 'Repite',
        task: 'Analiza lo mismo',
        message: 'Repetición',
      },
    ]);
    const root = (
      await h.post('conversations/prepare', { id, message: 'Analiza', officeMode: true })
    ).json<TeamSnapshot>().tasks[0];
    await h.post('conversations/execute', { taskId: root.id, quotaConfirmed: true });
    expect((await h.settled()).tasks[0]).toMatchObject({
      status: 'paused',
      reasonCode: 'office_no_progress',
    });
    expect(h.execute).toHaveBeenCalledTimes(6);
  });
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

  it('prepares a chat turn without inference, rejects missing consent and runs only the confirmed turn', async () => {
    const f = fixture(),
      h = await open(f);
    const older = await h.setup();
    await h.post('conversations/message', { id: older, message: 'Este encargo sigue en la cola' });
    const projectId = h.library.snapshot().selectedProjectId!;
    await h.post('conversations', { projectId });
    const id = h.library.snapshot().selected!.id;
    const prepared = await h.post('conversations/prepare', { id, message: 'Solo este mensaje' });
    expect(prepared.statusCode).toBe(200);
    const task = prepared.json<TeamSnapshot>().tasks.at(-1)!;
    expect(task).toMatchObject({
      requiresConfirmation: true,
      allowWrites: false,
      status: 'planned',
    });
    expect(h.execute).not.toHaveBeenCalled();
    expect(
      (await h.post('conversations/execute', { taskId: task.id, quotaConfirmed: false })).json()
        .code,
    ).toBe('quota_confirmation_required');
    expect(
      (await h.post('conversations/execute', { taskId: task.id, quotaConfirmed: true })).statusCode,
    ).toBe(200);
    const state = await h.settled();
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.execute.mock.calls[0][0]).toMatchObject({ allowWrites: false });
    expect(state.tasks[0].status).toBe('planned');
    expect(state.tasks[1].status).toBe('completed');
  });

  it('cannot start a prepared conversation through the generic queue without its confirmation', async () => {
    const f = fixture(),
      h = await open(f),
      id = await h.setup();
    await h.post('conversations/prepare', {
      id,
      message: 'Todavía no autorizado',
      allowWrites: true,
    });
    await h.post('start');
    await h.settled();
    expect(h.execute).not.toHaveBeenCalled();
    const task = h.team.snapshot().tasks[0];
    expect(
      (
        await h.post('conversations/execute', {
          taskId: task.id,
          quotaConfirmed: true,
          writesConfirmed: false,
        })
      ).json().code,
    ).toBe('write_confirmation_required');
    expect(
      (
        await h.post('conversations/execute', {
          taskId: task.id,
          quotaConfirmed: true,
          writesConfirmed: true,
        })
      ).statusCode,
    ).toBe(200);
    await h.settled();
    expect(h.execute.mock.calls[0][0].allowWrites).toBe(true);
  });

  it('persists TURBO only for the selected project without granting quota consent', async () => {
    const f = fixture(),
      first = await open(f),
      id = await first.setup();
    const projectId = first.library.snapshot().selectedProjectId!;
    await first.post('projects/turbo', { projectId, enabled: true });
    await first.app.close();
    const h = await open(f);
    expect(h.library.project(projectId).turbo).toBe(true);
    const response = await h.post('conversations/prepare', { id, message: 'Mensaje TURBO' });
    const task = response.json<TeamSnapshot>().tasks[0];
    expect(task.allowWrites).toBe(true);
    expect(h.execute).not.toHaveBeenCalled();
    expect(
      (await h.post('conversations/execute', { taskId: task.id, writesConfirmed: true })).json()
        .code,
    ).toBe('quota_confirmation_required');
    expect(
      (
        await h.post('conversations/execute', {
          taskId: task.id,
          quotaConfirmed: true,
          resumeConfirmed: true,
        })
      ).statusCode,
    ).toBe(200);
    await h.settled();
    expect(h.execute.mock.calls[0][0].allowWrites).toBe(true);
    const other = join(f.root, 'second');
    mkdirSync(other);
    await h.post('projects', { project: other, openConversation: true });
    const second = h.library.snapshot();
    expect(second.projects.find((p) => p.id === second.selectedProjectId)?.turbo).not.toBe(true);
    const prepared = await h.post('conversations/prepare', {
      id: second.selected!.id,
      message: 'Otro proyecto',
    });
    expect(prepared.json<TeamSnapshot>().tasks.at(-1)?.allowWrites).toBe(false);
  });

  it('TURBO neither bypasses subscription failures nor authorizes itself through project registration', async () => {
    const f = fixture(),
      h = await open(f),
      id = await h.setup();
    await h.post('projects', { project: f.project, turbo: true });
    const projectId = h.library.snapshot().selectedProjectId!;
    expect(h.library.project(projectId).turbo).not.toBe(true);
    await h.post('projects/turbo', { projectId, enabled: true });
    h.diagnose.mockRejectedValue(new ExecutionBlocked('quota_limit', 'Cuota no disponible.'));
    const prepared = await h.post('conversations/prepare', { id, message: 'No debe ejecutar' });
    const task = prepared.json<TeamSnapshot>().tasks[0];
    expect(task.choice).toBeNull();
    expect(
      (await h.post('conversations/execute', { taskId: task.id, quotaConfirmed: true })).statusCode,
    ).toBe(409);
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('revoking TURBO restores the file confirmation requirement for an already prepared turn', async () => {
    const f = fixture(),
      h = await open(f),
      id = await h.setup();
    const projectId = h.library.snapshot().selectedProjectId!;
    await h.post('projects/turbo', { projectId, enabled: true });
    const response = await h.post('conversations/prepare', { id, message: 'Preparado con TURBO' });
    const task = response.json<TeamSnapshot>().tasks[0];
    await h.post('projects/turbo', { projectId, enabled: false });
    expect(
      (await h.post('conversations/execute', { taskId: task.id, quotaConfirmed: true })).json()
        .code,
    ).toBe('write_confirmation_required');
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('requires fresh confirmation after restart, including when TURBO stays enabled', async () => {
    const f = fixture(),
      first = await open(f),
      id = await first.setup();
    await first.post('projects/turbo', {
      projectId: first.library.snapshot().selectedProjectId,
      enabled: true,
    });
    await first.post('conversations/prepare', { id, message: 'Pendiente al cerrar' });
    await first.app.close();
    const h = await open(f);
    await h.post('resume');
    await h.post('start');
    await h.settled();
    expect(h.team.snapshot().tasks[0].requiresConfirmation).toBe(true);
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('keeps explicitly selected manual budget review mandatory, even with TURBO', async () => {
    const f = fixture(),
      h = await open(f, 'Respuesta', true),
      id = await h.setup();
    await h.post('projects/turbo', {
      projectId: h.library.snapshot().selectedProjectId,
      enabled: true,
    });
    const prepared = await h.post('conversations/prepare', {
      id,
      message: 'Explica el contrato sin editar',
      budgetMode: 'manual',
    });
    const task = prepared.json<TeamSnapshot>().tasks[0];
    expect(task.estimate?.tokens).toBeNull();
    const blocked = await h.post('conversations/execute', {
      taskId: task.id,
      quotaConfirmed: true,
    });
    expect(blocked.json().code).toBe('budget_review_required');
    expect(h.execute).not.toHaveBeenCalled();
    expect(
      (
        await h.post('budget-review', {
          id: task.id,
          tokens: 1000,
          durationMs: 10000,
          maxContextCharacters: 90000,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await h.post('conversations/execute', {
          taskId: task.id,
          quotaConfirmed: true,
          resumeConfirmed: true,
        })
      ).statusCode,
    ).toBe(200);
    await h.settled();
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.team.snapshot().settings.maxTokens).toBe(30000);
  });

  it('executes normal chat without samples or manual estimates beyond queue caps, retaining real usage', async () => {
    const f = fixture(),
      h = await open(f, 'Respuesta', true),
      id = await h.setup();
    h.team.configure({ ...h.team.snapshot().settings, maxTokens: 1000, maxRuns: 1 });
    h.execute.mockImplementation(async (options) => {
      expect(options.maxReportedTokens).toBeUndefined();
      expect(options.timeoutMs).toBeNull();
      options.onOutput?.('Respuesta\nOFFICE_RESULT {"status":"completed"}');
      return {
        version: 1,
        id: `normal-${h.execute.mock.calls.length}`,
        provider: 'codex',
        billing: 'subscription-only',
        status: 'completed',
        project: options.project,
        requestedModel: options.model!,
        requestedEffort: options.effort!,
        confirmedModel: null,
        sessionId: 'normal',
        startedAt: Date.now(),
        updatedAt: Date.now(),
        reasonCode: null,
        inputTokens: 1500,
        outputTokens: 100,
      };
    });
    for (const message of ['Primero', 'Segundo']) {
      const prepared = await h.post('conversations/prepare', { id, message });
      const task = prepared.json<TeamSnapshot>().tasks.at(-1)!;
      expect(task.budgetMode).toBe('codex');
      expect(task.estimate?.tokens).toBeNull();
      expect(
        (await h.post('conversations/execute', { taskId: task.id, quotaConfirmed: true }))
          .statusCode,
      ).toBe(200);
      expect((await h.settled()).tasks.at(-1)?.status).toBe('completed');
    }
    expect(h.execute).toHaveBeenCalledTimes(2);
    expect(h.team.snapshot().tokensUsed).toBe(3200);
    expect(h.team.snapshot().settings.maxTokens).toBe(1000);
    expect(h.team.snapshot().settings.maxRuns).toBe(1);
    // The queue still obeys its existing explicit budget.
    expect((await h.post('start')).statusCode).toBe(409);
  });

  it('normal chat retains quota, explicit pause and file consent, and cannot forge the mode through queue input', async () => {
    const f = fixture(),
      h = await open(f, 'Respuesta', true),
      id = await h.setup();
    expect(
      (await h.post('conversations/prepare', { id, message: 'No válido', budgetMode: 'unlimited' }))
        .statusCode,
    ).toBe(409);
    const prepared = await h.post('conversations/prepare', {
      id,
      message: 'Revisa',
      allowWrites: true,
    });
    const task = prepared.json<TeamSnapshot>().tasks.at(-1)!;
    expect(
      (await h.post('conversations/execute', { taskId: task.id, writesConfirmed: true })).json()
        .code,
    ).toBe('quota_confirmation_required');
    expect(
      (await h.post('conversations/execute', { taskId: task.id, quotaConfirmed: true })).json()
        .code,
    ).toBe('write_confirmation_required');
    await h.post('pause');
    expect(
      (
        await h.post('conversations/execute', {
          taskId: task.id,
          quotaConfirmed: true,
          writesConfirmed: true,
        })
      ).json().code,
    ).toBe('resume_confirmation_required');
    expect(h.execute).not.toHaveBeenCalled();
    h.diagnose.mockRejectedValue(new ExecutionBlocked('quota_unknown', 'No verificable'));
    await h.post('conversations/execute', {
      taskId: task.id,
      quotaConfirmed: true,
      writesConfirmed: true,
      resumeConfirmed: true,
    });
    expect((await h.settled()).tasks.at(-1)?.reasonCode).toBe('quota_unknown');
    expect(h.execute).not.toHaveBeenCalled();
    const queued = await h.post('tasks', {
      role: 'developer',
      project: f.project,
      title: 'Cola',
      prompt: 'Lee',
      budgetMode: 'codex',
      requiresConfirmation: true,
      conversationId: id,
    });
    expect(queued.json<TeamSnapshot>().tasks.at(-1)?.budgetMode).toBeUndefined();
  });

  it('restores normal chat mode but never restores execution consent after restart', async () => {
    const f = fixture(),
      first = await open(f, 'Respuesta', true),
      id = await first.setup();
    await first.post('conversations/prepare', { id, message: 'Continuar después' });
    await first.app.close();
    const h = await open(f, 'Respuesta', true);
    expect(h.team.snapshot().tasks[0].budgetMode).toBe('codex');
    await h.post('resume');
    await h.post('start');
    await h.settled();
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('migrates legacy prepared chat to normal mode without dispatching or altering manual selection', async () => {
    const f = fixture(),
      first = await open(f, 'Respuesta', true),
      id = await first.setup();
    await first.post('conversations/prepare', { id, message: 'Mensaje anterior' });
    await first.post('conversations', { projectId: first.library.snapshot().selectedProjectId });
    await first.post('conversations/prepare', {
      id: first.library.snapshot().selected!.id,
      message: 'Manual explícito',
      budgetMode: 'manual',
    });
    const checkpoint = join(f.root, 'checkpoint.json');
    await first.app.close();
    const saved = JSON.parse(readFileSync(checkpoint, 'utf8'));
    delete saved.tasks[0].budgetMode;
    writeFileSync(checkpoint, JSON.stringify(saved));
    const h = await open(f, 'Respuesta', true);
    expect(h.team.snapshot().tasks[0]).toMatchObject({ budgetMode: 'codex', status: 'paused' });
    expect(h.team.snapshot().tasks[1].budgetMode).toBe('manual');
    expect(h.execute).not.toHaveBeenCalled();
    const task = h.team.snapshot().tasks[0];
    expect(
      (await h.post('conversations/execute', { taskId: task.id, quotaConfirmed: true })).statusCode,
    ).toBe(409);
    expect(h.execute).not.toHaveBeenCalled();
  });

  it('requires the local control nonce on chat execution, TURBO, and project selection', async () => {
    const f = fixture(),
      h = await open(f);
    for (const route of [
      'conversations/prepare',
      'conversations/execute',
      'projects/turbo',
      'projects/select',
      'projects/pick-folder',
    ])
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
    expect(h.execute).not.toHaveBeenCalled();
  });
  it('rejects a stale confirmation summary when model, file permissions or limits change', async () => {
    const f = fixture(),
      h = await open(f),
      id = await h.setup();
    const prepared = await h.post('conversations/prepare', {
      id,
      message: 'Confirma lo que he revisado',
    });
    const task = prepared.json<TeamSnapshot>().tasks[0];
    h.team.configure({ ...h.team.snapshot().settings, maxRuns: 5 });
    await h.post('assign', { id: task.id });
    const response = await h.post('conversations/execute', {
      taskId: task.id,
      quotaConfirmed: true,
      fingerprint: task.confirmationFingerprint,
    });
    expect(response.json().code).toBe('confirmation_changed');
    expect(h.execute).not.toHaveBeenCalled();
  });
});
