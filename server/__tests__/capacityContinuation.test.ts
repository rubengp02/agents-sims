import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConversationLibrary } from '../src/execution/conversationLibrary.js';
import { DisabledExecutor } from '../src/execution/optionalExecutors.js';
import { TeamCoordinator } from '../src/execution/teamCoordinator.js';
import type { ExecuteOptions, OfficialExecutor, RunRecord } from '../src/execution/types.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});

function fixture(
  options: {
    workStarted?: boolean;
    reason?: string;
    secondCapacity?: boolean;
    quotaFailure?: boolean;
    pinned?: boolean;
    office?: boolean;
    cancel?: boolean;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'capacity-continuation-'));
  const project = join(root, 'project');
  mkdirSync(project);
  const library = new ConversationLibrary(join(root, 'history'));
  const projectId = library.register(project).id;
  library.setAutonomy(projectId, true);
  const conversation = library.create(projectId).id;
  const calls: ExecuteOptions[] = [];
  const executor: OfficialExecutor = {
    provider: 'codex',
    engine: 'codex-app-server',
    diagnose: vi.fn(async () => {
      if (options.quotaFailure && calls.length) throw new Error('quota unavailable');
      return {
        checkedAt: Date.now(),
        plan: 'plus' as const,
        quota: [],
        models: [
          { id: 'gpt-6.1-sol', efforts: ['low', 'medium', 'high'] },
          { id: 'gpt-6-sol', efforts: ['low', 'medium', 'high'] },
          { id: 'gpt-5.6-sol', efforts: ['low', 'medium', 'high'] },
        ],
      };
    }),
    execute: vi.fn(async (o) => {
      calls.push(o);
      const capacity = calls.length === 1 || options.secondCapacity;
      const r: RunRecord = {
        version: 1,
        id: randomUUID(),
        provider: 'codex',
        engine: 'codex-app-server',
        billing: 'subscription-only',
        project,
        requestedModel: o.model!,
        requestedEffort: o.effort!,
        confirmedModel: o.model!,
        sessionId: randomUUID(),
        startedAt: Date.now(),
        updatedAt: Date.now(),
        status: capacity ? 'paused' : 'completed',
        reasonCode: capacity ? (options.reason ?? 'model_at_capacity') : null,
        inputTokens: capacity ? null : 20,
        outputTokens: capacity ? null : 5,
        toolCalls: 0,
        workStarted: options.workStarted ?? false,
      };
      if (options.cancel) team.cancel(team.snapshot().tasks.find((t) => !t.officeParentId)!.id);
      if (!capacity)
        o.onOutput?.(
          options.office
            ? 'OFFICE_DECISION {"action":"complete","message":"Resumen verificado."}'
            : 'Entrega comprobada\nOFFICE_RESULT {"status":"completed"}',
        );
      o.onState?.(r);
      return r;
    }),
  };
  class Pinned extends TeamCoordinator {
    protected override permitsCapacityFallback() {
      return false;
    }
  }
  const Constructor = options.pinned ? Pinned : TeamCoordinator;
  const checkpoint = join(root, 'checkpoint.json');
  const team = new Constructor(
    { codex: executor, claude: new DisabledExecutor('claude') },
    undefined,
    undefined,
    undefined,
    undefined,
    checkpoint,
    undefined,
    library,
  );
  cleanup.push(async () => {
    await team.shutdown();
    rmSync(root, { recursive: true, force: true });
  });
  return { team, library, conversation, calls, checkpoint, project, executor };
}
describe('bounded capacity continuation, no inference', () => {
  async function start(h: ReturnType<typeof fixture>, office = false) {
    const task = await h.team.prepareConversation(
      h.conversation,
      office ? 'Resume brevemente el proyecto.' : 'Implementa el contrato de dos módulos.',
      true,
      'codex',
      office,
    );
    await h.team.confirmConversation(
      task.id,
      true,
      true,
      false,
      h.team.snapshot().tasks.find((t) => t.id === task.id)!.confirmationFingerprint!,
    );
    await h.team.waitUntilIdle();
  }
  it('keeps the unknown receipt and starts one lower model with fresh quota and unchanged permissions', async () => {
    const h = fixture();
    await start(h);
    expect(h.calls.map((c) => c.model)).toEqual(['gpt-6.1-sol', 'gpt-6-sol']);
    expect(h.calls[1].allowWrites).toBe(h.calls[0].allowWrites);
    expect(h.calls[1].prompt).toBe(h.calls[0].prompt);
    const task = h.team.snapshot().tasks.find((t) => t.conversationId === h.conversation)!;
    expect(task.status).toBe('completed');
    expect(task.capacityFallback).toMatchObject({ previousUsageUnknown: true, state: 'completed' });
    const ledger = JSON.parse(readFileSync(h.checkpoint, 'utf8')).objectiveUsage;
    expect(ledger.attempts.map((a: { state: string }) => a.state)).toEqual(['unknown', 'settled']);
    expect(
      h.library.snapshot().selected?.messages.find((m) => m.kind === 'response')?.capacityFallback
        ?.to.model,
    ).toBe('gpt-6-sol');
    expect(h.team.snapshot().usageKnown).toBe(false);
  });
  it.each([
    { reason: 'app_server_rate_limited' },
    { workStarted: true },
    { quotaFailure: true },
    { pinned: true },
    { cancel: true },
  ])('does not replay ambiguous or unsafe failures %j', async (options) => {
    const h = fixture(options);
    await start(h);
    expect(h.calls).toHaveLength(1);
    expect(h.team.snapshot().tasks[0].status).not.toBe('completed');
  });
  it('does not loop through a catalog when the lower model is also saturated', async () => {
    const h = fixture({ secondCapacity: true });
    await start(h);
    expect(h.calls).toHaveLength(2);
    expect(h.team.snapshot().tasks[0].capacityFallback?.state).toBe('paused');
  });
  it('can continue the Chief with server-owned objective memory and preserve the model notice', async () => {
    const h = fixture({ office: true });
    await start(h, true);
    expect(h.calls.map((c) => c.model)).toEqual(['gpt-6.1-sol', 'gpt-6-sol']);
    const chief = h.team.snapshot().tasks.find((t) => t.office)!;
    expect(chief.status).toBe('completed');
    expect(chief.capacityFallback?.state).toBe('completed');
    expect(h.calls[1].objectiveSessionKey).toBe(h.calls[0].objectiveSessionKey);
  });
  it('restores a pending change as paused and never dispatches it by opening history', async () => {
    const h = fixture();
    await start(h);
    await h.team.shutdown();
    const saved = JSON.parse(readFileSync(h.checkpoint, 'utf8'));
    saved.tasks[0].capacityFallback.state = 'pending';
    writeFileSync(h.checkpoint, JSON.stringify(saved));
    const recovered = new TeamCoordinator(
      { codex: h.executor, claude: new DisabledExecutor('claude') },
      undefined,
      undefined,
      undefined,
      undefined,
      h.checkpoint,
      undefined,
      h.library,
    );
    cleanup.push(() => recovered.shutdown());
    expect(recovered.snapshot().tasks[0].capacityFallback?.state).toBe('paused');
    expect(h.calls).toHaveLength(2);
  });
});
