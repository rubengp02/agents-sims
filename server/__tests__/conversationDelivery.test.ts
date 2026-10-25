import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PendingConversationInput } from '../../core/src/conversations.js';
import type { TeamTask } from '../../core/src/team.js';
import { ConversationDelivery } from '../src/execution/conversationDelivery.js';
import { ConversationLibrary } from '../src/execution/conversationLibrary.js';

const roots: string[] = [];
const deliveries: ConversationDelivery[] = [];
afterEach(async () => {
  await Promise.all(deliveries.splice(0).map((d) => d.close()));
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});
const input = (content: string) => ({ id: randomUUID(), content, officeMode: true });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'office-delivery-'));
  roots.push(root);
  const project = join(root, 'project');
  mkdirSync(project);
  const directory = join(root, 'history');
  const library = new ConversationLibrary(directory);
  const projectId = library.register(project).id;
  const conversationId = library.create(projectId).id;
  const tasks = new Map<string, TeamTask>();
  const flags = { busy: true, blocked: false };
  const makeTask = (id: string, p: PendingConversationInput): TeamTask =>
    ({
      id: randomUUID(),
      conversationId: id,
      prompt: p.content,
      attachments: p.attachments,
      title: p.content,
      role: 'chief',
      status: 'running',
      output: '',
      reasonCode: null,
    }) as TeamTask;
  const host = {
    busy: () => flags.busy,
    blocked: () => flags.blocked,
    latest: (id: string) => tasks.get(id),
    dispatch: vi.fn(async (id: string, p: PendingConversationInput) => {
      const task = makeTask(id, p);
      flags.busy = true;
      tasks.set(id, task);
      library.record(task);
      return task;
    }),
    apply: vi.fn(
      async (
        _id: string,
        _p: PendingConversationInput,
      ): Promise<'accepted' | 'not_running' | 'unknown'> => 'not_running',
    ),
  };
  const delivery = new ConversationDelivery(library, host);
  deliveries.push(delivery);
  const finish = (id = conversationId, status: TeamTask['status'] = 'completed') => {
    const task = tasks.get(id)!;
    task.status = status;
    flags.busy = false;
    library.record(task);
    delivery.settle(task);
  };
  return { directory, library, projectId, conversationId, flags, host, tasks, delivery, finish };
}

describe('durable conversation delivery (no model quota)', () => {
  it('waits for the whole current objective and dispatches each follow-up once in FIFO order', async () => {
    const h = fixture();
    const first = h.library.enqueue(h.conversationId, input('Primero'));
    h.library.enqueue(h.conversationId, input('Segundo'));
    h.delivery.notify();
    await new Promise((r) => setTimeout(r, 20));
    expect(h.host.dispatch).not.toHaveBeenCalled();
    h.flags.busy = false;
    h.delivery.notify();
    await vi.waitFor(() => expect(h.host.dispatch).toHaveBeenCalledTimes(1));
    expect(h.host.dispatch.mock.calls[0][1].id).toBe(first.id);
    h.delivery.notify();
    h.delivery.notify();
    await new Promise((r) => setTimeout(r, 20));
    expect(h.host.dispatch).toHaveBeenCalledTimes(1);
    expect(h.library.pendingInputs().map((p) => p.content)).toEqual(['Segundo']);
    h.finish();
    await vi.waitFor(() => expect(h.host.dispatch).toHaveBeenCalledTimes(2));
    expect(h.host.dispatch.mock.calls[1][1].content).toBe('Segundo');
    expect(h.library.pendingInputs()).toEqual([]);
    expect(
      h.library.conversation(h.conversationId).messages.filter((m) => m.kind === 'request'),
    ).toHaveLength(2);
  });

  it('keeps cross-chat inputs separate and never interrupts a running chat', async () => {
    const h = fixture();
    const other = h.library.create(h.projectId).id;
    const p = h.library.enqueue(other, input('En el otro chat'));
    expect(() =>
      h.library.enqueue(h.conversationId, { id: p.id, content: p.content, officeMode: true }),
    ).toThrow();
    h.delivery.notify();
    await new Promise((r) => setTimeout(r, 20));
    expect(h.host.dispatch).not.toHaveBeenCalled();
    h.flags.busy = false;
    h.delivery.notify();
    await vi.waitFor(() => expect(h.host.dispatch).toHaveBeenCalledTimes(1));
    expect(h.host.dispatch.mock.calls[0][0]).toBe(other);
    expect(h.library.conversation(h.conversationId).messages).toEqual([]);
  });

  it.each(['cancelled', 'failed', 'paused', 'blocked'] as const)(
    'holds queued messages after %s until an explicit continuation',
    async (status) => {
      const h = fixture();
      h.library.enqueue(h.conversationId, input('Después'));
      const task = { id: randomUUID(), conversationId: h.conversationId, status } as TeamTask;
      h.flags.busy = false;
      h.delivery.settle(task);
      await new Promise((r) => setTimeout(r, 20));
      expect(h.host.dispatch).not.toHaveBeenCalled();
      expect(h.library.conversation(h.conversationId).pendingHold).toBe(true);
      h.delivery.continue(h.conversationId);
      await vi.waitFor(() => expect(h.host.dispatch).toHaveBeenCalledTimes(1));
    },
  );

  it('keeps dispatch failures for review and refuses automatic retries', async () => {
    const h = fixture();
    h.library.enqueue(h.conversationId, input('No duplicar'));
    h.host.dispatch.mockRejectedValueOnce(new Error('Connection lost'));
    h.flags.busy = false;
    h.delivery.notify();
    await vi.waitFor(() => expect(h.library.pendingInputs()[0].status).toBe('needs_review'));
    expect(h.library.conversation(h.conversationId).pendingHold).toBe(true);
    expect(() => h.delivery.continue(h.conversationId)).toThrow();
    h.delivery.notify();
    await new Promise((r) => setTimeout(r, 20));
    expect(h.host.dispatch).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch restored inputs merely because the chat was reopened', async () => {
    const h = fixture();
    h.library.enqueue(h.conversationId, input('Conservar tras reinicio'));
    await h.delivery.close();
    const restored = new ConversationLibrary(h.directory);
    h.flags.busy = false;
    const reopened = new ConversationDelivery(restored, h.host);
    deliveries.push(reopened);
    reopened.notify();
    await new Promise((r) => setTimeout(r, 20));
    expect(h.host.dispatch).not.toHaveBeenCalled();
    expect(restored.pendingInputs()).toHaveLength(1);
    expect(restored.conversation(h.conversationId).pendingHold).toBe(true);
  });

  it('records accepted steering once and rejects stale concurrent revisions', async () => {
    const h = fixture();
    const p = h.library.enqueue(h.conversationId, input('Aplica ahora'));
    const task = {
      id: randomUUID(),
      conversationId: h.conversationId,
      role: 'chief',
      status: 'running',
      reasonCode: null,
    } as TeamTask;
    h.host.apply.mockImplementationOnce(async (_id, pending) => {
      h.library.recordUserInstruction(task, pending.id, pending.content, pending.attachments);
      return 'accepted';
    });
    await expect(
      h.delivery.serial(() => h.delivery.apply(h.conversationId, p.id, p.revision + 1)),
    ).rejects.toThrow();
    await h.delivery.serial(() => h.delivery.apply(h.conversationId, p.id, p.revision));
    await h.delivery.serial(() => h.delivery.apply(h.conversationId, p.id, p.revision));
    expect(h.host.apply).toHaveBeenCalledTimes(1);
    expect(h.library.pendingInputs()).toEqual([]);
    expect(
      h.library.conversation(h.conversationId).messages.filter((m) => m.inputId === p.id),
    ).toHaveLength(1);
  });

  it('preserves an uncertain steer without automatically resending it', async () => {
    const h = fixture();
    const p = h.library.enqueue(h.conversationId, input('Resultado incierto'));
    h.host.apply.mockResolvedValueOnce('unknown');
    await h.delivery.serial(() => h.delivery.apply(h.conversationId, p.id, p.revision));
    expect(h.library.pendingInputs()[0]).toMatchObject({
      status: 'needs_review',
      reason: 'delivery_unknown',
    });
    expect(h.library.conversation(h.conversationId).pendingHold).toBe(true);
    expect(() => h.delivery.continue(h.conversationId)).toThrow();
    h.flags.busy = false;
    h.delivery.notify();
    await new Promise((r) => setTimeout(r, 20));
    expect(h.host.dispatch).not.toHaveBeenCalled();
    expect(h.host.apply).toHaveBeenCalledTimes(1);
  });

  it('turns steering that arrives after completion into the next normal request', async () => {
    const h = fixture();
    const p = h.library.enqueue(h.conversationId, input('Llegó tarde'));
    h.flags.busy = false;
    h.host.apply.mockResolvedValueOnce('not_running');
    await h.delivery.serial(() => h.delivery.apply(h.conversationId, p.id, p.revision));
    await vi.waitFor(() => expect(h.host.dispatch).toHaveBeenCalledTimes(1));
    expect(h.host.dispatch.mock.calls[0][1].id).toBe(p.id);
    expect(h.library.pendingInputs()).toEqual([]);
  });

  it('does not dispatch when a global quota or writer block remains', async () => {
    const h = fixture();
    h.library.enqueue(h.conversationId, input('Respeta el bloqueo'));
    h.flags.busy = false;
    h.flags.blocked = true;
    h.delivery.notify();
    await new Promise((r) => setTimeout(r, 20));
    expect(h.host.dispatch).not.toHaveBeenCalled();
    h.flags.blocked = false;
    h.delivery.notify();
    await vi.waitFor(() => expect(h.host.dispatch).toHaveBeenCalledTimes(1));
  });
});
