import { describe, expect, it } from 'vitest';

import type { OfficeToolApprovalField } from '../../core/src/officeTools.js';
import { approvalResponse } from '../src/tools/appServerApprovals.js';
import { ToolApprovalStore } from '../src/tools/toolApprovals.js';

const input = {
  taskId: 'task',
  tool: 'External action',
  destination: 'Simulated service',
  content: 'Exact requested operation',
  args: { destination: 'exact' },
};
const fields: OfficeToolApprovalField[] = [
  { name: 'name', label: 'Nombre', type: 'string', required: true },
  { name: 'count', label: 'Cantidad', type: 'number', required: false },
  { name: 'include', label: 'Incluir', type: 'boolean', required: true },
  { name: 'folder', label: 'Carpeta', type: 'string', required: true, options: ['A', 'B'] },
];
describe('single-operation office approvals and native simple elicitation forms', () => {
  it('never expands a one-operation approval into a persistent native grant', () => {
    expect(approvalResponse('item/permissions/requestApproval', {}, true)).toEqual({
      permissions: {},
      scope: 'turn',
    });
    const questions = [
      {
        id: 'broad',
        question: 'Allow all operations in the entire session?',
        options: [{ label: 'Yes' }],
      },
      { id: 'prefix', question: 'Publish?', options: [{ label: 'Allow always' }] },
      { id: 'once', question: 'Publish this reviewed change?', options: [{ label: 'Allow once' }] },
    ];
    expect(approvalResponse('item/tool/requestUserInput', { questions }, true)).toEqual({
      answers: { once: { answers: ['Allow once'] } },
    });
    expect(approvalResponse('item/commandExecution/requestApproval', {}, false)).toEqual({
      decision: 'decline',
    });
  });
  it('does not approve automatically and never permits replay or another request', async () => {
    const store = new ToolApprovalStore();
    let settled = false;
    const first = store.request(input).then((approved) => {
      settled = true;
      return approved;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    const id = store.list()[0].id;
    expect(store.resolve('unknown', true)).toBe(false);
    expect(settled).toBe(false);
    expect(store.resolve(id, true)).toBe(true);
    expect(await first).toBe(true);
    expect(store.resolve(id, true)).toBe(false);
    const second = store.request({ ...input, content: 'Changed action' });
    expect(store.list()[0].id).not.toBe(id);
    expect(store.resolve(id, true)).toBe(false);
    store.close();
    expect(await second).toBe(false);
  });
  it('accepts only exact primitive fields and keeps a request pending after invalid values', async () => {
    const store = new ToolApprovalStore(),
      pending = store.requestFields({ ...input, fields });
    const id = store.list()[0].id;
    for (const values of [
      undefined,
      null,
      [],
      {},
      { name: 'x', include: true, folder: 'C' },
      { name: 'x', include: 'true', folder: 'A' },
      { name: 'x', include: true, folder: 'A', count: Infinity },
      { name: 'x', include: true, folder: 'A', extra: 'not registered' },
      { name: ' '.repeat(10), include: false, folder: 'B' },
      { name: 'x'.repeat(4001), include: false, folder: 'B' },
    ]) {
      expect(() => store.resolve(id, true, values)).toThrow();
      expect(store.list()).toHaveLength(1);
    }
    expect(
      store.resolve(id, true, { name: 'Proyecto', include: false, folder: 'B', count: 0 }),
    ).toBe(true);
    expect(await pending).toEqual({
      approved: true,
      values: { name: 'Proyecto', include: false, folder: 'B', count: 0 },
    });
    expect(store.resolve(id, true, { name: 'other', include: true, folder: 'A' })).toBe(false);
  });
  it('defensively copies the schema and public snapshots so the approved operation cannot change', async () => {
    const store = new ToolApprovalStore();
    const schema: OfficeToolApprovalField[] = [
      { name: 'folder', label: 'Carpeta', type: 'string', required: true, options: ['A'] },
    ];
    const pending = store.requestFields({ ...input, fields: schema });
    schema[0].options!.push('UNREVIEWED');
    const displayed = store.list()[0];
    displayed.fields![0].options!.push('OTHER');
    expect(store.list()[0].fields![0].options).toEqual(['A']);
    expect(() => store.resolve(displayed.id, true, { folder: 'UNREVIEWED' })).toThrow();
    store.resolve(displayed.id, false);
    expect(await pending).toEqual({ approved: false });
  });
  it('rejects secret or unsupported schemas without presenting a credential form', async () => {
    const store = new ToolApprovalStore();
    for (const name of ['password', 'api_key', 'secret', 'access_token', '__proto__']) {
      await expect(
        store.requestFields({
          ...input,
          fields: [{ name, label: name, type: 'string', required: true }],
        }),
      ).rejects.toThrow();
    }
    await expect(
      store.requestFields({
        ...input,
        fields: [
          { name: 'login', label: 'Contraseña del servicio', type: 'string', required: true },
        ],
      }),
    ).rejects.toThrow();
    await expect(
      store.requestFields({
        ...input,
        fields: [
          { name: 'x', label: 'Campo', type: 'string', required: true },
          { name: 'x', label: 'Duplicado', type: 'string', required: false },
        ],
      }),
    ).rejects.toThrow();
    await expect(store.requestFields({ ...input, fields: [] })).rejects.toThrow();
    expect(store.list()).toEqual([]);
  });
  it('denies pending operations on cancellation, task stop, or server close', async () => {
    const store = new ToolApprovalStore(),
      controller = new AbortController();
    const pending = store.requestFields({ ...input, fields, signal: controller.signal });
    const id = store.list()[0].id;
    controller.abort();
    expect(await pending).toEqual({ approved: false });
    expect(store.resolve(id, true)).toBe(false);
    const second = store.requestFields({ ...input, fields });
    store.cancelTask(input.taskId);
    expect(await second).toEqual({ approved: false });
    const third = store.request(input);
    store.close();
    expect(await third).toBe(false);
    expect(await store.request({ ...input, signal: controller.signal })).toBe(false);
  });
});
