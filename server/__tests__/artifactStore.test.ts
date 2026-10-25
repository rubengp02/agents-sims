import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';

import { MAX_IMAGE_BYTES, validateArtifactReference } from '../../core/src/artifacts.js';
import { ArtifactStore } from '../src/tools/artifactStore.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'office-artifacts-'));
  roots.push(directory);
  const store = new ArtifactStore(directory);
  await store.initialize();
  const bytes = await sharp({ create: { width: 3, height: 2, channels: 3, background: 'red' } })
    .png()
    .toBuffer();
  return { directory, store, bytes };
}
describe('private image artifacts (real filesystem, no inference)', () => {
  it('decodes an image, removes path components and reloads metadata and original bytes', async () => {
    const { directory, store, bytes } = await fixture();
    const artifact = await store.put({ name: '../../capture.png', bytes, kind: 'attachment' });
    expect(artifact.name).toBe('capture.png');
    expect(artifact.mime).toBe('image/png');
    expect(validateArtifactReference(artifact)).toBe(true);
    expect(validateArtifactReference({ ...artifact, path: directory })).toBe(false);
    const reopened = new ArtifactStore(directory);
    await reopened.initialize();
    expect((await reopened.read(artifact.id)).bytes).toEqual(bytes);
    expect(await reopened.path(artifact.id)).toBe(join(directory, artifact.id));
  });
  it('rejects fake images, truncated data, and images above the byte limit', async () => {
    const { store, bytes } = await fixture();
    await expect(
      store.put({
        name: 'fake.png',
        bytes: Buffer.from('<html>not an image</html>'),
        kind: 'attachment',
      }),
    ).rejects.toThrow();
    await expect(
      store.put({ name: 'partial.png', bytes: bytes.subarray(0, 40), kind: 'attachment' }),
    ).rejects.toThrow();
    await expect(
      store.put({ name: 'big.png', bytes: Buffer.alloc(MAX_IMAGE_BYTES + 1), kind: 'attachment' }),
    ).rejects.toThrow('20 MB');
    expect(store.list()).toEqual([]);
  });
  it('binds atomically, keeps original task provenance and forbids stealing another conversation', async () => {
    const { store, bytes } = await fixture();
    const a = await store.put({ name: 'a.png', bytes, kind: 'attachment' });
    const b = await store.put({
      name: 'b.png',
      bytes,
      kind: 'screenshot',
      conversationId: 'other',
    });
    await expect(store.bind([a.id, b.id], 'conversation', 'task')).rejects.toThrow(
      'otra conversación',
    );
    expect(store.get(a.id).conversationId).toBeUndefined();
    expect((await store.bind([a.id], 'conversation', 'first-task'))[0].taskId).toBe('first-task');
    expect((await store.bind([a.id], 'conversation', 'child-task'))[0].taskId).toBe('first-task');
    expect(store.list({ conversationId: 'conversation' })).toHaveLength(1);
    await expect(store.bind(Array(11).fill(a.id), 'conversation')).rejects.toThrow('diez');
    await expect(store.path('../manifest.json')).rejects.toThrow('no encontrada');
  });
  it('serializes simultaneous writes and fails closed on a damaged manifest', async () => {
    const { directory, store, bytes } = await fixture();
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        store.put({ name: `${i}.png`, bytes, kind: 'generated' }),
      ),
    );
    const reopened = new ArtifactStore(directory);
    await reopened.initialize();
    expect(reopened.list()).toHaveLength(6);
    expect(
      JSON.parse(await readFile(join(directory, 'manifest.backup.json'), 'utf8')),
    ).toHaveLength(5);
    await writeFile(join(directory, 'manifest.json'), '{invalid');
    await expect(new ArtifactStore(directory).initialize()).rejects.toThrow();
  });
  it('detects an image changed on disk', async () => {
    const { directory, store, bytes } = await fixture();
    const artifact = await store.put({ name: 'safe.png', bytes, kind: 'screenshot' });
    await writeFile(join(directory, artifact.id), 'modified');
    await expect(store.read(artifact.id)).rejects.toThrow('ha cambiado');
  });
});
