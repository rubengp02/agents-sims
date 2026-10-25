import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TeamTask } from '../../core/src/team.js';
import { AdaptiveRuntime } from '../src/execution/adaptiveRuntime.js';
import { ConversationDelivery } from '../src/execution/conversationDelivery.js';
import { ConversationLibrary } from '../src/execution/conversationLibrary.js';
import { DisabledExecutor } from '../src/execution/optionalExecutors.js';
import { TeamCoordinator } from '../src/execution/teamCoordinator.js';
import type { ExecuteOptions, OfficialExecutor, RunRecord } from '../src/execution/types.js';
import { UsageHistory } from '../src/execution/usageHistory.js';

const roots: string[] = [];
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'steering-safety-'));
  roots.push(root);
  const project = join(root, 'project');
  mkdirSync(project);
  const library = new ConversationLibrary(join(root, 'history'));
  const projectId = library.register(project).id;
  library.setAutonomy(projectId, true);
  const id = library.create(projectId).id;
  return { root, project, library, id };
}
function receipt(o: ExecuteOptions): RunRecord {
  return {
    version: 1,
    id: randomUUID(),
    provider: 'codex',
    engine: 'codex-app-server',
    billing: 'subscription-only',
    status: 'completed',
    project: o.project,
    requestedModel: o.model!,
    requestedEffort: o.effort!,
    confirmedModel: o.model!,
    sessionId: randomUUID(),
    startedAt: Date.now(),
    updatedAt: Date.now(),
    reasonCode: null,
    inputTokens: 10,
    outputTokens: 5,
  };
}

describe('independent steering safety review (no inference)', () => {
  it('settles an interrupted reader before letting the Chief answer an informational follow-up directly', async () => {
    const h = setup();
    let chiefTurns = 0,
      readerStopped = false;
    const execute = vi.fn<OfficialExecutor['execute']>(async (o) => {
      if (o.officeRole === 'chief') {
        chiefTurns++;
        if (chiefTurns > 1) expect(readerStopped).toBe(true);
        o.onOutput?.(
          'OFFICE_DECISION ' +
            JSON.stringify(
              chiefTurns === 1
                ? {
                    action: 'assign',
                    role: 'architect',
                    title: 'Read context',
                    task: 'Read only',
                    message: 'Existing study',
                  }
                : { action: 'complete', message: 'Cinco puntos con los siguientes pasos.' },
            ),
        );
        return receipt(o);
      }
      return await new Promise<RunRecord>((resolve) => {
        o.signal?.addEventListener(
          'abort',
          () => {
            readerStopped = true;
            resolve({ ...receipt(o), status: 'cancelled' });
          },
          { once: true },
        );
      });
    });
    const executor: OfficialExecutor = {
      provider: 'codex',
      engine: 'codex-app-server',
      supportsSteering: true,
      steer: async () => ({ status: 'not_running' }),
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
      join(h.root, 'checkpoint.json'),
      new AdaptiveRuntime(new UsageHistory(join(h.root, 'usage.json')), join(h.root, 'artifacts')),
      h.library,
    );
    cleanup.push(() => team.shutdown());
    await team.queueConversation(h.id, {
      inputId: randomUUID(),
      message: 'Describe esta imagen y resume el proyecto.',
      officeMode: true,
    });
    await vi.waitFor(() =>
      expect(execute.mock.calls.some(([o]) => o.officeRole === 'architect')).toBe(true),
    );
    await team.applyConversationNow(h.id, {
      inputId: randomUUID(),
      message: 'Incluye también los siguientes pasos.',
      officeMode: true,
    });
    await vi.waitFor(
      () =>
        expect(
          team
            .snapshot()
            .tasks.filter((t) => t.conversationId === h.id && !t.officeParentId)
            .at(-1)?.status,
        ).toBe('completed'),
      { timeout: 5000 },
    );
    expect(chiefTurns).toBe(2);
    expect(execute.mock.calls.filter(([o]) => o.officeRole === 'tester')).toHaveLength(0);
  });
  it('pauses the objective when native steering delivery is uncertain', async () => {
    const h = setup();
    let finish: (() => void) | undefined;
    let captured: ExecuteOptions | undefined;
    const executor: OfficialExecutor = {
      provider: 'codex',
      engine: 'codex-app-server',
      supportsSteering: true,
      steer: async () => ({ status: 'unknown' }),
      execute: async (options) => {
        captured = options;
        return new Promise((resolve) => {
          finish = () => {
            options.onOutput?.('OFFICE_RESULT {"status":"completed"}');
            resolve(receipt(options));
          };
          options.signal?.addEventListener(
            'abort',
            () => resolve({ ...receipt(options), status: 'cancelled' }),
            { once: true },
          );
        });
      },
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
      join(h.root, 'checkpoint.json'),
      new AdaptiveRuntime(new UsageHistory(join(h.root, 'usage.json')), join(h.root, 'artifacts')),
      h.library,
    );
    cleanup.push(() => team.shutdown());
    await team.queueConversation(h.id, {
      inputId: randomUUID(),
      message: 'Initial objective',
      officeMode: false,
    });
    await vi.waitFor(() => expect(finish).toBeDefined());
    await team.applyConversationNow(h.id, {
      inputId: randomUUID(),
      message: 'Possibly delivered requirement',
      officeMode: false,
    });
    expect(h.library.pendingInputs(h.id)[0]?.status).toBe('needs_review');
    expect(captured!.signal?.aborted).toBe(true);
    expect(team.snapshot().budgetReason).toBe('instruction_delivery_unknown');
  });

  it('does not start an obsolete assignment when instructions arrive during model selection', async () => {
    const h = setup();
    let chiefTurns = 0;
    const execute = vi.fn<OfficialExecutor['execute']>(async (o) => {
      if (o.officeRole === 'chief') {
        chiefTurns++;
        o.onOutput?.(
          'OFFICE_DECISION ' +
            JSON.stringify(
              chiefTurns === 1
                ? {
                    action: 'assign',
                    role: 'architect',
                    title: 'Old assignment',
                    task: 'OLD REQUIREMENT',
                    message: 'Analyze',
                  }
                : { action: 'human', message: 'New instruction received' },
            ),
        );
      } else o.onOutput?.('OFFICE_RESULT {"status":"completed"}');
      return receipt(o);
    });
    const executor: OfficialExecutor = {
      provider: 'codex',
      engine: 'codex-app-server',
      supportsSteering: true,
      steer: async () => ({ status: 'not_running' }),
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
      join(h.root, 'checkpoint.json'),
      new AdaptiveRuntime(new UsageHistory(join(h.root, 'usage.json')), join(h.root, 'artifacts')),
      h.library,
    );
    cleanup.push(() => team.shutdown());
    const assign = team.assign.bind(team);
    let release: (() => void) | undefined;
    vi.spyOn(team, 'assign').mockImplementation(async (id, assessment) => {
      if (team.snapshot().tasks.find((t) => t.id === id)?.title === 'Old assignment')
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return assign(id, assessment);
    });
    await team.queueConversation(h.id, {
      inputId: randomUUID(),
      message: 'Initial objective',
      officeMode: true,
    });
    await vi.waitFor(() => expect(release).toBeDefined());
    await team.applyConversationNow(h.id, {
      inputId: randomUUID(),
      message: 'REPLACEMENT REQUIREMENT',
      officeMode: true,
    });
    release!();
    await vi.waitFor(() => expect(chiefTurns).toBeGreaterThan(1), { timeout: 5000 });
    expect(execute.mock.calls.filter(([o]) => o.officeRole === 'architect')).toHaveLength(0);
  });

  it('holds an instruction after a post-delivery failure instead of executing it again as a new objective', async () => {
    const h = setup();
    let busy = true;
    const task = {
      id: randomUUID(),
      conversationId: h.id,
      role: 'chief',
      status: 'running',
      reasonCode: null,
    } as TeamTask;
    const host = {
      busy: () => busy,
      blocked: () => false,
      latest: () => task,
      dispatch: vi.fn(async () => task),
      apply: vi.fn(async (_id: string, input: { id: string; content: string }) => {
        h.library.recordUserInstruction(task, input.id, input.content);
        throw new Error('Storage/checkpoint unavailable after native acknowledgment');
      }),
    };
    const delivery = new ConversationDelivery(h.library, host);
    cleanup.push(() => delivery.close());
    const input = h.library.enqueue(h.id, {
      id: randomUUID(),
      content: 'Already delivered',
      officeMode: true,
    });
    await expect(
      delivery.serial(() => delivery.apply(h.id, input.id, input.revision)),
    ).rejects.toThrow();
    busy = false;
    task.status = 'completed';
    delivery.settle(task);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(host.dispatch).not.toHaveBeenCalled();
    expect(h.library.pendingInputs(h.id)[0]?.status).toBe('needs_review');
  });
});
