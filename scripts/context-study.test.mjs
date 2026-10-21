import assert from 'node:assert/strict';
import test from 'node:test';

import { summarizeContext } from './context-study.mjs';

test('audit persists counts, not private instruction text or tool content', () => {
  const report = summarizeContext([
    { type: 'session_meta', payload: { base_instructions: { text: 'private base' } } },
    {
      type: 'response_item',
      payload: { role: 'user', content: [{ text: 'AjudesClares private rules' }] },
    },
    {
      type: 'response_item',
      payload: { type: 'custom_tool_call', call_id: 'a', input: 'private tool' },
    },
  ]);
  assert.equal(report.toolCalls, 1);
  assert.ok(report.instructions.some((item) => item.kind === 'other_project_instructions'));
  assert.equal(JSON.stringify(report).includes('private'), false);
  assert.equal(report.usage, null);
});
test('uses final cumulative usage without counting duplicate snapshots twice', () => {
  const usage = (input, cached, output) => ({
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: input,
          cached_input_tokens: cached,
          output_tokens: output,
        },
      },
    },
  });
  const report = summarizeContext([usage(10, 0, 2), usage(10, 0, 2), usage(24, 10, 5)]);
  assert.deepEqual(report.usage, {
    inputTokens: 24,
    cachedInputTokens: 10,
    nonCachedInputTokens: 14,
    outputTokens: 5,
  });
  assert.equal(report.distinctUsageSnapshots, 2);
});
test('does not count later conversation instructions as initial context', () => {
  const report = summarizeContext([
    { type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'a' } },
    {
      type: 'response_item',
      payload: { role: 'developer', content: [{ text: 'later instructions' }] },
    },
  ]);
  assert.deepEqual(report.instructions, []);
});
test('invalid cached counters cannot produce fictional savings', () => {
  assert.throws(() =>
    summarizeContext([
      {
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: { input_tokens: 10, cached_input_tokens: 11, output_tokens: 2 },
          },
        },
      },
    ]),
  );
});
