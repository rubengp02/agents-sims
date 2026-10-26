import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdaptiveRuntime } from '../src/execution/adaptiveRuntime.js';
import { ConversationLibrary } from '../src/execution/conversationLibrary.js';
import { DisabledExecutor } from '../src/execution/optionalExecutors.js';
import { TeamCoordinator } from '../src/execution/teamCoordinator.js';
import type { ExecuteOptions, OfficialExecutor, RunRecord } from '../src/execution/types.js';
import { UsageHistory } from '../src/execution/usageHistory.js';

const roots: string[] = [];
const teams: TeamCoordinator[] = [];
afterEach(async () => {
  await Promise.all(teams.splice(0).map((team) => team.shutdown()));
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});
const request = (message: string, officeMode = false) => ({
  inputId: randomUUID(),
  message,
  officeMode,
});
function receipt(options: ExecuteOptions, status: RunRecord['status'] = 'completed'): RunRecord {
  return {
    version: 1,
    id: randomUUID(),
    provider: 'codex',
    engine: 'codex-app-server',
    billing: 'subscription-only',
    status,
    project: options.project,
    requestedModel: options.model!,
    requestedEffort: options.effort!,
    confirmedModel: options.model!,
    sessionId: randomUUID(),
    startedAt: Date.now(),
    updatedAt: Date.now(),
    reasonCode: status === 'cancelled' ? (options.interruptionReason?.() ?? 'cancelled') : null,
    inputTokens: 10,
    outputTokens: 5,
  };
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'office-queue-integration-'));
  roots.push(root);
  const project = join(root, 'project');
  mkdirSync(project);
  const library = new ConversationLibrary(join(root, 'history'));
  const projectId = library.register(project).id;
  library.setAutonomy(projectId, true);
  const id = library.create(projectId).id;
  const runs: Array<{ options: ExecuteOptions; finish: (output?: string) => void }> = [];
  const execute = vi.fn<OfficialExecutor['execute']>(
    (options) =>
      new Promise((resolve) => {
        const finish = (output = 'Entrega\nOFFICE_RESULT {"status":"completed"}') => {
          options.onOutput?.(output);
          resolve(receipt(options));
        };
        runs.push({ options, finish });
        options.signal?.addEventListener('abort', () => resolve(receipt(options, 'cancelled')), {
          once: true,
        });
      }),
  );
  const steer = vi.fn<NonNullable<OfficialExecutor['steer']>>(async () => ({ status: 'accepted' }));
  const executor: OfficialExecutor = {
    provider: 'codex',
    engine: 'codex-app-server',
    supportsSteering: true,
    steer,
    execute,
    diagnose: async () => ({
      checkedAt: Date.now(),
      plan: 'plus',
      quota: [],
      models: [{ id: 'gpt-6.1-sol', efforts: ['low', 'medium', 'high'] }],
    }),
  };
  const team = new TeamCoordinator(
    { codex: executor, claude: new DisabledExecutor('claude') },
    undefined,
    undefined,
    undefined,
    undefined,
    join(root, 'checkpoint.json'),
    new AdaptiveRuntime(new UsageHistory(join(root, 'usage.json')), join(root, 'artifacts')),
    library,
  );
  teams.push(team);
  return { team, library, id, projectId, project, root, runs, execute, steer, executor };
}

describe('conversation queue and live redirection integration (mock official executor)', () => {
  it('recovers server-owned check evidence when finishing an implementation after a restart', async () => {
    const h = fixture();
    // This case starts real npm children; the default 1s wait is too short when
    // the whole suite competes for process startup and filesystem access.
    const untilRuns = (count: number) =>
      vi.waitFor(() => expect(h.runs).toHaveLength(count), { timeout: 10_000 });
    writeFileSync(
      join(h.project, 'package.json'),
      JSON.stringify({
        private: true,
        scripts: { test: 'node -e "console.log(42)"' },
      }),
    );
    await h.team.queueConversation(h.id, request('Implementa un módulo y revisa su prueba', true));
    await untilRuns(1);
    h.runs[0].finish(
      'OFFICE_DECISION {"action":"assign","role":"developer","title":"Implementar","task":"Crea result.cjs","message":"Cambio pequeño"}',
    );
    await untilRuns(2);
    writeFileSync(join(h.project, 'result.cjs'), 'module.exports = 42;');
    h.runs[1].finish();
    await untilRuns(3);
    h.runs[2].finish(
      'OFFICE_DECISION {"action":"human","message":"¿Continúo con la revisión?","responseType":"text"}',
    );
    await h.team.waitUntilIdle();
    const original = h.team.snapshot().tasks.find((t) => t.office)!;
    await h.team.shutdown();
    const restored = new TeamCoordinator(
      { codex: h.executor, claude: new DisabledExecutor('claude') },
      undefined,
      undefined,
      undefined,
      undefined,
      join(h.root, 'checkpoint.json'),
      new AdaptiveRuntime(new UsageHistory(join(h.root, 'usage.json')), join(h.root, 'artifacts')),
      new ConversationLibrary(join(h.root, 'history')),
    );
    teams.push(restored);
    await restored.answerOfficeQuestion(original.id, original.humanRequest!.id, 'Continuar');
    await untilRuns(4);
    h.runs[3].finish(
      'OFFICE_DECISION {"action":"assign","role":"tester","title":"Revisar","task":"Revisión independiente","message":"Contrastar el resultado"}',
    );
    await untilRuns(5);
    h.runs[4].finish('OFFICE_REVIEW {"findings":[]}\nOFFICE_RESULT {"status":"completed"}');
    await untilRuns(6);
    expect(h.runs[5].options.prompt).toContain('"passed":true');
    h.runs[5].finish(
      'OFFICE_DECISION {"action":"complete","message":"Cambio revisado y comprobado"}',
    );
    await restored.waitUntilIdle();
    const delivered = restored.snapshot().tasks.find((t) => t.id === original.id)!;
    expect(delivered.status).toBe('completed');
    expect(delivered.finalEvidence?.checks).toEqual([
      expect.objectContaining({ id: 'test', passed: true, exitCode: 0 }),
    ]);
    expect(delivered.finalEvidence?.limitations.join(' ')).not.toContain(
      'No hay comprobaciones locales',
    );
  }, 30_000);
  it('waits for an individual receipt without snapshot polling or cancelling the run', async () => {
    const h = fixture();
    await h.team.queueConversation(h.id, request('Implementa el encargo'));
    await vi.waitFor(() => expect(h.runs).toHaveLength(1));
    const snapshot = vi.spyOn(h.team, 'snapshot');
    let finished = false;
    const waiting = h.team.waitUntilIdle().then(() => {
      finished = true;
    });
    h.runs[0].options.onState?.(receipt(h.runs[0].options));
    await new Promise((resolve) => setImmediate(resolve));
    expect(finished).toBe(false);
    expect(h.runs[0].options.signal?.aborted).toBe(false);
    expect(snapshot).not.toHaveBeenCalled();
    h.runs[0].finish();
    await waiting;
    expect(h.runs[0].options.signal?.aborted).toBe(false);
    snapshot.mockRestore();
    expect(h.team.snapshot().tasks[0].status).toBe('completed');
    expect(h.team.snapshot().running).toBe(false);
    const count = h.runs.length;
    await h.team.waitUntilIdle();
    expect(h.runs).toHaveLength(count);
  });
  it('waits across employee turns and the final Chief receipt without restarting work', async () => {
    const h = fixture();
    await h.team.queueConversation(h.id, request('Implementa y revisa el objetivo', true));
    await vi.waitFor(() => expect(h.runs).toHaveLength(1));
    const snapshot = vi.spyOn(h.team, 'snapshot').mockImplementation(() => {
      throw Object.assign(new Error('Simulated observer failure'), { code: 'EBUSY' });
    });
    let finished = false;
    const waiting = h.team.waitUntilIdle().then(() => {
      finished = true;
    });
    h.runs[0].finish(
      'OFFICE_DECISION {"action":"assign","role":"developer","title":"Implementar","task":"Implementa el objetivo sin ampliar alcance","message":"Programación"}',
    );
    await vi.waitFor(() => expect(h.runs).toHaveLength(2));
    expect(finished).toBe(false);
    h.runs[1].finish();
    await vi.waitFor(() => expect(h.runs).toHaveLength(3));
    expect(finished).toBe(false);
    h.runs[2].finish(
      'OFFICE_DECISION {"action":"assign","role":"tester","title":"Revisar","task":"Revisión independiente sin editar","message":"Revisión"}',
    );
    await vi.waitFor(() => expect(h.runs).toHaveLength(4));
    expect(finished).toBe(false);
    h.runs[3].finish('OFFICE_REVIEW {"findings":[]}\nOFFICE_RESULT {"status":"completed"}');
    await vi.waitFor(() => expect(h.runs).toHaveLength(5));
    expect(finished).toBe(false);
    expect(h.runs.every((run) => !run.options.signal?.aborted)).toBe(true);
    h.runs[4].finish(
      'OFFICE_DECISION {"action":"complete","message":"Entrega terminada y revisada"}',
    );
    await waiting;
    expect(snapshot).not.toHaveBeenCalled();
    snapshot.mockRestore();
    const state = h.team.snapshot();
    expect(state.running).toBe(false);
    expect(state.tasks.find((task) => task.office)?.status).toBe('completed');
    expect(state.tasks.find((task) => task.office)?.autonomyBudget?.usage).toMatchObject({
      attempts: 5,
      activeAttempts: 0,
      unknownAttempts: 0,
      complete: true,
    });
    expect(h.runs).toHaveLength(5);
  });
  it('settles at a human pause without resuming or dispatching another turn', async () => {
    const h = fixture();
    await h.team.queueConversation(h.id, request('Comprueba y pregunta lo necesario', true));
    await vi.waitFor(() => expect(h.runs).toHaveLength(1));
    const waiting = h.team.waitUntilIdle();
    h.runs[0].finish(
      'OFFICE_DECISION {"action":"human","message":"Elige el resultado visual","responseType":"text"}',
    );
    await waiting;
    const state = h.team.snapshot();
    expect(state.running).toBe(false);
    expect(state.tasks.find((task) => task.office)).toMatchObject({
      status: 'paused',
      reasonCode: 'office_human_required',
    });
    expect(h.runs).toHaveLength(1);
    await h.team.waitUntilIdle();
    expect(h.runs).toHaveLength(1);
  });
  it.each(['text', 'approval', 'legacy_restarted'] as const)(
    'preserves a pending human question and its message metadata across restart (%s)',
    async (mode) => {
      const h = fixture();
      h.execute.mockImplementation(async (options) => {
        options.onOutput?.(
          'OFFICE_DECISION ' +
            JSON.stringify({
              action: 'human',
              message: '¿Quieres conectar el servicio oficial?',
              responseType: mode === 'text' ? 'text' : 'approval',
            }),
        );
        return receipt(options);
      });
      await h.team.queueConversation(h.id, request('Conecta el servicio oficial', true));
      await vi.waitFor(() =>
        expect(h.team.snapshot().tasks.find((t) => t.office)?.humanRequest).toBeDefined(),
      );
      await vi.waitFor(() => expect(h.team.snapshot().running).toBe(false));
      const root = h.team.snapshot().tasks.find((t) => t.office)!;
      const messages = JSON.stringify(h.library.conversation(h.id).messages);
      await h.team.shutdown();
      if (mode === 'legacy_restarted') {
        const file = join(h.root, 'checkpoint.json'),
          saved = JSON.parse(readFileSync(file, 'utf8'));
        saved.tasks.find((t: { id: string }) => t.id === root.id).reasonCode = 'server_restarted';
        writeFileSync(file, JSON.stringify(saved));
      }
      const library = new ConversationLibrary(join(h.root, 'history'));
      const restored = new TeamCoordinator(
        { codex: h.executor, claude: new DisabledExecutor('claude') },
        undefined,
        undefined,
        undefined,
        undefined,
        join(h.root, 'checkpoint.json'),
        new AdaptiveRuntime(
          new UsageHistory(join(h.root, 'usage.json')),
          join(h.root, 'artifacts'),
        ),
        library,
      );
      teams.push(restored);
      expect(restored.snapshot().running).toBe(false);
      const recovered = restored.snapshot().tasks.find((t) => t.id === root.id)!;
      expect(recovered.reasonCode).toBe('office_human_required');
      expect(recovered.humanRequest).toEqual(root.humanRequest);
      expect(JSON.stringify(library.conversation(h.id).messages)).toBe(messages);
      expect(h.execute).toHaveBeenCalledTimes(1);
      await restored.answerOfficeQuestion(
        root.id,
        root.humanRequest!.id,
        mode === 'text' ? 'Continuar' : 'approve',
      );
      await vi.waitFor(() => expect(h.execute).toHaveBeenCalledTimes(2));
    },
  );
  it('completes a small explanation with only Chief and Tester and reconstructs memory after restart', async () => {
    const h = fixture();
    const roles: string[] = [];
    let chiefs = 0;
    h.execute.mockImplementation(async (options) => {
      roles.push(options.officeRole!);
      if (options.officeRole === 'chief') {
        const decision =
          chiefs++ === 0
            ? {
                action: 'assign',
                role: 'tester',
                title: 'Contrasta',
                task: 'Verifica la explicación',
                message: 'Explicación preparada por el Jefe',
              }
            : { action: 'complete', message: 'Explicación contrastada' };
        options.onOutput?.('OFFICE_DECISION ' + JSON.stringify(decision));
      } else {
        expect(options.prompt).toContain('Explicación preparada por el Jefe');
        expect(options.objectiveSessionKey).toBeUndefined();
        options.onOutput?.('Explicación verificada\nOFFICE_RESULT {"status":"completed"}');
      }
      return receipt(options);
    });
    await h.team.queueConversation(h.id, request('Explica este archivo', true));
    await vi.waitFor(() =>
      expect(h.team.snapshot().tasks.find((t) => t.office)?.status).toBe('completed'),
    );
    expect(roles).toEqual(['chief', 'tester', 'chief']);
    const original = h.team.snapshot().tasks.find((t) => t.office)!;
    expect(original.office?.memory?.team.size).toBe('small');
    expect(original.office?.memory?.deliveries).toHaveLength(3);
    await h.team.shutdown();
    const restored = new TeamCoordinator(
      { codex: h.executor, claude: new DisabledExecutor('claude') },
      undefined,
      undefined,
      undefined,
      undefined,
      join(h.root, 'checkpoint.json'),
      new AdaptiveRuntime(new UsageHistory(join(h.root, 'usage.json')), join(h.root, 'artifacts')),
      new ConversationLibrary(join(h.root, 'history')),
    );
    teams.push(restored);
    const recovered = restored.snapshot();
    expect(recovered.running).toBe(false);
    const memory = recovered.tasks.find((t) => t.id === original.id)?.office?.memory;
    expect(memory?.deliveries.map((d) => d.taskId)).toEqual(
      original.office?.memory?.deliveries.map((d) => d.taskId),
    );
    expect(memory?.deliveries[0].decision?.message).toBe('Explicación preparada por el Jefe');
    expect(roles).toHaveLength(3);
  });
  it.each(['text', 'approve', 'deny', 'manual'])(
    'answers a concrete chief question safely (%s)',
    async (mode) => {
      const h = fixture();
      let calls = 0;
      h.execute.mockImplementation(async (options) => {
        calls++;
        options.onOutput?.(
          'OFFICE_DECISION ' +
            JSON.stringify({
              action: 'human',
              message:
                calls === 1
                  ? '¿Qué color quieres para el botón?'
                  : '¿Quieres revisar otra propuesta?',
              responseType: mode === 'approve' || mode === 'deny' ? 'approval' : 'text',
            }),
        );
        return receipt(options);
      });
      await h.team.queueConversation(h.id, request('Necesito una propuesta visual', true));
      await vi.waitFor(() => expect(h.team.snapshot().running).toBe(false));
      await vi.waitFor(() =>
        expect(h.team.snapshot().tasks.find((t) => t.office)?.humanRequest).toBeDefined(),
      );
      const root = h.team.snapshot().tasks.find((t) => t.office)!;
      await vi.waitFor(() => expect(h.team.snapshot().running).toBe(false));
      await expect(h.team.answerOfficeQuestion(root.id, 'wrong', 'x')).rejects.toMatchObject({
        code: 'question_expired',
      });
      if (mode === 'manual') h.library.setAutonomy(h.projectId, false);
      const answer = mode === 'approve' || mode === 'deny' ? mode : 'Azul';
      await h.team.answerOfficeQuestion(root.id, root.humanRequest!.id, answer);
      expect(
        h.library
          .conversation(h.id)
          .messages.some((m) =>
            m.content.includes(
              mode === 'deny' ? 'Denegado' : mode === 'approve' ? 'Aprobado' : 'Azul',
            ),
          ),
      ).toBe(true);
      await expect(
        h.team.answerOfficeQuestion(root.id, root.humanRequest!.id, answer),
      ).rejects.toMatchObject({ code: 'question_expired' });
      if (mode === 'manual') expect(calls).toBe(1);
      else await vi.waitFor(() => expect(calls).toBe(2));
    },
  );
  it('does not close a revised objective using tester evidence from before a live chief instruction', async () => {
    const h = fixture();
    let chief = 0;
    let finishChief: (() => void) | undefined;
    h.execute.mockImplementation(async (options) => {
      if (options.officeRole === 'chief') {
        expect(options.objectiveSessionKey).toBe(
          h.team.snapshot().tasks.find((t) => !!t.office && !t.officeParentId)?.id,
        );
        expect(options.prompt).toContain('Memoria estructurada del objetivo');
        chief++;
        if (chief < 3) {
          options.onOutput?.(
            'OFFICE_DECISION ' +
              JSON.stringify({
                action: 'assign',
                role: chief === 1 ? 'architect' : 'tester',
                title: chief === 1 ? 'Analiza' : 'Revisa',
                task: 'Contrasta los archivos del proyecto',
                message: 'Entrega inicial',
              }),
          );
          return receipt(options);
        }
        if (chief === 4) {
          options.onOutput?.(
            'OFFICE_DECISION {"action":"assign","role":"tester","title":"Revisa el requisito nuevo","task":"Contrasta la accesibilidad solicitada","message":"Nueva revisión independiente"}',
          );
          return receipt(options);
        }
        if (chief > 4) {
          options.onOutput?.(
            'OFFICE_DECISION {"action":"complete","message":"Objetivo actualizado y revisado"}',
          );
          return receipt(options);
        }
        return await new Promise((resolve) => {
          finishChief = () => {
            options.onOutput?.(
              'OFFICE_DECISION {"action":"complete","message":"Cierre usando la revisión anterior"}',
            );
            resolve(receipt(options));
          };
          options.signal?.addEventListener('abort', () => resolve(receipt(options, 'cancelled')), {
            once: true,
          });
        });
      }
      options.onOutput?.('Análisis revisado\nOFFICE_RESULT {"status":"completed"}');
      return receipt(options);
    });
    await h.team.queueConversation(h.id, request('Analiza el proyecto', true));
    await vi.waitFor(() => expect(finishChief).toBeDefined(), { timeout: 10000 });
    expect(
      h.team.snapshot().tasks.filter((t) => t.role === 'tester' && t.status === 'completed'),
    ).toHaveLength(1);
    await h.team.applyConversationNow(
      h.id,
      request('Añade una comprobación de accesibilidad', true),
    );
    expect(h.steer).toHaveBeenCalledTimes(1);
    finishChief!();
    await vi.waitFor(
      () =>
        expect(h.team.snapshot().tasks.find((t) => !!t.office && !t.officeParentId)?.status).toBe(
          'completed',
        ),
      { timeout: 10000 },
    );
    expect(chief).toBe(5);
    expect(
      h.team.snapshot().tasks.filter((t) => t.role === 'tester' && t.status === 'completed'),
    ).toHaveLength(2);
  });

  it('waits for chief closure rather than an architect or tester subtask before dispatching a follow-up', async () => {
    const h = fixture();
    let chief = 0;
    const specialistRuns: Array<{ options: ExecuteOptions; finish: () => void }> = [];
    let rootWasCompletedBeforeFollowup = false;
    h.execute.mockImplementation(async (options) => {
      if (options.officeRole === 'chief') {
        const decisions = [
          {
            action: 'assign',
            role: 'architect',
            title: 'Estudia',
            task: 'Analiza los archivos',
            message: 'Análisis',
          },
          {
            action: 'assign',
            role: 'tester',
            title: 'Revisa',
            task: 'Contrasta el análisis',
            message: 'Revisión',
          },
          { action: 'complete', message: 'Objetivo analizado y verificado' },
        ];
        options.onOutput?.('OFFICE_DECISION ' + JSON.stringify(decisions[chief++]));
        return receipt(options);
      }
      if (options.officeRole === 'architect' || options.officeRole === 'tester') {
        return await new Promise((resolve) => {
          specialistRuns.push({
            options,
            finish: () => {
              options.onOutput?.('Análisis contrastado\nOFFICE_RESULT {"status":"completed"}');
              resolve(receipt(options));
            },
          });
          options.signal?.addEventListener('abort', () => resolve(receipt(options, 'cancelled')), {
            once: true,
          });
        });
      }
      rootWasCompletedBeforeFollowup =
        h.team.snapshot().tasks.find((t) => !!t.office && !t.officeParentId)?.status ===
        'completed';
      options.onOutput?.('Siguiente petición\nOFFICE_RESULT {"status":"completed"}');
      return receipt(options);
    });
    await h.team.queueConversation(h.id, request('Analiza el proyecto completo', true));
    await vi.waitFor(() => expect(specialistRuns).toHaveLength(1));
    await h.team.queueConversation(h.id, request('Después responde al seguimiento'));
    h.library.draft(h.id, 'Borrador mientras trabaja el equipo');
    expect(h.library.pendingInputs()).toHaveLength(1);
    specialistRuns[0].finish();
    await vi.waitFor(() => expect(specialistRuns).toHaveLength(2));
    expect(specialistRuns[1].options.officeRole).toBe('tester');
    expect(h.library.conversation(h.id).draft).toBe('Borrador mientras trabaja el equipo');
    expect(h.library.pendingInputs()).toHaveLength(1);
    expect(chief).toBe(2);
    specialistRuns[1].finish();
    await vi.waitFor(() => expect(rootWasCompletedBeforeFollowup).toBe(true), { timeout: 10000 });
    await vi.waitFor(() => expect(h.team.snapshot().running).toBe(false));
    expect(h.library.pendingInputs()).toEqual([]);
  });

  it('interrupts an employee and returns the new instruction to the chief before fresh review', async () => {
    const h = fixture();
    let chief = 0;
    const chiefPrompts: string[] = [];
    let interrupted: ExecuteOptions | undefined;
    let laterTester = false;
    h.execute.mockImplementation(async (options) => {
      if (options.officeRole === 'chief') {
        chiefPrompts.push(options.prompt);
        const decisions = [
          {
            action: 'assign',
            role: 'architect',
            title: 'Estudia',
            task: 'Analiza los archivos',
            message: 'Análisis inicial',
          },
          {
            action: 'assign',
            role: 'architect',
            title: 'Reorganiza',
            task: 'Analiza el nuevo requisito',
            message: 'Nuevo análisis',
          },
          {
            action: 'assign',
            role: 'tester',
            title: 'Revisa',
            task: 'Contrasta el nuevo requisito',
            message: 'Revisión actualizada',
          },
          { action: 'complete', message: 'Objetivo corregido y verificado' },
        ];
        options.onOutput?.('OFFICE_DECISION ' + JSON.stringify(decisions[chief++]));
        return receipt(options);
      }
      if (options.officeRole === 'architect' && !interrupted) {
        interrupted = options;
        return await new Promise((resolve) =>
          options.signal?.addEventListener('abort', () => resolve(receipt(options, 'cancelled')), {
            once: true,
          }),
        );
      }
      if (options.officeRole === 'tester') laterTester = true;
      options.onOutput?.('Nuevo requisito contrastado\nOFFICE_RESULT {"status":"completed"}');
      return receipt(options);
    });
    await h.team.queueConversation(h.id, request('Analiza el proyecto', true));
    await vi.waitFor(() => expect(interrupted).toBeDefined());
    const instruction = request('Incluye también la accesibilidad', true);
    await h.team.applyConversationNow(h.id, instruction);
    await vi.waitFor(() => expect(interrupted!.signal?.aborted).toBe(true));
    await vi.waitFor(() => expect(chief).toBeGreaterThanOrEqual(2), { timeout: 10000 });
    expect(chiefPrompts[1]).toContain(instruction.message);
    await vi.waitFor(
      () =>
        expect(h.team.snapshot().tasks.find((t) => !!t.office && !t.officeParentId)?.status).toBe(
          'completed',
        ),
      { timeout: 10000 },
    );
    expect(laterTester).toBe(true);
    expect(h.steer).not.toHaveBeenCalled();
    expect(
      h.library.conversation(h.id).messages.filter((m) => m.inputId === instruction.inputId),
    ).toHaveLength(1);
  });

  it('queues follow-ups during a real coordinator execution and dispatches only after it finishes', async () => {
    const h = fixture();
    await h.team.queueConversation(h.id, request('Primero'));
    await vi.waitFor(() => expect(h.runs).toHaveLength(1));
    const second = request('Segundo');
    await h.team.queueConversation(h.id, second);
    await h.team.queueConversation(h.id, second);
    expect(h.library.pendingInputs().map((p) => p.content)).toEqual(['Segundo']);
    expect(h.runs).toHaveLength(1);
    h.runs[0].finish();
    await vi.waitFor(() => expect(h.runs).toHaveLength(2));
    expect(h.runs[1].options.prompt).toContain('Segundo');
    h.runs[1].finish();
    await vi.waitFor(() => expect(h.team.snapshot().running).toBe(false));
    expect(h.library.pendingInputs()).toEqual([]);
    expect(h.library.conversation(h.id).messages.filter((m) => m.kind === 'request')).toHaveLength(
      2,
    );
  });

  it('preserves a different draft typed while a queued request is waiting to dispatch', async () => {
    const h = fixture();
    await h.team.queueConversation(h.id, request('Trabajo actual'));
    await vi.waitFor(() => expect(h.runs).toHaveLength(1));
    await h.team.queueConversation(h.id, request('Segundo ya enviado'));
    h.library.draft(h.id, 'Tercer mensaje todavía en edición');
    h.runs[0].finish();
    await vi.waitFor(() => expect(h.runs).toHaveLength(2));
    expect(h.library.conversation(h.id).draft).toBe('Tercer mensaje todavía en edición');
    h.runs[1].finish();
  });

  it('holds a different conversation until the active one releases its execution', async () => {
    const h = fixture();
    const other = h.library.create(h.projectId).id;
    await h.team.queueConversation(h.id, request('Trabajo actual'));
    await vi.waitFor(() => expect(h.runs).toHaveLength(1));
    const followup = request('Otro chat');
    await h.team.queueConversation(other, followup);
    expect(h.runs).toHaveLength(1);
    await expect(h.team.queueConversation(h.id, followup)).rejects.toThrow();
    h.runs[0].finish();
    await vi.waitFor(() => expect(h.runs).toHaveLength(2));
    h.runs[1].finish();
    await vi.waitFor(() => expect(h.team.snapshot().running).toBe(false));
    expect(h.library.conversation(other).messages.some((m) => m.inputId === followup.inputId)).toBe(
      true,
    );
  });

  it('protects edits and removals with revisions while busy', async () => {
    const h = fixture();
    await h.team.queueConversation(h.id, request('Trabajo actual'));
    await vi.waitFor(() => expect(h.runs).toHaveLength(1));
    const p = request('Pendiente');
    await h.team.queueConversation(h.id, p);
    const before = h.library.pendingInputs()[0];
    await h.team.updateQueuedConversation(h.id, p.inputId, before.revision, 'Corregido');
    await expect(
      h.team.removeQueuedConversation(h.id, p.inputId, before.revision),
    ).rejects.toThrow();
    const current = h.library.pendingInputs()[0];
    expect(current.content).toBe('Corregido');
    await h.team.removeQueuedConversation(h.id, p.inputId, current.revision);
    expect(h.library.pendingInputs()).toEqual([]);
    h.runs[0].finish();
  });

  it('keeps queued messages on cancellation without silently restarting them', async () => {
    const h = fixture();
    await h.team.queueConversation(h.id, request('Trabajo actual'));
    await vi.waitFor(() => expect(h.runs).toHaveLength(1));
    await h.team.queueConversation(h.id, request('No ejecutar al cancelar'));
    h.team.cancel(h.team.snapshot().tasks.find((t) => !t.officeParentId)!.id);
    await vi.waitFor(() => expect(h.runs[0].options.signal?.aborted).toBe(true));
    await new Promise((r) => setTimeout(r, 80));
    expect(h.runs).toHaveLength(1);
    expect(h.library.pendingInputs()).toHaveLength(1);
    expect(h.library.conversation(h.id).pendingHold).toBe(true);
  });

  it('recovers queued follow-ups and the current transcript without executing anything on restart', async () => {
    const h = fixture();
    await h.team.queueConversation(h.id, request('Trabajo interrumpido al reiniciar'));
    await vi.waitFor(() => expect(h.runs).toHaveLength(1));
    const next = request('Conservar sin ejecutar');
    await h.team.queueConversation(h.id, next);
    await h.team.shutdown();
    const library = new ConversationLibrary(join(h.root, 'history'));
    const reopened = new TeamCoordinator(
      { codex: h.executor, claude: new DisabledExecutor('claude') },
      undefined,
      undefined,
      undefined,
      undefined,
      join(h.root, 'checkpoint.json'),
      new AdaptiveRuntime(new UsageHistory(join(h.root, 'usage.json')), join(h.root, 'artifacts')),
      library,
    );
    teams.push(reopened);
    await new Promise((r) => setTimeout(r, 80));
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(library.pendingInputs()[0]).toMatchObject({
      id: next.inputId,
      content: next.message,
      status: 'queued',
    });
    expect(library.conversation(h.id).pendingHold).toBe(true);
    expect(
      library
        .conversation(h.id)
        .messages.some((m) => m.content === 'Trabajo interrumpido al reiniciar'),
    ).toBe(true);
    expect(reopened.snapshot().running).toBe(false);
  });

  it('delivers a single-task steer once and records it beside the current objective', async () => {
    const h = fixture();
    await h.team.queueConversation(h.id, request('Trabajo actual'));
    await vi.waitFor(() => expect(h.runs).toHaveLength(1));
    const steering = request('Nuevo requisito inmediato');
    await h.team.applyConversationNow(h.id, steering);
    expect(h.steer).toHaveBeenCalledTimes(1);
    expect(h.steer.mock.calls[0][1]).toMatchObject({
      id: steering.inputId,
      text: expect.stringContaining(steering.message),
    });
    expect(
      h.library.conversation(h.id).messages.filter((m) => m.inputId === steering.inputId),
    ).toHaveLength(1);
    expect(h.library.pendingInputs()).toEqual([]);
    h.runs[0].finish();
  });

  it('retains an uncertain steer for review and never sends it as a new task', async () => {
    const h = fixture();
    await h.team.queueConversation(h.id, request('Trabajo actual'));
    await vi.waitFor(() => expect(h.runs).toHaveLength(1));
    h.steer.mockResolvedValueOnce({ status: 'unknown' });
    const steering = request('Resultado incierto');
    await h.team.applyConversationNow(h.id, steering);
    expect(h.library.pendingInputs()[0]).toMatchObject({
      id: steering.inputId,
      status: 'needs_review',
    });
    h.runs[0].finish();
    await vi.waitFor(() => expect(h.team.snapshot().running).toBe(false));
    await new Promise((r) => setTimeout(r, 80));
    expect(h.runs).toHaveLength(1);
    await expect(h.team.continueQueuedConversation(h.id)).rejects.toThrow();
  });

  it('dispatches a late steer once as a normal request after the previous turn finishes', async () => {
    const h = fixture();
    await h.team.queueConversation(h.id, request('Trabajo actual'));
    await vi.waitFor(() => expect(h.runs).toHaveLength(1));
    h.steer.mockImplementationOnce(async () => {
      h.runs[0].finish();
      return { status: 'not_running' };
    });
    const instruction = request('Llegó durante el cierre');
    await h.team.applyConversationNow(h.id, instruction);
    await vi.waitFor(() => expect(h.runs).toHaveLength(2));
    h.runs[1].finish();
    await vi.waitFor(() => expect(h.team.snapshot().running).toBe(false));
    expect(h.library.pendingInputs()).toEqual([]);
    expect(
      h.library.conversation(h.id).messages.filter((m) => m.inputId === instruction.inputId),
    ).toHaveLength(1);
    expect(h.steer).toHaveBeenCalledTimes(1);
  });

  it('preserves the normal queued path when the executor cannot steer', async () => {
    const h = fixture();
    Object.assign(h.executor, { supportsSteering: false });
    await h.team.queueConversation(h.id, request('Trabajo actual'));
    await vi.waitFor(() => expect(h.runs).toHaveLength(1));
    const instruction = request('Dejar pendiente');
    await expect(h.team.applyConversationNow(h.id, instruction)).rejects.toMatchObject({
      code: 'steering_unavailable',
    });
    expect(h.steer).not.toHaveBeenCalled();
    expect(h.library.pendingInputs()[0]).toMatchObject({
      id: instruction.inputId,
      status: 'queued',
    });
    h.runs[0].finish();
    await vi.waitFor(() => expect(h.runs).toHaveLength(2));
    h.runs[1].finish();
  });

  it('keeps manual project confirmation instead of executing a queued request automatically', async () => {
    const h = fixture();
    h.library.setAutonomy(h.projectId, false);
    await h.team.queueConversation(h.id, request('Necesita confirmación'));
    await vi.waitFor(() => expect(h.team.snapshot().tasks).toHaveLength(1));
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.team.snapshot().tasks[0]).toMatchObject({ status: 'planned', approved: false });
    expect(h.library.conversation(h.id).pendingHold).toBe(true);
  });
});
