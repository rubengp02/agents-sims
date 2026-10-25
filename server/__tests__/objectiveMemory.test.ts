import { describe, expect, it } from 'vitest';

import type { TeamTask } from '../../core/src/team.js';
import {
  chiefMemoryPrompt,
  directOfficeAnswer,
  objectiveMemory,
} from '../src/execution/objectiveMemory.js';
import { OfficeToolRuntime } from '../src/tools/toolRuntime.js';

const root = {
  id: 'goal',
  prompt: 'Explica este archivo',
  objectiveRevision: 2,
  userInstructions: [{ id: 'u', content: 'Conserva la compatibilidad', createdAt: 1 }],
  office: { rounds: 0, phase: 'coordinating', summary: '' },
} as TeamTask;
describe('durable objective memory and proportionate team', () => {
  it.each([
    'Incluye también los siguientes pasos.',
    'Resúmelo.',
    'Explícalo mejor.',
    'Reformúlalo en cinco puntos.',
  ])('recognizes informational follow-up: %s', (prompt) => {
    expect(directOfficeAnswer({ ...root, prompt, userInstructions: [] })).toBe(true);
  });
  it.each([
    'Incluye también los siguientes pasos y modifica el código.',
    'Reescribe el servidor.',
    'Resume y publica el resultado.',
    'Pide al Tester una revisión independiente.',
  ])('never treats an operational follow-up as a summary: %s', (content) => {
    expect(
      directOfficeAnswer({ ...root, userInstructions: [{ id: 'new', content, createdAt: 1 }] }),
    ).toBe(false);
  });
  it('preserves implementation requirements when the latest instruction only asks for a summary', () => {
    expect(
      directOfficeAnswer({
        ...root,
        prompt: 'Implementa autenticación',
        userInstructions: [{ id: 'new', content: 'Resúmelo.', createdAt: 1 }],
      }),
    ).toBe(false);
  });
  it('reuses older read-only deliveries only after they are settled and never waives a writer review', () => {
    const goal = { ...root, userInstructions: [], objectiveRevision: 1 };
    const worker = {
      id: 'reader',
      officeParentId: root.id,
      role: 'architect',
      status: 'completed',
      objectiveRevision: 0,
    } as TeamTask;
    expect(directOfficeAnswer(goal, [worker])).toBe(true);
    expect(directOfficeAnswer(goal, [{ ...worker, objectiveRevision: 1 }])).toBe(false);
    expect(directOfficeAnswer(goal, [{ ...worker, status: 'running' }])).toBe(false);
    expect(directOfficeAnswer(goal, [{ ...worker, role: 'developer' }])).toBe(false);
    expect(
      directOfficeAnswer(goal, [
        { ...worker, status: 'cancelled', reasonCode: 'redirected_by_user' },
      ]),
    ).toBe(true);
    expect(directOfficeAnswer(goal, [{ ...worker, status: 'failed' }])).toBe(false);
  });
  it('retains older deliveries and user decisions beyond the recent prompt window', () => {
    const tasks = Array.from({ length: 20 }, (_, i) => ({
      id: 'task-' + i,
      officeParentId: 'goal',
      role: 'architect',
      title: 'Análisis ' + i,
      status: 'completed',
      output: 'Resultado ' + i,
    })) as TeamTask[];
    tasks.push({ id: 'private', officeParentId: 'another-goal', output: 'PRIVATE' } as TeamTask);
    const memory = objectiveMemory(root, tasks);
    expect(memory.deliveries).toHaveLength(20);
    expect(memory.deliveries[0].summary).toBe('Resultado 0');
    expect(memory.instructions[0].content).toBe('Conserva la compatibilidad');
    expect(memory.revision).toBe(2);
    expect(chiefMemoryPrompt(memory)).toContain('task-0');
    expect(chiefMemoryPrompt(memory)).not.toContain('PRIVATE');
    expect(
      objectiveMemory(JSON.parse(JSON.stringify(root)), JSON.parse(JSON.stringify(tasks))),
    ).toEqual(memory);
  });
  it('marks excerpts and retains their source identifiers', () => {
    const memory = objectiveMemory(root, [
      { id: 'long', officeParentId: 'goal', output: 'x'.repeat(6000) } as TeamTask,
    ]);
    expect(memory.deliveries[0]).toMatchObject({ taskId: 'long', shortened: true });
  });
  it('preserves complete structured Chief decisions even when excerpts are shortened', () => {
    const decision = {
      action: 'assign',
      role: 'developer',
      title: 'Corrige',
      task: 'Mantén compatibilidad. ' + 'a'.repeat(2000),
      message: 'Implementación acotada',
    };
    const memory = objectiveMemory(root, [
      {
        id: 'chief-1',
        role: 'chief',
        officeParentId: root.id,
        output: 'OFFICE_DECISION ' + JSON.stringify(decision),
      } as TeamTask,
    ]);
    expect(memory.deliveries[0].decision).toEqual(decision);
    expect(memory.deliveries[0].shortened).toBe(true);
  });
  it('starts small for explanations and expands for sensitive changes', () => {
    expect(objectiveMemory(root, []).team.size).toBe('small');
    expect(
      objectiveMemory({ ...root, prompt: 'Implementa autenticación y permisos' }, []).team.size,
    ).toBe('extended');
    expect(objectiveMemory({ ...root, prompt: 'Corrige el botón' }, []).team.guidance).toContain(
      'Programador y Tester',
    );
  });
  it('provides only the server-bound objective through its tool and respects cancellation', async () => {
    const runtime = new OfficeToolRuntime({ stateDir: '.' });
    const session = runtime.createSession({
      taskId: 'chief',
      role: 'chief',
      project: '.',
      objectiveMemory: () => objectiveMemory(root, []),
    });
    expect(
      JSON.stringify(await session.execute('office_memory', { objectiveId: 'other' })),
    ).toContain('Conserva la compatibilidad');
    await session.dispose();
    await expect(session.execute('office_memory')).rejects.toThrow('detenido');
  });
});
