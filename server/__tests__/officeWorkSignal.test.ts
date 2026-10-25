import { describe, expect, it } from 'vitest';

import type { TeamTask } from '../../core/src/team.js';
import { officeWorkSignal } from '../src/execution/officeWorkSignal.js';

function fixture() {
  const root = {
    id: 'root',
    role: 'chief',
    status: 'running',
    office: { phase: 'working' },
    objectiveRevision: 2,
    conversationId: 'chat',
  } as TeamTask;
  const worker = {
    id: 'worker',
    role: 'developer',
    status: 'running',
    officeParentId: 'root',
    liveActivity: [],
  } as unknown as TeamTask;
  return { root, worker, tasks: [root, worker] };
}
describe('discreet signals from registered work', () => {
  it('does not invent an assignment', () =>
    expect(officeWorkSignal(undefined, [])).toBeUndefined());
  it.each([
    ['Modificando archivos', 'Editando'],
    ['Ejecutando un comando', 'Ejecutando comando'],
    ['Buscando información', 'Buscando'],
  ])('uses observable %s', (title, label) => {
    const f = fixture();
    f.worker.liveActivity = [{ id: 'activity', title, completed: false, at: 1 }];
    expect(officeWorkSignal(f.worker, f.tasks)).toMatchObject({
      label,
      active: true,
      conversationId: 'chat',
    });
    f.worker.liveActivity[0].completed = true;
    expect(officeWorkSignal(f.worker, f.tasks)?.label).toBe('Trabajando');
  });
  it('a stopped objective overrides a stale running employee', () => {
    const f = fixture();
    for (const status of ['paused', 'blocked', 'failed', 'cancelled'] as const) {
      f.root.status = status;
      expect(officeWorkSignal(f.worker, f.tasks)?.active).toBe(false);
    }
    f.root.status = 'paused';
    f.root.humanRequest = { id: 'question', question: 'Decide', responseType: 'text' };
    expect(officeWorkSignal(f.worker, f.tasks)?.label).toBe('Necesita respuesta');
  });
  it('a completed Chief subtask cannot claim a final delivery', () => {
    const f = fixture();
    f.worker.role = 'chief';
    f.worker.status = 'completed';
    expect(officeWorkSignal(f.worker, f.tasks)).toMatchObject({
      label: 'Coordinando',
      active: false,
    });
    f.root.status = 'completed';
    expect(officeWorkSignal(f.worker, f.tasks)?.label).toBe('Finalizado sin ficha');
    f.root.finalEvidence = {
      objectiveRevision: 1,
      review: { state: 'tester', taskId: 'review' },
    } as TeamTask['finalEvidence'];
    expect(officeWorkSignal(f.worker, f.tasks)?.label).toBe('Finalizado sin ficha');
    f.root.finalEvidence!.objectiveRevision = 2;
    expect(officeWorkSignal(f.worker, f.tasks)).toMatchObject({
      label: '✓ Entregado',
      active: false,
      tone: 'done',
    });
    f.worker.role = 'developer';
    expect(officeWorkSignal(f.worker, f.tasks)?.label).toBe('Trabajo terminado');
    f.worker.role = 'tester';
    expect(officeWorkSignal(f.worker, f.tasks)?.label).toBe('Trabajo terminado');
    f.root.finalEvidence!.review.taskId = 'worker';
    expect(officeWorkSignal(f.worker, f.tasks)?.label).toBe('✓ Revisado');
  });
});
