import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';

import type { TeamRole } from '../../core/src/team.js';
import { LocalChecks } from '../src/execution/localChecks.js';
import { startOfficeMcp } from '../src/tools/officeMcp.js';
import { projectFileTool } from '../src/tools/projectFiles.js';
import { OfficeToolRuntime } from '../src/tools/toolRuntime.js';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'office-project-tools-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  await mkdir(project);
  await writeFile(join(project, 'AGENTS.md'), 'Proyecto de prueba: café');
  return { root, project };
}
describe('shared project tools, real MCP and local processes, no inference', () => {
  it.each<TeamRole>(['chief', 'architect', 'developer', 'tester', 'designer'])(
    'allows %s to discover tools, read files and execute a registered check',
    async (role) => {
      const { root, project } = await fixture();
      const checks = new LocalChecks(
        {
          fixture: {
            executable: process.execPath,
            args: [
              '-e',
              "if(!require('node:fs').readFileSync('AGENTS.md','utf8').includes('café'))process.exit(1)",
            ],
            timeoutMs: 10000,
          },
        },
        join(root, 'logs'),
        project,
      );
      const runtime = new OfficeToolRuntime({ stateDir: join(root, 'state') });
      const session = runtime.createSession({
        taskId: role,
        role,
        project,
        projectChecks: {
          list: () => checks.describe(),
          run: (id) => checks.run([id], project, new AbortController().signal),
        },
      });
      const service = await startOfficeMcp(session);
      cleanups.push(() => service.close());
      const client = new Client({ name: 'fixture', version: '1' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(service.url), {
          requestInit: { headers: { authorization: `Bearer ${service.secret}` } },
        }),
      );
      cleanups.push(() => client.close());
      const names = (await client.listTools()).tools.map((t) => t.name);
      for (const name of [
        'project_list',
        'project_read',
        'project_checks',
        'project_check_run',
        'browser_open',
        'desktop_inspect',
      ])
        expect(names).toContain(name);
      const read = await client.callTool({
        name: 'project_read',
        arguments: { args: { path: 'AGENTS.md' } },
      });
      expect(read.isError).not.toBe(true);
      expect(JSON.stringify(read)).toContain('café');
      const result = await client.callTool({
        name: 'project_check_run',
        arguments: { args: { id: 'fixture' } },
      });
      expect(JSON.stringify(result)).toContain('\\"passed\\":true');
      const rejected = await client.callTool({
        name: 'project_check_run',
        arguments: { args: { id: 'arbitrary-command' } },
      });
      expect(rejected.isError).toBe(true);
      await session.dispose();
      await expect(session.execute('project_read', { path: 'AGENTS.md' })).rejects.toThrow(
        'detenido',
      );
    },
  );
  it('reads successive blocks without truncating the rest of the file', async () => {
    const { project } = await fixture();
    await writeFile(join(project, 'large.txt'), 'x'.repeat(70000) + 'END');
    const first = await projectFileTool(project, 'project_read', {
      path: 'large.txt',
      bytes: 65536,
    });
    const second = await projectFileTool(project, 'project_read', {
      path: 'large.txt',
      offset: 65536,
    });
    expect(first).toMatchObject({ nextOffset: 65536, eof: false });
    expect(second).toMatchObject({ text: 'x'.repeat(4464) + 'END', eof: true });
  });
  it('rejects traversal, credentials, private history, alternate streams and links', async () => {
    const { root, project } = await fixture();
    await writeFile(join(project, '.env'), 'private');
    await mkdir(join(root, 'outside'));
    await symlink(join(root, 'outside'), join(project, 'link'), 'junction');
    for (const path of [
      '../outside',
      root,
      '.env',
      '.git/config',
      '.local-office/history.json',
      'AGENTS.md:stream',
      'link/elsewhere',
    ]) {
      await expect(projectFileTool(project, 'project_read', { path })).rejects.toThrow();
    }
    expect(JSON.stringify(await projectFileTool(project, 'project_list', {}))).not.toContain(
      '.env',
    );
  });
  it('explains when a project has no registered checks', async () => {
    const { root, project } = await fixture();
    const session = new OfficeToolRuntime({ stateDir: root }).createSession({
      taskId: 'no-checks',
      role: 'tester',
      project,
    });
    cleanups.push(() => session.dispose());
    expect(JSON.stringify(await session.execute('project_checks'))).toContain(
      'No hay comprobaciones registradas',
    );
    await expect(session.execute('project_check_run', { id: 'test' })).rejects.toThrow(
      'no están configuradas',
    );
  });
});
