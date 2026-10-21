/**
 * Adapted from Claw-Empire buildAgentArgs in core/cli-tools.ts at
 * 66a24ea7df2435ef897c48c147deb7ec572c01c2, Apache-2.0.
 * Changes: no permission bypass, bounded turns, safe mode, stdin prompt,
 * explicit effort and strict MCP. See THIRD_PARTY_NOTICES.md.
 * Constructing arguments does not authorize execution; subscription gate is mandatory.
 */
import type { ExecuteOptions } from './types.js';

export function buildClaudeArguments(
  options: ExecuteOptions,
  model: string,
  effort: string,
): string[] {
  return [
    '--print',
    '--verbose',
    '--output-format',
    'stream-json',
    '--safe-mode',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--setting-sources',
    '',
    '--no-chrome',
    '--no-session-persistence',
    '--permission-mode',
    'dontAsk',
    '--max-turns',
    '12',
    '--model',
    model,
    '--effort',
    effort,
    '--tools',
    options.allowWrites ? 'Read,Glob,Grep,Edit,Write,Bash' : 'Read,Glob,Grep',
  ];
}
