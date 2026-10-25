import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { type IntegrationClient, OfficialIntegrations } from '../src/tools/officialIntegrations.js';
import { OfficeToolRuntime } from '../src/tools/toolRuntime.js';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'office-integrations-'));
  roots.push(root);
  let version = 'v1';
  const call = vi.fn<IntegrationClient['call']>(async () => ({
    content: [{ type: 'text', text: 'fixture-user' }],
  }));
  const list = vi.fn(async () => ({
    data: [
      {
        name: 'codex_apps',
        authStatus: 'bearerToken',
        tools: {
          'github.get_user_login': {
            description: version,
            inputSchema: { type: 'object', properties: {} },
          },
        },
      },
      { name: 'untrusted', tools: { execute: {} } },
    ],
  }));
  const close = vi.fn(async () => {});
  const manager = new OfficialIntegrations(root, async () => ({ list, call, close }));
  const runtime = new OfficeToolRuntime({ stateDir: root });
  const session = runtime.createSession({
    taskId: 'tester',
    role: 'tester',
    project: root,
    integrations: manager,
  });
  const tool = (await manager.list(new AbortController().signal, 'github')).tools[0];
  return {
    root,
    manager,
    runtime,
    session,
    tool,
    call,
    list,
    close,
    change: () => {
      version = 'v2';
    },
  };
}
describe('official integrations adapter (RPC fixtures)', () => {
  it('blocks equivalent reordered arguments and requires review of legacy uncertain receipts', async () => {
    const h = await fixture(),
      signal = new AbortController().signal,
      tool = await h.manager.prepare(h.tool.id, signal);
    h.call.mockRejectedValueOnce(new Error('lost response'));
    await expect(h.manager.call(tool, { a: 1, b: 2 }, signal)).rejects.toThrow('incierto');
    await expect(h.manager.call(tool, { b: 2, a: 1 }, signal)).rejects.toThrow(
      'operación anterior',
    );
    expect(h.call).toHaveBeenCalledTimes(1);
    const file = join(
        h.root,
        (await readdir(h.root)).find((name) => name.endsWith('.json'))!,
      ),
      receipt = JSON.parse(await readFile(file, 'utf8'));
    delete receipt.argumentsHashVersion;
    await writeFile(file, JSON.stringify(receipt));
    await expect(h.manager.call(tool, { different: 'request' }, signal)).rejects.toThrow(
      'operación anterior',
    );
    expect(h.call).toHaveBeenCalledTimes(1);
    await h.session.dispose();
  });
  it('offers only official tools with schemas and paginates search', async () => {
    const h = await fixture(),
      signal = new AbortController().signal;
    expect(await h.manager.list(signal, 'github', 0, 1)).toMatchObject({
      total: 1,
      nextOffset: null,
    });
    expect(h.tool.inputSchema).toMatchObject({ type: 'object' });
    expect((await h.manager.list(signal, 'execute')).tools).toHaveLength(0);
    await expect(h.manager.prepare('forged-id', signal)).rejects.toThrow('no aparece');
    await h.session.dispose();
  });
  it('waits for exact approval and preserves arguments across the wait', async () => {
    const h = await fixture(),
      args = { toolId: h.tool.id, arguments: { query: 'original' } };
    const pending = h.session.execute('integration_call', args);
    await vi.waitFor(() => expect(h.runtime.approvals.list()).toHaveLength(1));
    expect(h.call).not.toHaveBeenCalled();
    args.arguments.query = 'changed';
    const approval = h.runtime.approvals.list()[0];
    h.runtime.approvals.resolve(approval.id, true);
    expect(JSON.stringify(await pending)).toContain('fixture-user');
    expect(h.call).toHaveBeenCalledWith('github.get_user_login', { query: 'original' });
    expect(h.runtime.approvals.resolve(approval.id, true)).toBe(false);
    await h.session.dispose();
  });
  it('rejects changed tool definitions after approval', async () => {
    const h = await fixture();
    const pending = h.session.execute('integration_call', { toolId: h.tool.id, arguments: {} });
    const rejected = expect(pending).rejects.toThrow('cambió');
    await vi.waitFor(() => expect(h.runtime.approvals.list()).toHaveLength(1));
    h.change();
    h.runtime.approvals.resolve(h.runtime.approvals.list()[0].id, true);
    await rejected;
    expect(h.call).not.toHaveBeenCalled();
    await h.session.dispose();
  });
  it('preserves uncertain operations without retrying or saving response contents', async () => {
    const h = await fixture(),
      signal = new AbortController().signal;
    h.call.mockRejectedValueOnce(new Error('lost response PRIVATE_REMOTE_TEXT'));
    const tool = await h.manager.prepare(h.tool.id, signal);
    await expect(h.manager.call(tool, { privateQuery: 'PRIVATE_QUERY' }, signal)).rejects.toThrow(
      'incierto',
    );
    expect(h.call).toHaveBeenCalledTimes(1);
    const receipt = JSON.parse(await readFile(join(h.root, (await readdir(h.root))[0]), 'utf8'));
    expect(receipt.status).toBe('review_required');
    expect(JSON.stringify(receipt)).not.toContain('PRIVATE');
    await expect(h.manager.call(tool, { privateQuery: 'PRIVATE_QUERY' }, signal)).rejects.toThrow(
      'operación anterior',
    );
    expect(h.call).toHaveBeenCalledTimes(1);
    await h.session.dispose();
  });
  it('returns remote tool errors without declaring successful verification', async () => {
    const h = await fixture(),
      signal = new AbortController().signal;
    h.call.mockResolvedValueOnce({
      isError: true,
      content: [{ type: 'text', text: 'Not authorized' }],
    });
    const response = await h.manager.call(await h.manager.prepare(h.tool.id, signal), {}, signal);
    expect(response).toMatchObject({ status: 'failed', isError: true });
    await h.session.dispose();
  });
  it('cancels approval when the employee is stopped', async () => {
    const h = await fixture(),
      pending = h.session.execute('integration_call', { toolId: h.tool.id, arguments: {} });
    const rejected = expect(pending).rejects.toThrow('detenido');
    await vi.waitFor(() => expect(h.runtime.approvals.list()).toHaveLength(1));
    await h.session.dispose();
    await rejected;
    expect(h.call).not.toHaveBeenCalled();
  });
});
