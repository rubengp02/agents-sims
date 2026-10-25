import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type {
  ConversationMessage,
  PendingConversationInput,
} from '../../core/src/conversations.js';
import type { TeamTask } from '../../core/src/team.js';
import {
  conversationDisplayMessages,
  conversationMessageGroups,
  conversationTask,
  executionState,
  isOfficeFinalDelivery,
  stateText,
} from '../src/components/conversationState.js';
import { PendingConversationInputs } from '../src/components/PendingConversationInputs.js';

const message = (
  id: string,
  taskId: string,
  extra: Partial<ConversationMessage> = {},
): ConversationMessage => ({
  id,
  taskId,
  kind: 'response',
  role: 'chief',
  content: 'Entrega',
  createdAt: 1,
  status: 'completed',
  reasonCode: null,
  ...extra,
});
describe('conversation presentation', () => {
  it('shows the completed root summary after its activity and before the next request without rewriting history', () => {
    const messages = [
      message('request', 'root', { kind: 'request', origin: 'user' }),
      message('summary', 'root', { origin: 'user' }),
      message('employee', 'worker', { origin: 'internal' }),
      message('follow-up', 'root', { kind: 'request', origin: 'user' }),
      message('chief-decision', 'chief-child', { origin: 'internal' }),
      message('next-request', 'next', { kind: 'request', origin: 'user' }),
      message('next-employee', 'next-worker', { origin: 'internal' }),
    ];
    const original = structuredClone(messages);
    const tasks = [
      { id: 'root', office: {} },
      { id: 'worker', officeParentId: 'root' },
      { id: 'chief-child', officeParentId: 'root' },
      { id: 'next-worker', officeParentId: 'next' },
    ] as TeamTask[];
    expect(conversationDisplayMessages(messages, tasks).map((m) => m.id)).toEqual([
      'request',
      'employee',
      'follow-up',
      'chief-decision',
      'summary',
      'next-request',
      'next-employee',
    ]);
    expect(
      conversationMessageGroups(messages, tasks).find((g) => g.messages[0].id === 'summary')
        ?.internal,
    ).toBe(false);
    expect(messages).toEqual(original);
    expect(isOfficeFinalDelivery(messages[1], tasks)).toBe(true);
    expect(isOfficeFinalDelivery({ ...messages[1], status: 'paused' }, tasks)).toBe(false);
  });
  it('recovers legacy final summaries after task cleanup and keeps individual answers in place', () => {
    const final = message('summary', 'root', {
      content:
        'Resultado.\n\nLa oficina ha terminado el objetivo con revisión del Tester. La aprobación final del resultado corresponde a la persona.',
    });
    const activity = message('activity', 'child', { origin: 'internal' });
    expect(conversationDisplayMessages([final, activity], []).map((m) => m.id)).toEqual([
      'activity',
      'summary',
    ]);
    const ordinary = { ...final, content: 'Respuesta individual.' };
    expect(conversationDisplayMessages([ordinary, activity], []).map((m) => m.id)).toEqual([
      'summary',
      'activity',
    ]);
    expect(isOfficeFinalDelivery({ ...final, origin: 'internal' }, [])).toBe(false);
  });
  it('keeps the root delivery visible, groups only evidenced internal work and preserves legacy messages', () => {
    const messages = [
      message('request', 'root', { kind: 'request' }),
      message('assignment', 'worker', { officeAssignment: 'Investiga' }),
      message('analysis', 'worker'),
      message('legacy', 'unknown'),
      message('final', 'root'),
    ];
    const original = structuredClone(messages);
    const tasks = [{ id: 'root' }, { id: 'worker', officeParentId: 'root' }] as TeamTask[];
    const groups = conversationMessageGroups(messages, tasks);
    expect(groups.map((group) => [group.internal, group.messages.map((item) => item.id)])).toEqual([
      [false, ['request']],
      [true, ['assignment', 'analysis']],
      [false, ['legacy']],
      [false, ['final']],
    ]);
    expect(messages).toEqual(original);
  });
  it('uses persisted origin after task cleanup and preserves pending-user instructions', () => {
    expect(
      conversationMessageGroups(
        [
          message('a', 'gone', { origin: 'internal' }),
          message('b', 'root', { kind: 'request', origin: 'user' }),
        ],
        [],
      ).map((group) => group.internal),
    ).toEqual([true, false]);
  });
  it('derives current state from the latest root, without replacing it with an old child incident', () => {
    const task = conversationTask(
      [
        { id: 'root', conversationId: 'chat', status: 'paused', reasonCode: 'server_restarted' },
        {
          id: 'child',
          conversationId: 'chat',
          officeParentId: 'root',
          status: 'blocked',
          reasonCode: 'review_changed_files',
        },
      ] as TeamTask[],
      'chat',
    );
    expect(task?.id).toBe('root');
    expect(executionState(task!.status, task!.reasonCode).detail).toContain('reiniciado');
    expect(
      stateText(
        'Un empleado de solo lectura modificó archivos. Se necesita revisión.',
        'review_changed_files',
      ),
    ).toContain('no permite identificar quién');
  });
});

describe('pending input safety presentation', () => {
  const input: PendingConversationInput = {
    id: 'input',
    content: '<texto seguro>',
    officeMode: true,
    createdAt: 1,
    updatedAt: 1,
    revision: 3,
    status: 'queued',
  };
  const render = (entry: PendingConversationInput, canSteer = true, hold = false) =>
    renderToStaticMarkup(
      createElement(PendingConversationInputs, {
        conversationId: 'chat',
        inputs: [entry],
        busy: false,
        canSteer,
        working: true,
        hold,
        action: async () => true,
      }),
    );
  it('keeps queued text escaped and exposes edit/remove without claiming dispatch', () => {
    const html = render(input);
    expect(html).toContain('&lt;texto seguro&gt;');
    expect(html).toContain('Editar');
    expect(html).toContain('Retirar');
    expect(html).not.toContain('Enviando…');
  });
  it('does not offer editing or resubmission while dispatching', () => {
    const html = render({ ...input, status: 'dispatching' });
    expect(html).toContain('Enviando…');
    expect(html).not.toContain('>Editar<');
    expect(html).not.toContain('Aplicar ahora');
  });
  it('blocks immediate retry of uncertain deliveries and explains the uncertainty', () => {
    const html = render(
      { ...input, status: 'needs_review', reason: 'delivery_unknown' },
      true,
      true,
    );
    expect(html).toContain('No se pudo confirmar la entrega');
    expect(html).toMatch(/disabled=""[^>]*aria-label="Aplicar ahora el mensaje pendiente"/);
    expect(html).not.toContain('delivery_unknown');
  });
});
