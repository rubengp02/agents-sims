import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { OfficialIntegrations } from '../src/tools/officialIntegrations.js';
import { OperationReviewRegistry, readReviewedReceipt } from '../src/tools/operationReviews.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'office-operation-reviews-'));
  roots.push(root);
  const directory = join(root, 'integration-operations', 'fixture'),
    id = randomUUID(),
    file = id + '.json';
  await mkdir(directory, { recursive: true });
  const record = {
    id,
    status: 'review_required',
    tool: 'fixture.read',
    argumentsHash: 'PRIVATE_HASH',
    updatedAt: Date.now(),
    privateResult: 'PRIVATE_RESULT',
  };
  await writeFile(join(directory, file), JSON.stringify(record));
  return { root, directory, id, file, record, registry: new OperationReviewRegistry(root) };
}
describe('human operation reviews (local files, no provider calls)', () => {
  it('identifies uncertain packages and exposes only known safe diagnostics', async () => {
    const h = await fixture(),
      directory = join(h.root, 'plugin-operations'),
      id = randomUUID();
    await mkdir(directory);
    const file = join(directory, id + '.json');
    const record = {
      id,
      operation: 'install',
      status: 'review_required',
      preview: {
        plugin: {
          name: 'Example',
          version: '2.1',
          marketplace: 'official-fixture',
          source: 'PRIVATE_SOURCE_PATH',
        },
      },
      failureCode: 'app_server_disconnected',
      failureStage: 'request',
      error: 'PRIVATE_PROVIDER_PAYLOAD',
    };
    await writeFile(file, JSON.stringify(record));
    const receipt = (await h.registry.list()).find((entry) => entry.receiptId === id)!;
    expect(receipt).toMatchObject({
      description: 'Example · versión 2.1 · origen official-fixture',
      diagnostic: 'Se perdió la conexión con Codex antes de confirmar el resultado.',
      failureStage: 'request',
      status: 'pending',
    });
    expect(JSON.stringify(receipt)).not.toContain('PRIVATE_');
    await writeFile(
      file,
      JSON.stringify({
        ...record,
        failureCode: 'PRIVATE_UNKNOWN_CODE',
        failureStage: 'PRIVATE_PHASE',
      }),
    );
    const unknown = (await h.registry.list()).find((entry) => entry.receiptId === id)!;
    expect(unknown.diagnostic).toBeUndefined();
    expect(unknown.failureStage).toBeUndefined();
    expect(JSON.stringify(unknown)).not.toContain('PRIVATE_');
    expect(unknown.status).toBe('pending');
  });
  it('includes uncertain official registrations without exposing private configuration paths', async () => {
    const h = await fixture(),
      directory = join(h.root, 'mcp-registrations'),
      id = randomUUID();
    await mkdir(directory);
    await writeFile(
      join(directory, id + '.json'),
      JSON.stringify({
        id,
        status: 'dispatching',
        service: 'Mi servicio',
        target: { url: 'https://example.com/mcp' },
        expected: { file: 'PRIVATE_CONFIG_PATH' },
        updatedAt: Date.now(),
      }),
    );
    const receipt = (await h.registry.list()).find((item) => item.receiptId === id)!;
    expect(receipt).toMatchObject({
      kind: 'mcp_registration',
      action: 'Registrar conexión en Codex',
      destination: 'Mi servicio',
      status: 'pending',
    });
    expect(JSON.stringify(receipt)).not.toContain('PRIVATE_CONFIG_PATH');
    await h.registry.acknowledge(receipt.id, 'completed');
    expect((await h.registry.list()).find((item) => item.receiptId === id)?.status).toBe(
      'reviewed',
    );
  });
  it('keeps original bytes and unknown status, saves human outcome separately, and restores it after restart', async () => {
    const h = await fixture(),
      before = await readFile(join(h.directory, h.file), 'utf8');
    const operations = await h.registry.list();
    expect(operations).toMatchObject([
      { receiptId: h.id, action: 'fixture.read', status: 'pending' },
    ]);
    expect(JSON.stringify(operations)).not.toContain('PRIVATE_RESULT');
    await h.registry.acknowledge(operations[0].id, 'not_completed');
    expect(await readFile(join(h.directory, h.file), 'utf8')).toBe(before);
    expect((await new OperationReviewRegistry(h.root).list())[0]).toMatchObject({
      status: 'reviewed',
      originalStatus: 'review_required',
      review: { outcome: 'not_completed' },
    });
    const receipt = await readReviewedReceipt(h.directory, h.file);
    expect(receipt.record.status).toBe('review_required');
    expect(receipt.review?.outcome).toBe('not_completed');
    await expect(h.registry.acknowledge(operations[0].id, 'completed')).rejects.toMatchObject({
      code: 'operation_receipt_changed',
    });
  });
  it('invalidates an old review and old public ID when the original receipt changes', async () => {
    const h = await fixture(),
      [before] = await h.registry.list();
    await h.registry.acknowledge(before.id, 'completed');
    await writeFile(
      join(h.directory, h.file),
      JSON.stringify({ ...h.record, updatedAt: Date.now() + 1 }),
    );
    expect((await h.registry.list())[0]).toMatchObject({ status: 'pending' });
    expect((await readReviewedReceipt(h.directory, h.file)).review).toBeUndefined();
    await expect(h.registry.acknowledge(before.id, 'not_completed')).rejects.toMatchObject({
      code: 'operation_receipt_changed',
    });
    const [changed] = await h.registry.list();
    await h.registry.acknowledge(changed.id, 'not_completed');
    expect(await readdir(join(h.directory, '.reviews'))).toHaveLength(2);
  });
  it('never accepts a review claimed by an operation or a path supplied as an ID', async () => {
    const h = await fixture();
    await writeFile(
      join(h.directory, h.file),
      JSON.stringify({
        ...h.record,
        review: { outcome: 'completed', reviewedAt: new Date().toISOString() },
      }),
    );
    expect((await h.registry.list())[0].status).toBe('pending');
    expect((await readReviewedReceipt(h.directory, h.file)).record.review).toBeUndefined();
    await expect(h.registry.acknowledge('../anything', 'completed')).rejects.toMatchObject({
      code: 'operation_receipt_changed',
    });
  });
  it('indexes fixed receipt types without enumerating arbitrary nested folders and refuses concurrent decisions', async () => {
    const h = await fixture();
    for (const path of [
      'plugin-operations',
      'plugin-operations/mcp-operations',
      'authentication-history/disconnect',
    ]) {
      const directory = join(h.root, path),
        id = randomUUID();
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, id + '.json'),
        JSON.stringify({
          ...h.record,
          id,
          service: 'fixture',
          plugin: 'fixture',
          operation: 'install',
          preview: { plugin: { name: 'fixture' } },
        }),
      );
    }
    const records = await h.registry.list();
    expect(records).toHaveLength(4);
    expect(new Set(records.map((r) => r.kind))).toEqual(
      new Set(['integration', 'plugin', 'plugin_mcp', 'authentication']),
    );
    const results = await Promise.allSettled([
      h.registry.acknowledge(records[0].id, 'completed'),
      new OperationReviewRegistry(h.root).acknowledge(records[0].id, 'not_completed'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('unblocks only future explicit calls after review, without dispatching or erasing an uncertain operation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'office-operation-integration-'));
    roots.push(root);
    const directory = join(root, 'integration-operations', 'fixture');
    const call = vi.fn(async () => ({ content: [{ type: 'text', text: 'OK' }] }));
    const manager = new OfficialIntegrations(directory, async () => ({
      list: async () => ({
        data: [
          {
            name: 'codex_apps',
            authStatus: 'bearerToken',
            tools: { 'fixture.read': { inputSchema: { type: 'object' } } },
          },
        ],
      }),
      call,
      close: async () => {},
    }));
    const signal = new AbortController().signal,
      tool = (await manager.list(signal)).tools[0],
      prepared = await manager.prepare(tool.id, signal);
    call.mockRejectedValueOnce(new Error('lost response'));
    await expect(manager.call(prepared, {}, signal)).rejects.toThrow('incierto');
    await expect(manager.call(prepared, {}, signal)).rejects.toThrow('operación anterior');
    const registry = new OperationReviewRegistry(root),
      [receipt] = await registry.list();
    await registry.acknowledge(receipt.id, 'completed');
    expect(call).toHaveBeenCalledTimes(1);
    expect((await manager.operations())[0]).toMatchObject({
      status: 'review_required',
      review: { outcome: 'completed' },
    });
    await manager.call(prepared, {}, signal);
    expect(call).toHaveBeenCalledTimes(2);
  });
});
