import { basename } from 'node:path';

import type { OfficePresence, OfficePresenceSnapshot } from '../../core/src/officePresence.js';
import { TEAM_ROLES } from '../../core/src/team.js';
import type { AgentStateStore } from './agentStateStore.js';
import { officeWorkSignal } from './execution/officeWorkSignal.js';
import type { TeamCoordinator } from './execution/teamCoordinator.js';

/** Observation never grants employee identity. Only the coordinator sets officeRole. */
export function officePresence(
  store: AgentStateStore,
  team: TeamCoordinator,
): OfficePresenceSnapshot {
  const snapshot = team.snapshot();
  const employees: OfficePresence[] = [],
    sessions: OfficePresence[] = [];
  for (const agent of store.values()) {
    const task = [...snapshot.tasks].reverse().find((task) => task.agentId === agent.id);
    const project = snapshot.library?.projects.find((project) => project.path === agent.projectDir);
    const signal = agent.officeRole ? officeWorkSignal(task, snapshot.tasks) : undefined;
    if (
      signal?.active &&
      snapshot.toolApprovals?.some((approval) => approval.taskId === task?.id)
    ) {
      signal.label = 'Necesita aprobación';
      signal.tone = 'paused';
      signal.active = false;
    }
    const status: OfficePresence['status'] = agent.officeRole
      ? task && ['paused', 'blocked', 'failed'].includes(task.status)
        ? 'En pausa'
        : task && ['completed', 'cancelled'].includes(task.status)
          ? 'Terminado'
          : !agent.isWaiting
            ? 'Trabajando'
            : 'Disponible'
      : agent.isWaiting
        ? 'Disponible'
        : agent.activeToolIds.size || agent.currentHookToolId
          ? 'Trabajando'
          : 'Disponible';
    const presence: OfficePresence = {
      id: agent.id,
      name: agent.officeRole
        ? TEAM_ROLES[agent.officeRole]
        : `Sesión de ${agent.providerId === 'codex' ? 'Codex' : (agent.providerId ?? 'Claude')}`,
      project:
        project?.name ??
        (!agent.officeRole ? agent.folderName : undefined) ??
        (agent.projectDir ? basename(agent.projectDir) : (agent.folderName ?? 'Sin proyecto')),
      provider: agent.providerId ?? 'claude',
      status,
      ...(signal ? { signal } : {}),
    };
    (agent.officeRole ? employees : sessions).push(presence);
  }
  return { employees, sessions };
}

/** Filter the standalone office presentation, preserving all observed sessions in the store. */
export function employeeMessage(
  message: Record<string, unknown>,
  store: AgentStateStore,
): Record<string, unknown> | null {
  if (message.type === 'existingAgents') {
    const agents = (message.agents as number[]).filter((id) => !!store.get(id)?.officeRole);
    const result: Record<string, unknown> = { ...message, agents };
    for (const key of ['agentMeta', 'folderNames', 'externalAgents'])
      if (message[key])
        result[key] = Object.fromEntries(
          Object.entries(message[key] as object).filter(([id]) => agents.includes(Number(id))),
        );
    return result;
  }
  if (
    typeof message.id === 'number' &&
    !store.get(message.id)?.officeRole &&
    message.type !== 'agentClosed'
  )
    return null;
  return message;
}
