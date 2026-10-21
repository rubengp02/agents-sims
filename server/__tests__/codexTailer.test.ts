import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it, vi } from 'vitest';

import { CodexTailer } from '../src/providers/hook/codex/codexTailer.js';
import { CODEX_SESSION_STALE_MS } from '../src/providers/hook/codex/constants.js';

describe('CodexTailer structured session compatibility', () => {
  it('delivers standard and freeform tool lifecycles without exposing freeform content', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-codex-tailer-'));
    const received: Record<string, unknown>[] = [];
    const server = http.createServer((request, response) => {
      let body = '';
      request.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      request.on('end', () => {
        expect(request.url).toBe('/api/hooks/codex');
        expect(request.headers.authorization).toBe('Bearer test-token');
        received.push(JSON.parse(body));
        response.end('{}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test port');
    const tailer = new CodexTailer(`http://127.0.0.1:${address.port}`, 'test-token', root);
    try {
      const records = [
        { type: 'session_meta', payload: { id: 'local-test', cwd: root } },
        {
          type: 'response_item',
          payload: {
            type: 'function_call',
            call_id: 'a',
            name: 'read_file',
            arguments: '{"path":"test.txt"}',
          },
        },
        {
          type: 'response_item',
          payload: { type: 'function_call_output', call_id: 'a', output: 'private result' },
        },
        {
          type: 'response_item',
          payload: {
            type: 'custom_tool_call',
            call_id: 'b',
            name: 'exec',
            input: 'private script',
          },
        },
        {
          type: 'response_item',
          payload: { type: 'custom_tool_call_output', call_id: 'b', output: 'private output' },
        },
        { type: 'event_msg', payload: { type: 'task_complete' } },
      ];
      fs.writeFileSync(
        path.join(root, 'rollout-test.jsonl'),
        records.map((record) => JSON.stringify(record)).join('\n') + '\n',
      );
      tailer.start();
      await expect.poll(() => received.length, { timeout: 6000 }).toBe(6);
      expect(received.map((event) => event.hook_event_name)).toEqual([
        'SessionStart',
        'ExecStart',
        'ExecEnd',
        'ExecStart',
        'ExecEnd',
        'TurnEnd',
      ]);
      expect(received[1].tool_input).toEqual({ path: 'test.txt' });
      expect(received[3]).toMatchObject({
        tool_id: 'b',
        tool_name: 'exec',
        session_id: 'local-test',
      });
      expect(received[3]).not.toHaveProperty('tool_input');
      expect(JSON.stringify(received)).not.toContain('private');

      // Exercise the existing idle timeout without waiting ten real minutes.
      const realNow = Date.now.bind(Date);
      vi.spyOn(Date, 'now').mockImplementation(() => realNow() + CODEX_SESSION_STALE_MS + 1000);
      await expect
        .poll(() => received.at(-1)?.hook_event_name, { timeout: 6000 })
        .toBe('SessionEnd');
      fs.appendFileSync(
        path.join(root, 'rollout-test.jsonl'),
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'custom_tool_call',
            call_id: 'resumed',
            name: 'exec',
            input: 'private resumed script',
          },
        }) + '\n',
      );
      await expect.poll(() => received.length, { timeout: 6000 }).toBe(9);
      expect(received.slice(-2).map((event) => event.hook_event_name)).toEqual([
        'SessionStart',
        'ExecStart',
      ]);
      expect(received.at(-1)?.session_id).toBe('local-test');
      expect(JSON.stringify(received)).not.toContain('private');
    } finally {
      vi.restoreAllMocks();
      tailer.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
