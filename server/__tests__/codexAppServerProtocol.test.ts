import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { CodexAppServerProtocol } from '../src/execution/codexAppServerProtocol.js';
import { ExecutionBlocked } from '../src/execution/types.js';

function harness(timeout = 500) {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    exitCode: null,
    signalCode: null as NodeJS.Signals | null,
    kill: vi.fn(() => {
      child.signalCode = 'SIGTERM';
      setImmediate(() => child.emit('close', null));
      return true;
    }),
  });
  const outgoing: Array<Record<string, unknown>> = [];
  child.stdin.on('data', (chunk) => {
    for (const line of chunk.toString().trim().split('\n')) outgoing.push(JSON.parse(line));
  });
  const client = new CodexAppServerProtocol(
    child as unknown as ChildProcessWithoutNullStreams,
    timeout,
  );
  const incoming = (message: unknown) => child.stdout.write(JSON.stringify(message) + '\n');
  return { client, child, outgoing, incoming };
}

describe('owned App Server stdio transport', () => {
  it('surfaces the hidden first native retry using fixed categories and no raw stderr', async () => {
    const h = harness();
    const waits = vi.fn();
    const notifications = vi.fn();
    h.client.onProviderWait(waits);
    h.client.onNotification(notifications);
    h.child.stderr.write('WARN codex_core::responses_re');
    h.child.stderr.write(
      'try: stream disconnected - retrying sampling request (1/5 in 406.9998307s)... PRIVATE bearer token sampling_error=exceeded retry limit, last status: 429 Too Many Requests\n',
    );
    expect(waits).toHaveBeenCalledWith({ kind: 'rate-limit', retryAfterMs: 407000 });
    expect(JSON.stringify(waits.mock.calls)).not.toContain('PRIVATE');
    expect(notifications).not.toHaveBeenCalled();
    await h.client.close();
  });
  it.each([
    [-32602, 'private parameter payload', 'app_server_invalid_params'],
    [-32601, 'private method payload', 'app_server_unsupported'],
    [-32603, 'Remote installation is not supported PRIVATE', 'app_server_unsupported'],
    [-32603, 'HTTP 401 PRIVATE', 'app_server_auth_required'],
    [-32603, 'HTTP 403 PRIVATE', 'app_server_access_denied'],
    [-32603, 'HTTP 404 PRIVATE', 'app_server_not_found'],
    [-32603, 'HTTP 429 PRIVATE', 'app_server_rate_limited'],
    [-32603, 'PRIVATE unknown provider failure', 'app_server_rejected'],
    [-32603, 'PRIVATE resource 401 could not be processed', 'app_server_rejected'],
  ])(
    'categorizes a rejected operation without retaining its payload (%s, %s)',
    async (rpcCode, message, code) => {
      const h = harness();
      try {
        const pending = h.client.request('plugin/install', {});
        h.incoming({ id: 1, error: { code: rpcCode, message, data: { secret: 'PRIVATE' } } });
        const failure = await pending.catch((error) => error);
        if (!(failure instanceof ExecutionBlocked))
          throw new Error('Expected a safe protocol failure');
        expect(failure.code).toBe(code);
        expect(failure.message).not.toContain('PRIVATE');
        expect(JSON.stringify(failure)).not.toContain('PRIVATE');
        expect(h.outgoing).toHaveLength(1);
      } finally {
        await h.client.close();
      }
    },
  );
  it('allows a slow inventory read while keeping account metadata bounded without replay', async () => {
    vi.useFakeTimers();
    const h = harness(30000);
    try {
      const inventory = h.client.request('plugin/list', { forceRefetch: true });
      const metadata = h.client.request('account/read', {});
      const timedOut = expect(metadata).rejects.toMatchObject({ code: 'app_server_timeout' });
      await vi.advanceTimersByTimeAsync(31000);
      await timedOut;
      h.incoming({ id: 1, result: { marketplaces: [] } });
      await expect(inventory).resolves.toEqual({ marketplaces: [] });
      expect(h.outgoing).toHaveLength(2);
    } finally {
      vi.useRealTimers();
      await h.client.close();
    }
  });
  it.each(['plugin/install', 'plugin/uninstall', 'mcpServer/tool/call'])(
    'keeps %s pending beyond metadata timeout and cancels on owned process close',
    async (method) => {
      vi.useFakeTimers();
      const h = harness(30000);
      try {
        let settled = false;
        const pending = h.client.request(method, {});
        const rejected = expect(pending).rejects.toMatchObject({ code: 'app_server_disconnected' });
        void pending.then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          },
        );
        await vi.advanceTimersByTimeAsync(120000);
        expect(settled).toBe(false);
        expect(h.outgoing).toHaveLength(1);
        h.child.emit('close', 1);
        await rejected;
        expect(settled).toBe(true);
        expect(h.outgoing).toHaveLength(1);
      } finally {
        vi.useRealTimers();
        await h.client.close();
      }
    },
  );
  it('reports an access challenge without leaking its HTML or treating it as missing authentication', async () => {
    const h = harness();
    const pending = h.client.request('app/list');
    h.incoming({
      id: 1,
      error: {
        message:
          'Request failed with status 403 Forbidden <html>cdn-cgi challenge-platform private-body</html>',
      },
    });
    await expect(pending).rejects.toMatchObject({ code: 'app_server_access_challenge' });
    await h.client.close();
  });
  it('correlates requests and notifications without retaining provider errors', async () => {
    const h = harness();
    const notify = vi.fn();
    h.client.onNotification(notify);
    const first = h.client.request('model/list');
    const second = h.client.request('account/read', { refreshToken: false });
    h.incoming({ id: 2, result: { safe: true } });
    h.incoming({ method: 'account/updated', params: {} });
    h.incoming({ id: 1, error: { message: 'secret remote diagnostics' } });
    await expect(second).resolves.toEqual({ safe: true });
    await expect(first).rejects.toMatchObject({ code: 'app_server_rejected' });
    expect(notify).toHaveBeenCalledWith('account/updated', {});
    await h.client.close();
  });
  it('does not send approval until the human adapter has returned', async () => {
    const h = harness();
    let approve: ((value: unknown) => void) | undefined;
    h.client.onRequest(
      async () =>
        new Promise((resolve) => {
          approve = resolve;
        }),
    );
    h.incoming({
      id: 'external-one',
      method: 'mcpServer/elicitation/request',
      params: { serverName: 'github' },
    });
    await vi.waitFor(() => expect(approve).toBeTypeOf('function'));
    expect(h.outgoing).toEqual([]);
    approve!({ action: 'accept', content: {} });
    await vi.waitFor(() =>
      expect(h.outgoing).toEqual([
        { id: 'external-one', result: { action: 'accept', content: {} } },
      ]),
    );
    await h.client.close();
  });
  it('fails closed on invalid protocol data and rejects pending requests', async () => {
    const h = harness();
    const disconnect = vi.fn();
    h.client.onDisconnect(disconnect);
    const pending = h.client.request('thread/start');
    h.child.stdout.write('not-json\n');
    await expect(pending).rejects.toMatchObject({ code: 'app_server_disconnected' });
    expect(disconnect).toHaveBeenCalledOnce();
    await h.client.close();
  });
  it('bounds unanswered metadata requests without executing a retry', async () => {
    const h = harness(10);
    await expect(h.client.request('account/read')).rejects.toMatchObject({
      code: 'app_server_timeout',
    });
    expect(h.outgoing).toHaveLength(1);
    await h.client.close();
  });
  it('denies unknown server methods when no handler has been registered', async () => {
    const h = harness();
    h.incoming({ id: 9, method: 'unknown/method', params: {} });
    await vi.waitFor(() => expect(h.outgoing[0]).toMatchObject({ id: 9, error: { code: -32603 } }));
    expect(h.outgoing[0]).not.toHaveProperty('result');
    await h.client.close();
  });
});
