import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { prepareAntigravityWorkspace } from '../src/execution/antigravityWorkspace.js';

const roots: string[] = [];
afterEach(() => {
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});
function profile() {
  const root = mkdtempSync(join(tmpdir(), 'agy-policy-'));
  roots.push(root);
  return prepareAntigravityWorkspace(root, 'fixture', {
    url: 'http://127.0.0.1:12345/mcp',
    token: 'local-fixture',
  });
}
function invoke(p: ReturnType<typeof profile>, name: string, args: unknown = {}) {
  const config = JSON.parse(readFileSync(join(p.cwd, '.agents', 'hooks.json'), 'utf8'));
  const command = config['office-policy'].PreToolUse[0].hooks[0].command;
  return JSON.parse(
    execSync(command, {
      cwd: join(p.cwd, '.agents'),
      windowsHide: true,
      input: JSON.stringify({ toolCall: { name, args } }),
      encoding: 'utf8',
    }),
  );
}
describe('private Antigravity policy', () => {
  it('runs through the actual hook shell, denies native operations and allows only its MCP', () => {
    const p = profile();
    expect(invoke(p, 'run_command', { CommandLine: 'echo nope' }).decision).toBe('deny');
    expect(invoke(p, 'read_file', { Path: 'C:/private.json' }).decision).toBe('deny');
    expect(
      invoke(p, 'call_mcp_tool', {
        ServerName: JSON.stringify(p.serverName),
        ToolName: JSON.stringify('project_read'),
      }).decision,
    ).toBe('auto_approve');
    expect(
      invoke(p, 'call_mcp_tool', { ServerName: 'other', ToolName: 'project_read' }).decision,
    ).toBe('deny');
    expect(
      invoke(p, 'call_mcp_tool', { ServerName: p.serverName, ToolName: 'unknown' }).decision,
    ).toBe('deny');
    expect(p.evidence()).toEqual({ seen: true, allowed: 1, denied: 4 });
  });
  it('detects altered policies and revokes the transient connection on close', () => {
    const p = profile();
    p.check();
    writeFileSync(join(p.cwd, 'office-guard.cjs'), 'changed');
    expect(() => p.check()).toThrow();
    p.close();
    expect(readFileSync(join(p.cwd, '.agents', 'mcp_config.json'), 'utf8')).not.toContain(
      'local-fixture',
    );
  });
});
