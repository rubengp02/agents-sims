import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AntigravityTailer } from '../src/providers/hook/antigravity/antigravityTailer.js';
import { ANTIGRAVITY_SESSION_STALE_MS } from '../src/providers/hook/antigravity/constants.js';

let root: string;
let events: Array<Record<string, unknown>>;
let tailer: AntigravityTailer;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'antigravity-observer-'));
  events = [];
  tailer = new AntigravityTailer('http://127.0.0.1:1', 'fixture', root, async (event) => {
    events.push(event);
  });
});
afterEach(() => {
  tailer.stop();
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});
function file(id = 'session-1') {
  const result = join(root, id, '.system_generated', 'logs', 'transcript.jsonl');
  mkdirSync(dirname(result), { recursive: true });
  return result;
}
const step = (state: string) => ({
  event: 'step_update',
  step_update: {
    step_type: 'tool',
    step_index: 3,
    state,
    tool_name: 'read_file',
    tool_info: { parameters: { path: 'README.md' } },
  },
});
const emit = (path: string, raw: unknown) => appendFileSync(path, JSON.stringify(raw) + '\n');

describe('Antigravity observation is based on new evidence', () => {
  it('does not replay old activity on startup, expiry or restart', async () => {
    const p = file();
    emit(p, step('ACTIVE'));
    tailer.start();
    await tailer.poll();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + ANTIGRAVITY_SESSION_STALE_MS * 4);
    await tailer.poll();
    tailer.stop();
    tailer.start();
    await tailer.poll();
    expect(events).toEqual([]);
  });

  it('keeps a tool active until its actual DONE event and ends turns only on a final result', async () => {
    const p = file();
    tailer.start();
    emit(p, step('ACTIVE'));
    await tailer.poll();
    expect(events.map((x) => x.hook_event_name)).toEqual(['SessionStart', 'ExecStart']);
    emit(p, { source: 'MODEL', status: 'DONE' });
    await tailer.poll();
    expect(events).toHaveLength(2);
    emit(p, step('DONE'));
    await tailer.poll();
    expect(events.at(-1)?.hook_event_name).toBe('ExecEnd');
    emit(p, { event: 'result', result: { status: 'SUCCESS' } });
    await tailer.poll();
    expect(events.at(-1)?.hook_event_name).toBe('TurnEnd');
  });

  it('does not repeat inactive sessions until new data arrives', async () => {
    const p = file();
    tailer.start();
    emit(p, step('ACTIVE'));
    await tailer.poll();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + ANTIGRAVITY_SESSION_STALE_MS + 1);
    await tailer.poll();
    await tailer.poll();
    expect(events.filter((x) => x.hook_event_name === 'SessionStart')).toHaveLength(1);
    expect(events.filter((x) => x.hook_event_name === 'SessionEnd')).toHaveLength(1);
    emit(p, { event: 'result', result: { status: 'SUCCESS' } });
    await tailer.poll();
    expect(events.filter((x) => x.hook_event_name === 'SessionStart')).toHaveLength(2);
  });

  it('handles truncation, partial lines and new files without duplicate events', async () => {
    tailer.start();
    const p = file('new-session');
    emit(p, step('ACTIVE'));
    await tailer.poll();
    expect(events.filter((x) => x.hook_event_name === 'ExecStart')).toHaveLength(1);
    writeFileSync(p, '{"event":"result",');
    await tailer.poll();
    appendFileSync(p, '"result":{"status":"SUCCESS"}}\n');
    await tailer.poll();
    expect(events.filter((x) => x.hook_event_name === 'TurnEnd')).toHaveLength(1);
    await tailer.poll();
    expect(events.filter((x) => x.hook_event_name === 'TurnEnd')).toHaveLength(1);
  });

  it('serializes overlapping polls and stops delivery when disabled', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    tailer = new AntigravityTailer('http://127.0.0.1:1', 'fixture', root, async (event) => {
      events.push(event);
      await pending;
    });
    const p = file();
    tailer.start();
    emit(p, step('ACTIVE'));
    const first = tailer.poll();
    expect(tailer.poll()).toBe(first);
    expect(events).toHaveLength(1);
    tailer.stop();
    release();
    await first;
    expect(events).toHaveLength(1);
    await tailer.poll();
    expect(events).toHaveLength(1);
  });

  it('matches legacy tool results by ID and does not fabricate completion', async () => {
    const p = file();
    tailer.start();
    emit(p, { tool_calls: [{ id: 'a', name: 'read_file', args: {} }] });
    await tailer.poll();
    expect(events.map((x) => x.hook_event_name)).toEqual(['SessionStart', 'ExecStart']);
    emit(p, { tool_results: [{ tool_call_id: 'wrong' }] });
    await tailer.poll();
    expect(events).toHaveLength(2);
    emit(p, { tool_results: [{ tool_call_id: 'a' }] });
    await tailer.poll();
    expect(events.at(-1)?.hook_event_name).toBe('ExecEnd');
  });

  it('never sends its office authentication token to a remote server', () => {
    expect(() => new AntigravityTailer('https://example.com', 'fixture', root)).toThrow();
    expect(() => new AntigravityTailer('http://example.com', 'fixture', root)).toThrow();
  });
});
