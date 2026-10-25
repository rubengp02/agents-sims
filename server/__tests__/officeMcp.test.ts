import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, expect, it } from 'vitest';

import { startOfficeMcp } from '../src/tools/officeMcp.js';
import { OfficeToolRuntime } from '../src/tools/toolRuntime.js';

describe('office MCP transport', () => {
  it('rejects cross-origin requests and unauthenticated callers', async () => {
    const runtime = new OfficeToolRuntime({ stateDir: '.' });
    const session = runtime.createSession({ taskId: 'fixture', role: 'tester', project: '.' });
    const service = await startOfficeMcp(session);
    try {
      expect((await fetch(service.url)).status).toBe(403);
      expect(
        (
          await fetch(service.url, {
            headers: { authorization: `Bearer ${service.secret}`, origin: 'http://evil.test' },
          })
        ).status,
      ).toBe(403);
      const client = new Client({ name: 'fixture', version: '1' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(service.url), {
          requestInit: { headers: { authorization: `Bearer ${service.secret}` } },
        }),
      );
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain('browser_screenshot');
      expect(tools.tools.map((tool) => tool.name)).toContain('desktop_inspect');
      expect((await client.listTools()).tools.length).toBe(tools.tools.length);
      await client.close();
    } finally {
      await service.close();
    }
  });
  it('never labels an unconnected browser as available', () => {
    expect(
      new OfficeToolRuntime({ stateDir: '.' }).capabilities().find((c) => c.id === 'browser')
        ?.state,
    ).toBe('unverified');
  });
});
