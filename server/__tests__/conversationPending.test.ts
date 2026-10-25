import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { OfficeArtifact } from '../../core/src/artifacts.js';
import type { TeamTask } from '../../core/src/team.js';
import { ConversationLibrary } from '../src/execution/conversationLibrary.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'office-pending-'));
  roots.push(root);
  const project = join(root, 'project');
  mkdirSync(project);
  const directory = join(root, 'history');
  const library = new ConversationLibrary(directory);
  const conversation = library.create(library.register(project).id);
  const task = {
    id: randomUUID(),
    conversationId: conversation.id,
    role: 'chief',
    title: 'Objetivo',
    prompt: 'Primera petición',
    output: 'Resultado',
    status: 'running',
    reasonCode: null,
  } as TeamTask;
  const attachment: OfficeArtifact = {
    id: randomUUID(),
    name: 'imagen.png',
    mime: 'image/png',
    size: 100,
    createdAt: new Date().toISOString(),
    kind: 'attachment',
    conversationId: conversation.id,
  };
  return { library, directory, conversation, task, attachment };
}
const pending = (content = 'Después, revisa el resultado') => ({
  id: randomUUID(),
  content,
  officeMode: true,
});

describe('persistent conversation inputs', () => {
  it('reopens completed requests and immediate instructions with matching final states', () => {
    const { library, directory, conversation, task } = fixture();
    library.record(task);
    library.recordUserInstruction(task, randomUUID(), 'Comprueba también el historial');
    task.status = 'completed';
    library.record(task);
    const before = JSON.parse(JSON.stringify(library.conversation(conversation.id)));
    const after = new ConversationLibrary(directory).conversation(conversation.id);
    expect(after).toEqual(before);
    expect(after.messages.every((m) => m.status === 'completed' && m.reasonCode === null)).toBe(
      true,
    );
  });
  it('persists ordered inputs and holds them after restart without dispatching', () => {
    const { library, directory, conversation } = fixture();
    const first = library.enqueue(conversation.id, pending('Primero'));
    const second = library.enqueue(conversation.id, pending('Segundo'));
    const reopened = new ConversationLibrary(directory);
    expect(reopened.pendingInputs(conversation.id).map((p) => p.id)).toEqual([first.id, second.id]);
    expect(reopened.pendingInputs().every((p) => p.status === 'queued')).toBe(true);
    expect(reopened.conversation(conversation.id).pendingHold).toBe(true);
  });

  it('makes retried creation idempotent and refuses a changed payload for the same ID', () => {
    const { library, conversation } = fixture();
    const input = pending();
    const saved = library.enqueue(conversation.id, input);
    expect(library.enqueue(conversation.id, { ...input, attachments: [] })).toEqual(saved);
    expect(library.pendingInputs()).toHaveLength(1);
    expect(() =>
      library.enqueue(conversation.id, { ...input, content: 'Otro contenido' }),
    ).toThrow();
    expect(() => library.enqueue(conversation.id, { ...input, officeMode: false })).toThrow();
  });

  it('uses revisions to reject stale edits and removals', () => {
    const { library, conversation } = fixture();
    const input = library.enqueue(conversation.id, pending());
    const updated = library.updatePending(conversation.id, input.id, input.revision, {
      content: 'Cambio',
    });
    expect(updated.revision).toBe(2);
    expect(() =>
      library.updatePending(conversation.id, input.id, 1, { content: 'Obsoleto' }),
    ).toThrow();
    expect(() => library.removePending(conversation.id, input.id, 1)).toThrow();
    expect(library.pendingInputs()[0].content).toBe('Cambio');
    library.removePending(conversation.id, input.id, updated.revision);
    expect(library.pendingInputs()).toEqual([]);
  });

  it('locks dispatched input and keeps uncertain deliveries for review on restart', () => {
    const { library, directory, conversation, task } = fixture();
    const input = library.enqueue(conversation.id, pending());
    library.setPendingState(conversation.id, input.id, 'dispatching', undefined, task.id);
    expect(() =>
      library.updatePending(conversation.id, input.id, 2, { content: 'Cambio' }),
    ).toThrow();
    expect(() => library.removePending(conversation.id, input.id, 2)).toThrow();
    const reopened = new ConversationLibrary(directory);
    const restored = reopened.pendingInputs()[0];
    expect(restored).toMatchObject({ status: 'needs_review', taskId: task.id, revision: 3 });
    expect(reopened.conversation(conversation.id).pendingHold).toBe(true);
    expect(() =>
      reopened.updatePending(conversation.id, input.id, 3, { content: 'Reenvío' }),
    ).toThrow();
    reopened.removePending(conversation.id, input.id, 3);
    expect(reopened.pendingInputs()).toEqual([]);
  });

  it('rejects foreign images, arbitrary paths, duplicate images, oversized text and invalid identifiers', () => {
    const { library, conversation, attachment } = fixture();
    for (const images of [
      [{ ...attachment, conversationId: randomUUID() }],
      [{ ...attachment, path: 'C:\\private\\secret' }],
      [attachment, attachment],
      Array.from({ length: 11 }, () => ({ ...attachment, id: randomUUID() })),
    ]) {
      expect(() =>
        library.enqueue(conversation.id, { ...pending(), attachments: images }),
      ).toThrow();
    }
    expect(() =>
      library.enqueue(conversation.id, { ...pending(), content: 'x'.repeat(12001) }),
    ).toThrow();
    expect(() => library.enqueue(conversation.id, { ...pending(), id: '../outside' })).toThrow();
    expect(library.pendingInputs()).toEqual([]);
  });

  it('returns defensive copies from creation, lists, snapshots and mutation', () => {
    const { library, conversation, attachment } = fixture();
    const input = pending();
    const saved = library.enqueue(conversation.id, { ...input, attachments: [attachment] });
    saved.attachments![0].name = 'changed.png';
    attachment.name = 'also-changed.png';
    library.pendingInputs()[0].content = 'Mutated';
    library.snapshot().selected!.pendingInputs![0].content = 'Mutated';
    const updated = library.updatePending(conversation.id, input.id, 1, { content: 'Revised' });
    updated.content = 'Mutated';
    expect(library.pendingInputs()[0]).toMatchObject({
      content: 'Revised',
      attachments: [{ name: 'imagen.png' }],
    });
  });

  it('requires a durable request before removing a dispatched input', () => {
    const { library, directory, conversation, task } = fixture();
    const input = library.enqueue(conversation.id, pending());
    library.setPendingState(conversation.id, input.id, 'dispatching', undefined, task.id);
    expect(() => library.completePending(conversation.id, input.id)).toThrow();
    library.recordUserInstruction(task, input.id, input.content);
    library.completePending(conversation.id, input.id);
    library.completePending(conversation.id, input.id);
    const reopened = new ConversationLibrary(directory);
    expect(reopened.pendingInputs()).toEqual([]);
    expect(reopened.conversation(conversation.id).messages).toContainEqual(
      expect.objectContaining({ inputId: input.id, content: input.content }),
    );
  });

  it('atomically associates the normal task request and removes its pending input', () => {
    const { library, directory, conversation, task } = fixture();
    const input = library.enqueue(conversation.id, pending());
    library.setPendingState(conversation.id, input.id, 'dispatching', undefined, task.id);
    task.prompt = input.content;
    library.record(task);
    library.completePending(conversation.id, input.id);
    const restored = new ConversationLibrary(directory).conversation(conversation.id);
    expect(restored.messages.find((m) => m.id === `${task.id}-request`)?.inputId).toBe(input.id);
    expect(restored.pendingInputs).toEqual([]);
    expect(() => library.enqueue(conversation.id, input)).toThrow();
  });

  it('keeps human steering requests through subsequent task streaming and snapshots', () => {
    const { library, directory, conversation, task } = fixture();
    library.record(task);
    const input = pending('Aplica el nuevo requisito');
    library.recordUserInstruction(task, input.id, input.content);
    library.recordUserInstruction(task, input.id, input.content);
    task.output = 'Entrega revisada';
    task.status = 'completed';
    library.record(task, 'Entrega revisada');
    const messages = new ConversationLibrary(directory).conversation(conversation.id).messages;
    expect(messages.filter((m) => m.inputId === input.id)).toHaveLength(1);
    expect(messages.find((m) => m.inputId === input.id)).toMatchObject({
      kind: 'request',
      origin: 'user',
      content: input.content,
    });
    expect(() => library.recordUserInstruction(task, input.id, 'Otro')).toThrow();
  });

  it('labels employee interactions as internal without changing chief/user interactions', () => {
    const { library, conversation, task } = fixture();
    library.record(task);
    library.record({ ...task, id: randomUUID(), officeParentId: task.id, role: 'developer' });
    const messages = library.conversation(conversation.id).messages;
    expect(messages.slice(0, 2).every((m) => m.origin === 'user')).toBe(true);
    expect(messages.slice(2).every((m) => m.origin === 'internal')).toBe(true);
  });

  it('fails closed for corrupt new fields while retaining version-one legacy history', () => {
    const { library, directory, conversation, task } = fixture();
    library.record(task);
    const file = join(directory, 'conversations.json');
    const original = JSON.parse(readFileSync(file, 'utf8'));
    for (const message of original.conversations[0].messages) delete message.origin;
    writeFileSync(file, JSON.stringify(original));
    expect(new ConversationLibrary(directory).canWrite).toBe(true);
    const damaged = structuredClone(original);
    damaged.conversations[0].pendingInputs = [
      { ...pending(), createdAt: 1, updatedAt: 1, status: 'invented', revision: 1 },
    ];
    for (const path of [file, `${file}.bak`]) writeFileSync(path, JSON.stringify(damaged));
    const reopened = new ConversationLibrary(directory);
    expect(reopened.canWrite).toBe(false);
    expect(readFileSync(file, 'utf8')).toContain('invented');
    expect(library.conversation(conversation.id).messages).toHaveLength(2);
  });
});
