import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { OfficeSessionFilter } from '../src/execution/officeSessionFilter.js';
import { codexProvider } from '../src/providers/hook/codex/codex.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function harness() {
  const root = mkdtempSync(join(tmpdir(), 'pixel-owned-sessions-'));
  roots.push(root);
  const file = join(root, '00000000-0000-0000-0000-000000000001.json');
  const transcript = join(root, 'rollout.jsonl');
  const now = Date.now();
  writeFileSync(transcript, '');
  utimesSync(transcript, now / 1000, now / 1000);
  const record = {
    version: 1,
    provider: 'codex',
    billing: 'subscription-only',
    sessionId: 'owned',
    status: 'completed',
    updatedAt: now,
  };
  const save = (extra: Record<string, unknown> = {}) =>
    writeFileSync(file, JSON.stringify({ ...record, ...extra }));
  save();
  return { root, file, transcript, now, save, filter: new OfficeSessionFilter(root) };
}

describe('office-owned sessions are not duplicated by observation', () => {
  it('suppresses finished legacy executions across a new office process', () => {
    const h = harness();
    expect(new OfficeSessionFilter(h.root).shouldIgnore('codex', 'owned', h.transcript)).toBe(true);
    expect(h.filter.shouldIgnore('codex', 'other', h.transcript)).toBe(false);
    expect(h.filter.shouldIgnore('claude', 'owned', h.transcript)).toBe(false);
  });
  it('suppresses active managed roles but still observes direct CLI runs', () => {
    const h = harness();
    h.save({ status: 'running' });
    expect(h.filter.shouldIgnore('codex', 'owned')).toBe(false);
    h.save({ status: 'running', officeRole: 'developer' });
    expect(h.filter.shouldIgnore('codex', 'owned')).toBe(true);
  });
  it('allows a genuine later manual continuation, including events without a transcript path', () => {
    const h = harness();
    expect(h.filter.shouldIgnore('codex', 'owned', h.transcript)).toBe(true);
    utimesSync(h.transcript, (h.now + 10000) / 1000, (h.now + 10000) / 1000);
    expect(h.filter.shouldIgnore('codex', 'owned', h.transcript)).toBe(false);
    expect(h.filter.shouldIgnore('codex', 'owned')).toBe(false);
  });
  it('uses the latest receipt when a native session is explicitly resumed', () => {
    const h = harness();
    utimesSync(h.transcript, (h.now + 10000) / 1000, (h.now + 10000) / 1000);
    writeFileSync(
      join(h.root, '00000000-0000-0000-0000-000000000002.json'),
      JSON.stringify({
        version: 1,
        provider: 'codex',
        billing: 'subscription-only',
        sessionId: 'owned',
        status: 'running',
        officeRole: 'architect',
        updatedAt: h.now + 10000,
      }),
    );
    expect(h.filter.shouldIgnore('codex', 'owned', h.transcript)).toBe(true);
  });
  it('does not classify invalid receipts or unrelated JSON as office ownership', () => {
    const h = harness();
    writeFileSync(h.file, 'invalid');
    expect(h.filter.shouldIgnore('codex', 'owned')).toBe(false);
    h.save({ billing: 'unknown' });
    expect(h.filter.shouldIgnore('codex', 'owned')).toBe(false);
    writeFileSync(h.file, ' '.repeat(32769));
    expect(h.filter.shouldIgnore('codex', 'owned')).toBe(false);
  });
  it('drops observer replay while allowing a real external chat through the runtime', () => {
    const h = harness();
    const store = new AgentStateStore();
    const runtime = new AgentRuntime(store, [codexProvider], {
      ignoreObservedSession: (provider, session, transcript) =>
        h.filter.shouldIgnore(provider, session, transcript),
    });
    runtime.watchAllSessions.current = true;
    try {
      for (const session of ['owned', 'external']) {
        runtime.handleHookEvent('codex', {
          hook_event_name: 'SessionStart',
          session_id: session,
          transcript_path: h.transcript,
          cwd: h.root,
        });
        runtime.handleHookEvent('codex', {
          hook_event_name: 'ExecStart',
          session_id: session,
          tool_id: 'tool',
          tool_name: 'exec',
        });
        expect(store.size).toBe(session === 'owned' ? 0 : 1);
      }
      expect([...store.values()][0].sessionId).toBe('external');
    } finally {
      runtime.dispose();
    }
  });
});
