import { TEAM_ROLES, type TeamTask } from '../../../core/src/team.js';
import type { AgentRuntime } from '../agentRuntime.js';
import type { AgentStateStore } from '../agentStateStore.js';
import { DEFAULT_MAX_CONTEXT_TOKENS } from '../constants.js';
import type { AgentState } from '../types.js';
import type { TeamObserver } from './teamCoordinator.js';
import type { RunRecord } from './types.js';

/** Reuses the office's existing characters and activity messages, without new sprites. */
export class TeamOfficeBridge implements TeamObserver {
  private readonly ids = new Map<string, number>();
  constructor(
    private readonly store: AgentStateStore,
    private readonly runtime: AgentRuntime,
  ) {}

  state(task: TeamTask, record: Readonly<RunRecord>): number | null {
    const key = `${task.role}:${task.workerId ?? `role-${task.role}`}`;
    let id = this.ids.get(key);
    if (!id || !this.store.has(id))
      id = [...this.store.values()].find(
        (agent) =>
          agent.officeRole === task.role &&
          (agent.officeWorkerId === key ||
            (!agent.officeWorkerId && (!task.workerId || task.workerId === `role-${task.role}`))),
      )?.id;
    if (record.status !== 'running' && (!id || !this.store.has(id))) return null;
    if (!id || !this.store.has(id)) {
      id = this.store.nextAgentId.current++;
      const agent: AgentState = {
        id,
        officeRole: task.role,
        officeWorkerId: key,
        sessionId: record.sessionId ?? `managed-${record.id}`,
        isExternal: true,
        projectDir: task.project,
        jsonlFile: '',
        fileOffset: 0,
        lineBuffer: '',
        activeToolIds: new Set(),
        activeToolStatuses: new Map(),
        activeToolNames: new Map(),
        activeSubagentToolIds: new Map(),
        activeSubagentToolNames: new Map(),
        backgroundAgentToolIds: new Set(),
        isWaiting: false,
        permissionSent: false,
        hadToolsInTurn: false,
        folderName: `${TEAM_ROLES[task.role]} · ${record.requestedModel}`,
        lastDataAt: Date.now(),
        linesProcessed: 0,
        seenUnknownRecordTypes: new Set(),
        hookDelivered: true,
        hooksOnly: true,
        providerId: record.provider,
        contextTokens: 0,
        maxContextTokens: DEFAULT_MAX_CONTEXT_TOKENS,
      };
      this.store.set(id, agent);
      this.ids.set(key, id);
    }
    this.ids.set(key, id);
    const agent = this.store.get(id)!;
    if (record.sessionId) {
      // The transcript can be noticed just before thread.started reaches stdout.
      // Merge that observer race into the existing role rather than adding a twin.
      for (const other of [...this.store.values()])
        if (
          other.id !== id &&
          other.sessionId === record.sessionId &&
          other.providerId === record.provider &&
          !other.officeRole
        )
          this.runtime.removeAgent(other.id);
    }
    if (record.sessionId && agent.sessionId !== record.sessionId) {
      this.runtime.unregisterAgent(agent.sessionId, agent.providerId);
      agent.sessionId = record.sessionId;
    }
    if (record.sessionId) this.runtime.registerAgent(record.sessionId, id, record.provider);
    agent.providerId = record.provider;
    agent.projectDir = task.project;
    agent.folderName = `${TEAM_ROLES[task.role]} · ${record.requestedModel}`;
    agent.lastDataAt = Date.now();
    agent.isWaiting = record.status !== 'running';
    if (agent.isWaiting) {
      agent.activeToolIds.clear();
      agent.activeToolStatuses.clear();
      agent.activeToolNames.clear();
      this.store.broadcast({ type: 'agentToolsClear', id });
    }
    this.store.broadcast({
      type: 'agentStatus',
      id,
      status: agent.isWaiting ? 'waiting' : 'active',
    });
    return id;
  }

  activity(task: TeamTask, activity: 'thinking' | 'reading' | 'working'): void {
    const id = this.ids.get(`${task.role}:${task.workerId ?? `role-${task.role}`}`);
    const agent = id === undefined ? undefined : this.store.get(id);
    if (!agent || id === undefined) return;
    this.store.broadcast({ type: 'agentToolsClear', id });
    agent.activeToolIds.clear();
    agent.activeToolNames.clear();
    agent.activeToolStatuses.clear();
    if (activity !== 'thinking') {
      const toolId = `managed-${task.id}`;
      const toolName = activity === 'working' ? 'Edit' : 'Read';
      agent.activeToolIds.add(toolId);
      agent.activeToolNames.set(toolId, toolName);
      agent.activeToolStatuses.set(toolId, activity === 'working' ? 'Trabajando' : 'Consultando');
      this.store.broadcast({
        type: 'agentToolStart',
        id,
        toolId,
        toolName,
        status: activity === 'working' ? 'Trabajando' : 'Consultando',
      });
    }
  }
}
