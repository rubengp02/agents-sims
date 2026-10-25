import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { ConnectionOperations } from '../src/tools/connectionOperations.js';

it('accepts only a separate version-bound human acknowledgement without rewriting the receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'office-connection-receipts-'));
  try {
    const store = new ConnectionOperations(root);
    await store.initialize();
    const receipt = await store.start('connection', 'fixture', {}, {}, {});
    await store.finish(receipt, 'review_required');
    const file = join(root, receipt.id + '.json');
    const claimed = JSON.stringify({
      ...receipt,
      review: { acknowledgedAt: 1, outcome: 'completed' },
    });
    await writeFile(file, claimed);
    expect((await store.list()).operations[0].review).toBeUndefined();
    await store.acknowledge('connection');
    expect(await readFile(file, 'utf8')).toBe(claimed);
    expect((await store.list()).operations[0].review?.outcome).toBe('not_determined');
    await writeFile(file, JSON.stringify({ ...receipt, updatedAt: receipt.updatedAt + 1 }));
    expect((await store.list()).operations[0].review).toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
