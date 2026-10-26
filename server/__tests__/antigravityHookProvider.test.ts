import { describe, expect, it } from 'vitest';

import { antigravityProvider } from '../src/providers/hook/antigravity/antigravity.js';

describe('antigravityProvider', () => {
  describe('identity', () => {
    it('has kind "hook"', () => {
      expect(antigravityProvider.kind).toBe('hook');
    });

    it('has id "antigravity"', () => {
      expect(antigravityProvider.id).toBe('antigravity');
    });

    it('has displayName "Antigravity CLI"', () => {
      expect(antigravityProvider.displayName).toBe('Antigravity CLI');
    });

    it('has protocolVersion 1', () => {
      expect(antigravityProvider.protocolVersion).toBe(1);
    });

    it('has reading tools configured', () => {
      expect(antigravityProvider.readingTools.has('read_file')).toBe(true);
      expect(antigravityProvider.readingTools.has('search_web')).toBe(true);
      expect(antigravityProvider.readingTools.has('edit_file')).toBe(false);
    });
  });

  describe('formatToolStatus', () => {
    it('formats command execution tools', () => {
      expect(antigravityProvider.formatToolStatus('run_command', { CommandLine: 'pytest' })).toBe(
        'Running: pytest',
      );
      expect(antigravityProvider.formatToolStatus('exec_command', { cmd: 'git status' })).toBe(
        'Running: git status',
      );
    });

    it('formats file editing tools', () => {
      expect(antigravityProvider.formatToolStatus('edit_file')).toBe('Editing files');
      expect(antigravityProvider.formatToolStatus('write_to_file')).toBe('Editing files');
    });

    it('formats file reading tools', () => {
      expect(antigravityProvider.formatToolStatus('read_file', { Path: 'src/main.ts' })).toBe(
        'Reading src/main.ts',
      );
    });

    it('formats web tools', () => {
      expect(antigravityProvider.formatToolStatus('search_web')).toBe('Searching the web');
    });

    it('formats default tools', () => {
      expect(antigravityProvider.formatToolStatus('custom_tool')).toBe('Using custom_tool');
    });
  });

  describe('normalizeHookEvent', () => {
    it('does not fabricate tool identifiers or crash on malformed command input', () => {
      for (const hook_event_name of ['ExecStart', 'ExecEnd']) {
        expect(
          antigravityProvider.normalizeHookEvent({ hook_event_name, session_id: 's' }),
        ).toBeNull();
        expect(
          antigravityProvider.normalizeHookEvent({ hook_event_name, session_id: '', tool_id: 't' }),
        ).toBeNull();
      }
      expect(antigravityProvider.formatToolStatus('run_command', { CommandLine: {} })).toBe(
        'Running: ',
      );
    });
    it('returns null on invalid payloads', () => {
      expect(antigravityProvider.normalizeHookEvent({})).toBeNull();
      expect(antigravityProvider.normalizeHookEvent({ session_id: 's1' })).toBeNull();
      expect(antigravityProvider.normalizeHookEvent({ hook_event_name: 'Unknown' })).toBeNull();
    });

    it('normalizes SessionStart', () => {
      const res = antigravityProvider.normalizeHookEvent({
        hook_event_name: 'SessionStart',
        session_id: 'sess-1',
        transcript_path: '/path/transcript.jsonl',
      });
      expect(res).toEqual({
        sessionId: 'sess-1',
        event: {
          kind: 'sessionStart',
          transcriptPath: '/path/transcript.jsonl',
          cwd: undefined,
        },
      });
    });

    it('normalizes SessionEnd', () => {
      const res = antigravityProvider.normalizeHookEvent({
        hook_event_name: 'SessionEnd',
        session_id: 'sess-1',
        reason: 'timeout',
      });
      expect(res).toEqual({
        sessionId: 'sess-1',
        event: {
          kind: 'sessionEnd',
          reason: 'timeout',
        },
      });
    });

    it('normalizes ExecStart and ExecEnd', () => {
      const start = antigravityProvider.normalizeHookEvent({
        hook_event_name: 'ExecStart',
        session_id: 'sess-1',
        tool_id: 'tool-1',
        tool_name: 'read_file',
        tool_input: { Path: 'test.txt' },
      });
      expect(start).toEqual({
        sessionId: 'sess-1',
        event: {
          kind: 'toolStart',
          toolId: 'tool-1',
          toolName: 'read_file',
          input: { Path: 'test.txt' },
        },
      });

      const end = antigravityProvider.normalizeHookEvent({
        hook_event_name: 'ExecEnd',
        session_id: 'sess-1',
        tool_id: 'tool-1',
      });
      expect(end).toEqual({
        sessionId: 'sess-1',
        event: {
          kind: 'toolEnd',
          toolId: 'tool-1',
        },
      });
    });

    it('normalizes TurnEnd', () => {
      const res = antigravityProvider.normalizeHookEvent({
        hook_event_name: 'TurnEnd',
        session_id: 'sess-1',
      });
      expect(res).toEqual({
        sessionId: 'sess-1',
        event: { kind: 'turnEnd' },
      });
    });
  });
});
