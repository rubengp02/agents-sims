import { describe, expect, it } from 'vitest';

import { ToolApprovalStore } from '../src/tools/toolApprovals.js';

describe('tool approvals', () => {
  it('approves exactly one immutable operation and rejects replay', async () => {
    const store = new ToolApprovalStore();
    const result = store.request({
      taskId: 'task',
      tool: 'click',
      destination: 'https://example.com',
      content: 'Enviar',
      args: { selector: '#send' },
    });
    const [approval] = store.list();
    expect(store.resolve(approval.id, true)).toBe(true);
    expect(await result).toBe(true);
    expect(store.resolve(approval.id, true)).toBe(false);
    expect(new ToolApprovalStore().resolve(approval.id, true)).toBe(false);
  });
  it('cancels pending operations without granting permission', async () => {
    const store = new ToolApprovalStore();
    const controller = new AbortController();
    const result = store.request({
      taskId: 'task',
      tool: 'fill',
      destination: 'remote',
      content: 'x',
      args: {},
      signal: controller.signal,
    });
    controller.abort();
    expect(await result).toBe(false);
    expect(store.list()).toEqual([]);
  });
});
