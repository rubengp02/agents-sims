import type { AgentEvent, HookProvider } from '../../../../../core/src/provider.js';
import { BASH_COMMAND_DISPLAY_MAX_LENGTH } from '../../../constants.js';
import { AntigravityTailer } from './antigravityTailer.js';
import { ANTIGRAVITY_READING_TOOL_NAMES, ANTIGRAVITY_TERMINAL_NAME_PREFIX } from './constants.js';

export function formatToolStatus(toolName: string, input?: unknown): string {
  const inp = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const text = (...keys: string[]) =>
    keys.map((key) => inp[key]).find((value) => typeof value === 'string') as string | undefined;
  switch (toolName) {
    case 'run_command':
    case 'exec_command':
    case 'command': {
      const cmd = text('CommandLine', 'cmd', 'command') ?? '';
      return `Running: ${cmd.length > BASH_COMMAND_DISPLAY_MAX_LENGTH ? cmd.slice(0, BASH_COMMAND_DISPLAY_MAX_LENGTH) + '…' : cmd}`;
    }
    case 'edit_file':
    case 'write_file':
    case 'write_to_file':
    case 'replace_file_content':
    case 'multi_replace_file_content':
    case 'apply_patch':
      return 'Editing files';
    case 'read_file':
    case 'view_file': {
      const p = text('Path', 'path') ?? 'file';
      return `Reading ${p}`;
    }
    case 'search_web':
    case 'read_url_content':
      return 'Searching the web';
    case 'ask_question':
    case 'ask_permission':
      return 'Asking question';
    default:
      return `Using ${toolName}`;
  }
}

function normalizeHookEvent(
  raw: Record<string, unknown>,
): { sessionId: string; event: AgentEvent } | null {
  const eventName = raw.hook_event_name;
  const sessionId = raw.session_id;
  if (typeof eventName !== 'string' || typeof sessionId !== 'string' || !sessionId.trim())
    return null;

  switch (eventName) {
    case 'SessionStart':
      return {
        sessionId,
        event: {
          kind: 'sessionStart',
          transcriptPath: typeof raw.transcript_path === 'string' ? raw.transcript_path : undefined,
          cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined,
        },
      };

    case 'SessionEnd':
      return {
        sessionId,
        event: {
          kind: 'sessionEnd',
          reason: typeof raw.reason === 'string' ? raw.reason : undefined,
        },
      };

    case 'ExecStart': {
      if (typeof raw.tool_id !== 'string' || !raw.tool_id.trim()) return null;
      const toolId = raw.tool_id;
      const toolName = typeof raw.tool_name === 'string' ? raw.tool_name : 'unknown';
      return {
        sessionId,
        event: { kind: 'toolStart', toolId, toolName, input: raw.tool_input },
      };
    }

    case 'ExecEnd': {
      if (typeof raw.tool_id !== 'string' || !raw.tool_id.trim()) return null;
      const toolId = raw.tool_id;
      return { sessionId, event: { kind: 'toolEnd', toolId } };
    }

    case 'TurnEnd':
      return { sessionId, event: { kind: 'turnEnd' } };

    default:
      return null;
  }
}

let tailer: AntigravityTailer | null = null;

function installHooks(serverUrl: string, authToken: string): Promise<void> {
  tailer?.stop();
  tailer = new AntigravityTailer(serverUrl, authToken);
  tailer.start();
  return Promise.resolve();
}

function uninstallHooks(): Promise<void> {
  tailer?.stop();
  tailer = null;
  return Promise.resolve();
}

function areHooksInstalled(): Promise<boolean> {
  return Promise.resolve(tailer?.isRunning ?? false);
}

export const antigravityProvider: HookProvider = {
  kind: 'hook',
  id: 'antigravity',
  displayName: 'Antigravity CLI',
  protocolVersion: 1,

  normalizeHookEvent,

  installHooks,
  uninstallHooks,
  areHooksInstalled,

  formatToolStatus,
  permissionExemptTools: new Set<string>(),
  subagentToolNames: new Set<string>(),
  readingTools: ANTIGRAVITY_READING_TOOL_NAMES,
  terminalNamePrefix: ANTIGRAVITY_TERMINAL_NAME_PREFIX,
};

export function __resetAntigravityTailerForTests(): void {
  tailer?.stop();
  tailer = null;
}
