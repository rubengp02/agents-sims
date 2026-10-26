import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConversationLibrary } from '../src/execution/conversationLibrary.js';
import { TeamCoordinator } from '../src/execution/teamCoordinator.js';
import { DEFAULT_TEAM_SETTINGS } from '../src/execution/teamPolicy.js';
import {
  type ExecuteOptions,
  type OfficialExecutor,
  type RunRecord,
} from '../src/execution/types.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((f) => f()));
});
describe('Antigravity office routing and redirection', () => {
  it('keeps the chosen provider and settles an interrupted Chief before incorporating the new instruction', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agy-office-')),
      project = join(root, 'project');
    mkdirSync(project);
    const library = new ConversationLibrary(join(root, 'history')),
      projectId = library.register(project).id;
    library.setAutonomy(projectId, true);
    const conversation = library.create(projectId).id;
    let turn = 0,
      stopped = false;
    const makeReceipt = (o: ExecuteOptions): RunRecord => ({
      version: 1,
      id: randomUUID(),
      provider: 'antigravity',
      engine: 'antigravity-cli',
      billing: 'subscription-only',
      status: 'completed',
      project: o.project,
      requestedModel: o.model!,
      requestedEffort: o.effort!,
      confirmedModel: null,
      sessionId: randomUUID(),
      startedAt: Date.now(),
      updatedAt: Date.now(),
      reasonCode: null,
      inputTokens: 100,
      outputTokens: 10,
    });
    const antigravity: OfficialExecutor = {
      provider: 'antigravity',
      engine: 'antigravity-cli',
      supportsSteering: false,
      supportsOfficeRedirect: true,
      diagnose: async () => ({
        checkedAt: Date.now(),
        plan: 'google-included',
        quota: [],
        models: [
          { id: 'gemini-fixture-high', efforts: ['default'] },
          { id: 'gemini-fixture-low', efforts: ['default'] },
        ],
      }),
      execute: vi.fn(async (o: ExecuteOptions): Promise<RunRecord> => {
        turn++;
        expect(o.officeRole).toBe('chief');
        // Internal safety boilerplate must not turn a small explanation into
        // a complex-model assignment.
        expect(o.model).toBe('gemini-fixture-low');
        if (turn === 1)
          return new Promise<RunRecord>((resolve) =>
            o.signal?.addEventListener(
              'abort',
              () => {
                stopped = true;
                resolve({
                  ...makeReceipt(o),
                  status: 'cancelled',
                  reasonCode: 'redirected_by_user',
                });
              },
              { once: true },
            ),
          );
        expect(stopped).toBe(true);
        expect(o.prompt).toContain('cinco puntos');
        o.onOutput?.(
          'OFFICE_DECISION {"action":"complete","message":"Respuesta en cinco puntos."}',
        );
        return makeReceipt(o);
      }),
    };
    const codex: OfficialExecutor = {
      ...antigravity,
      provider: 'codex',
      diagnose: vi.fn(async () => {
        throw new Error('Wrong provider');
      }),
    };
    const team = new TeamCoordinator(
      { codex, claude: { ...codex, provider: 'claude' }, antigravity },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      library,
    );
    cleanup.push(async () => {
      await team.shutdown();
      rmSync(root, { recursive: true, force: true });
    });
    team.configure({
      ...DEFAULT_TEAM_SETTINGS,
      antigravityEnabled: true,
      defaultProvider: 'antigravity',
    });
    await team.queueConversation(conversation, {
      inputId: randomUUID(),
      message: 'Explica brevemente el proyecto.',
      officeMode: true,
    });
    await vi.waitFor(() => expect(turn).toBe(1));
    await team.applyConversationNow(conversation, {
      inputId: randomUUID(),
      message: 'Resume en cinco puntos.',
      officeMode: true,
    });
    await vi.waitFor(
      () => {
        const s = team.snapshot();
        const t = s.tasks.find((t) => t.conversationId === conversation && !t.officeParentId);
        expect(
          t?.status,
          JSON.stringify({
            reason: t?.reasonCode,
            budget: s.budgetReason,
            turn,
            output: t?.output,
          }),
        ).toBe('completed');
      },
      { timeout: 5000 },
    );
    expect(turn).toBe(2);
    expect(codex.diagnose).not.toHaveBeenCalled();
    expect(team.snapshot().capabilities).toMatchObject({
      engine: 'antigravity-cli',
      steering: false,
      officeRedirect: true,
    });
    const reviewer = team.addTask({
      role: 'tester',
      title: 'Revisión independiente',
      project,
      prompt: 'Revisa el cambio pequeño y su prueba.',
    });
    await team.assign(reviewer.id);
    expect(team.snapshot().tasks.find((t) => t.id === reviewer.id)?.choice?.model).toBe(
      'gemini-fixture-high',
    );
  });
});
