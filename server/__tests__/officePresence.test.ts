import { describe, expect, it } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import type { TeamCoordinator } from '../src/execution/teamCoordinator.js';
import { employeeMessage, officePresence } from '../src/officePresence.js';
import type { AgentState } from '../src/types.js';

function fixture() {
  const store = new AgentStateStore();
  store.set(1, {
    id: 1,
    officeRole: 'developer',
    providerId: 'codex',
    projectDir: '/private/project',
    isWaiting: true,
    activeToolIds: new Set(),
  } as AgentState);
  store.set(2, {
    id: 2,
    providerId: 'codex',
    folderName: 'Jefe',
    projectDir: '/private/observed',
    isWaiting: true,
    activeToolIds: new Set(),
  } as AgentState);
  const snapshot = {
    tasks: [{ agentId: 1, status: 'completed' }],
    library: { projects: [{ path: '/private/project', name: 'Mi proyecto' }] },
  };
  const team = { snapshot: () => snapshot } as unknown as TeamCoordinator;
  return { store, team, snapshot };
}

describe('office employee presentation', () => {
  it('separates coordinated employees from observed sessions without promoting folder names', () => {
    const { store, team } = fixture();
    const result = officePresence(store, team);
    expect(result.employees).toEqual([
      {
        id: 1,
        name: 'Programador',
        project: 'Mi proyecto',
        provider: 'codex',
        status: 'Terminado',
      },
    ]);
    expect(result.sessions).toEqual([
      {
        id: 2,
        name: 'Sesión de Codex',
        project: 'observed',
        provider: 'codex',
        status: 'Disponible',
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('/private');
    expect(store.size).toBe(2);
  });

  it('reports work, pauses and available employees using actual task and runtime state', () => {
    const { store, team, snapshot } = fixture();
    snapshot.tasks[0].status = 'running';
    store.get(1)!.isWaiting = false;
    expect(officePresence(store, team).employees[0].status).toBe('Trabajando');
    snapshot.tasks[0].status = 'blocked';
    expect(officePresence(store, team).employees[0].status).toBe('En pausa');
    snapshot.tasks.length = 0;
    store.get(1)!.isWaiting = true;
    expect(officePresence(store, team).employees[0].status).toBe('Disponible');
  });

  it('filters initial and live presentation while preserving observations in the store', () => {
    const { store } = fixture();
    expect(
      employeeMessage(
        {
          type: 'existingAgents',
          agents: [1, 2],
          folderNames: { 1: 'Programador', 2: 'Jefe' },
          agentMeta: { 1: {}, 2: {} },
          externalAgents: { 1: true, 2: true },
        },
        store,
      ),
    ).toEqual({
      type: 'existingAgents',
      agents: [1],
      folderNames: { 1: 'Programador' },
      agentMeta: { 1: {} },
      externalAgents: { 1: true },
    });
    for (const type of ['agentCreated', 'agentToolStart', 'agentStatus']) {
      expect(employeeMessage({ type, id: 2 }, store)).toBeNull();
      expect(employeeMessage({ type, id: 1 }, store)).toEqual({ type, id: 1 });
    }
    expect(employeeMessage({ type: 'agentClosed', id: 2 }, store)).toEqual({
      type: 'agentClosed',
      id: 2,
    });
    expect(employeeMessage({ type: 'layoutLoaded' }, store)).toEqual({ type: 'layoutLoaded' });
    expect(store.size).toBe(2);
  });
});
