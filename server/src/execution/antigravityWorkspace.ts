import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

import { OFFICE_TOOL_NAMES } from '../tools/toolRuntime.js';
import { ExecutionBlocked } from './types.js';

function shellArgument(value: string): string {
  if (process.platform === 'win32') {
    if (/["%!\r\n]/.test(value))
      throw new ExecutionBlocked(
        'antigravity_hook_path',
        'La ruta del auxiliar no es compatible con el shell de hooks.',
      );
    return '"' + value + '"';
  }
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

/** Private working directory: the implementation is accessed solely through office MCP. */
export function prepareAntigravityWorkspace(
  stateDir: string,
  key: string,
  toolServer: { url: string; token: string },
) {
  const endpoint = new URL(toolServer.url);
  if (
    endpoint.protocol !== 'http:' ||
    endpoint.hostname !== '127.0.0.1' ||
    endpoint.pathname !== '/mcp' ||
    endpoint.username ||
    endpoint.password ||
    !toolServer.token
  )
    throw new ExecutionBlocked(
      'antigravity_tools_invalid',
      'El puente debe pertenecer a la oficina local.',
    );
  const digest = createHash('sha256').update(key).digest('hex');
  const root = join(stateDir, 'antigravity-workspaces', digest);
  mkdirSync(join(root, '.agents'), { recursive: true, mode: 0o700 });
  const cwd = realpathSync(root);
  if (!isAbsolute(cwd)) throw new Error('workspace');
  const serverName = 'oficina_' + digest.slice(0, 16);
  const names = OFFICE_TOOL_NAMES.flatMap((name) => [
    'mcp_' + serverName + '_' + name,
    'mcp__' + serverName + '__' + name,
    serverName + '_' + name,
    serverName + '__' + name,
  ]);
  const schemas = OFFICE_TOOL_NAMES.map((name) =>
    join(homedir(), '.gemini', 'antigravity-cli', 'mcp', serverName, name + '.json'),
  );
  const receipt = join(cwd, 'guard-receipt.json');
  const nonce = randomUUID();
  const script = [
    "'use strict';",
    "const fs = require('node:fs');",
    'const allowed = new Set(' + JSON.stringify(names) + ');',
    'const serverName = ' + JSON.stringify(serverName) + ';',
    'const toolNames = new Set(' + JSON.stringify(OFFICE_TOOL_NAMES) + ');',
    'const schemas = new Set(' + JSON.stringify(schemas) + ');',
    'const receipt = ' + JSON.stringify(receipt) + ';',
    'const nonce = ' + JSON.stringify(nonce) + ';',
    "let text = ''; process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', chunk => { text += chunk; if(text.length > 2000000) process.exit(1); });",
    "process.stdin.on('end', () => {",
    ' try {',
    '  const payload = JSON.parse(text);',
    '  const call = payload.toolCall;',
    "  const unquote = value => { if(typeof value !== 'string') return value; try { const parsed = JSON.parse(value); return typeof parsed === 'string' ? parsed : value; } catch { return value; } };",
    '  const args = call && call.args || {};',
    "  const mcp = call && call.name === 'call_mcp_tool' && unquote(args.ServerName) === serverName && toolNames.has(unquote(args.ToolName));",
    "  let schema = false; if(call && call.name === 'read_file') { try { const p=unquote(args.Path); schema=schemas.has(p) && fs.realpathSync(p)===p && !fs.lstatSync(p).isSymbolicLink(); } catch {} }",
    '  const permitted = !!call && (allowed.has(call.name) || mcp || schema);',
    "  let previous = {}; try { previous = JSON.parse(fs.readFileSync(receipt, 'utf8')); } catch {}",
    '  fs.writeFileSync(receipt, JSON.stringify({nonce, seen:true, allowed:(previous.allowed||0)+(permitted?1:0), denied:(previous.denied||0)+(permitted?0:1)}), {mode:0o600});',
    "  process.stdout.write(JSON.stringify({decision:permitted?'auto_approve':'deny', reason:permitted?'Operación mediada por la oficina.':'Usa las herramientas MCP de la oficina; las herramientas nativas no tienen permiso para este encargo.'}));",
    " } catch { process.stdout.write(JSON.stringify({decision:'deny',reason:'No se pudo verificar la operación.'})); }",
    '});',
  ].join('\n');
  const guard = join(cwd, 'office-guard.cjs');
  const hooks = join(cwd, '.agents', 'hooks.json');
  const mcp = join(cwd, '.agents', 'mcp_config.json');
  writeFileSync(guard, script, { mode: 0o600 });
  writeFileSync(receipt, JSON.stringify({ nonce, seen: false, allowed: 0, denied: 0 }), {
    mode: 0o600,
  });
  writeFileSync(
    hooks,
    JSON.stringify({
      'office-policy': {
        PreToolUse: [
          {
            matcher: '*',
            hooks: [
              {
                type: 'command',
                command:
                  process.platform === 'win32'
                    ? 'node ../office-guard.cjs'
                    : shellArgument(process.execPath) + ' ' + shellArgument(guard),
                timeout: 10,
              },
            ],
          },
        ],
      },
    }),
    { mode: 0o600 },
  );
  writeFileSync(
    mcp,
    JSON.stringify({
      mcpServers: {
        [serverName]: {
          serverUrl: toolServer.url,
          headers: { Authorization: 'Bearer ' + toolServer.token },
          timeoutSeconds: -1,
        },
      },
    }),
    { mode: 0o600 },
  );
  const files = [guard, hooks, mcp];
  const hashes = files.map((file) => createHash('sha256').update(readFileSync(file)).digest('hex'));
  return {
    cwd,
    serverName,
    check() {
      if (
        files.some(
          (file, index) =>
            createHash('sha256').update(readFileSync(file)).digest('hex') !== hashes[index],
        )
      )
        throw new ExecutionBlocked(
          'antigravity_policy_changed',
          'El perfil de permisos cambió durante el encargo.',
        );
    },
    evidence(): { seen: boolean; allowed: number; denied: number } {
      const record = JSON.parse(readFileSync(receipt, 'utf8'));
      if (record.nonce !== nonce)
        throw new ExecutionBlocked(
          'antigravity_policy_changed',
          'La comprobación del guardián no corresponde a esta ejecución.',
        );
      return { seen: record.seen === true, allowed: record.allowed, denied: record.denied };
    },
    close() {
      // Revoke the transient bearer even when a native CLI transcript is retained.
      writeFileSync(mcp, JSON.stringify({ mcpServers: {} }), { mode: 0o600 });
    },
  };
}
