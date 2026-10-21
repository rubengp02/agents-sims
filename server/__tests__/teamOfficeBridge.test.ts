import { describe, expect, it, vi } from 'vitest';

import type { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { DisabledExecutor } from '../src/execution/optionalExecutors.js';
import { TeamCoordinator } from '../src/execution/teamCoordinator.js';
import { TeamOfficeBridge } from '../src/execution/teamOfficeBridge.js';
import type { RunRecord } from '../src/execution/types.js';
import { setAgentRemovalCallback, startStaleExternalAgentCheck } from '../src/fileWatcher.js';

function harness() {
  const store = new AgentStateStore();
  const registerAgent = vi.fn(),
    unregisterAgent = vi.fn();
  const removeAgent = vi.fn((id: number) => store.delete(id));
  const runtime = { registerAgent, unregisterAgent, removeAgent } as unknown as AgentRuntime;
  const bridge = new TeamOfficeBridge(store, runtime);
  const team = new TeamCoordinator({
    codex: {
      ...new DisabledExecutor('claude'),
      provider: 'codex',
      diagnose: async () => {
        throw new Error();
      },
      execute: async () => {
        throw new Error();
      },
    },
    claude: new DisabledExecutor('claude'),
  });
  const task = team.addTask({ role: 'developer', title: 'x', prompt: 'x', project: process.cwd() });
  const record: RunRecord = {
    version: 1,
    id: 'fixture',
    provider: 'codex',
    billing: 'subscription-only',
    status: 'running',
    project: task.project,
    requestedModel: 'fixture-model',
    requestedEffort: 'low',
    confirmedModel: null,
    sessionId: 'fixture-session',
    startedAt: 0,
    updatedAt: 0,
    reasonCode: null,
    inputTokens: null,
    outputTokens: null,
  };
  return { store, registerAgent, unregisterAgent, runtime, bridge, task, record };
}

describe('execution to existing office bridge', () => {
  it('keeps two real worker instances of the same role independent without changing sprites', () => {
    const h = harness();
    const a = { ...h.task, workerId: 'worker-a' },
      b = { ...h.task, id: 'other-task', workerId: 'worker-b' };
    const first = h.bridge.state(a, h.record)!;
    const second = h.bridge.state(b, { ...h.record, id: 'other-run', sessionId: 'other-session' })!;
    expect(first).not.toBe(second);
    h.bridge.activity(a, 'working');
    h.bridge.activity(b, 'reading');
    expect([...h.store.get(first)!.activeToolNames.values()]).toContain('Edit');
    expect([...h.store.get(second)!.activeToolNames.values()]).toContain('Read');
    h.bridge.state(a, { ...h.record, status: 'completed' });
    expect(h.store.get(first)!.isWaiting).toBe(true);
    expect(h.store.get(second)!.isWaiting).toBe(false);
    const bridge = new TeamOfficeBridge(h.store, h.runtime);
    expect(bridge.state(b, { ...h.record, sessionId: 'other-session' })).toBe(second);
  });
  it('does not remove a managed role when external observation hooks are disabled', () => {
    vi.useFakeTimers();
    const h = harness();
    h.bridge.state(h.task, h.record);
    const remove = vi.fn();
    setAgentRemovalCallback(remove);
    const timer = startStaleExternalAgentCheck(h.store, new Set(), { current: false });
    try {
      vi.advanceTimersByTime(60000);
      expect(remove).not.toHaveBeenCalled();
      expect(h.store.size).toBe(1);
    } finally {
      clearInterval(timer);
      setAgentRemovalCallback(null);
      vi.useRealTimers();
    }
  });
  it('creates a character only after the official executor reports running', () => {
    const h = harness();
    expect(h.bridge.state(h.task, { ...h.record, status: 'blocked' })).toBeNull();
    expect(h.store.size).toBe(0);
    const id = h.bridge.state(h.task, h.record);
    expect(h.store.size).toBe(1);
    expect(h.registerAgent).toHaveBeenCalledWith('fixture-session', id, 'codex');
    h.bridge.state(h.task, h.record);
    expect(h.store.size).toBe(1);
  });
  it('translates safe activities and clears both render and stored tools at completion', () => {
    const h = harness();
    const id = h.bridge.state(h.task, h.record)!;
    const messages: Record<string, unknown>[] = [];
    h.store.on('broadcast', (message) => messages.push(message));
    h.bridge.activity(h.task, 'working');
    expect(h.store.get(id)!.activeToolNames.values().next().value).toBe('Edit');
    h.bridge.activity(h.task, 'thinking');
    expect(h.store.get(id)!.activeToolIds.size).toBe(0);
    h.bridge.activity(h.task, 'reading');
    expect(messages.some((message) => message.toolName === 'Read')).toBe(true);
    h.bridge.state(h.task, { ...h.record, status: 'completed' });
    expect(h.store.get(id)!.isWaiting).toBe(true);
    expect(h.store.get(id)!.activeToolIds.size).toBe(0);
    expect(messages.at(-1)).toMatchObject({ type: 'agentStatus', status: 'waiting' });
  });
  it('reuses a role character across consecutive tasks and creates a separate one for Tester', () => {
    const h = harness();
    const id = h.bridge.state(h.task, h.record);
    expect(
      h.bridge.state(
        { ...h.task, id: 'task-two' },
        { ...h.record, id: 'run-two', sessionId: 'new-session' },
      ),
    ).toBe(id);
    expect(
      h.bridge.state({ ...h.task, role: 'tester' }, { ...h.record, id: 'run-three' }),
    ).not.toBe(id);
    expect(h.store.size).toBe(2);
  });
  it('keeps one character for a role across many runs and bridge reattachment', () => {
    const h = harness();
    const first = h.bridge.state(h.task, h.record)!;
    for (let index = 0; index < 30; index++) {
      h.bridge.state(h.task, { ...h.record, status: 'completed' });
      expect(
        h.bridge.state(
          { ...h.task, id: `task-${index}` },
          { ...h.record, sessionId: `session-${index}` },
        ),
      ).toBe(first);
    }
    const reattached = new TeamOfficeBridge(h.store, h.runtime);
    expect(reattached.state(h.task, h.record)).toBe(first);
    reattached.activity(h.task, 'working');
    expect(h.store.get(first)?.activeToolNames.values().next().value).toBe('Edit');
    expect(h.store.size).toBe(1);
    expect(h.unregisterAgent).toHaveBeenCalled();
  });
  it('does not persist queue characters as generic external transcript sessions', () => {
    const h = harness();
    const saveAgents = vi.fn();
    h.store.setAdapter({
      loadAgents: () => [],
      saveAgents,
      loadSeats: () => ({}),
      saveSeats: () => {},
      getSetting: (_key, fallback) => fallback,
      setSetting: () => {},
    });
    h.bridge.state(h.task, h.record);
    h.store.persist();
    expect(saveAgents).toHaveBeenCalledWith([]);
  });
  it('merges an observer twin from the thread-start race without replacing the role', () => {
    const h = harness();
    const roleId = h.bridge.state(h.task, h.record)!;
    h.store.set(99, {
      ...h.store.get(roleId)!,
      id: 99,
      officeRole: undefined,
      sessionId: 'next-session',
    });
    expect(h.bridge.state(h.task, { ...h.record, sessionId: 'next-session' })).toBe(roleId);
    expect(h.store.has(99)).toBe(false);
    expect(h.store.size).toBe(1);
  });
});
