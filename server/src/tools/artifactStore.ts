import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import sharp from 'sharp';

import {
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_MESSAGE,
  type OfficeArtifact,
  validateArtifactReference,
} from '../../../core/src/artifacts.js';

const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' } as const;
type ArtifactInput = Omit<OfficeArtifact, 'id' | 'mime' | 'size' | 'createdAt'> & { bytes: Buffer };
export class InvalidOfficeImage extends Error {}

/** Private image storage. Public records deliberately never contain filesystem paths. */
export class ArtifactStore {
  private records = new Map<string, OfficeArtifact>();
  private root = '';
  private ready = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly directory: string) {}

  async initialize(): Promise<void> {
    if (this.ready) return;
    await mkdir(this.directory, { recursive: true });
    if ((await lstat(this.directory)).isSymbolicLink())
      throw new Error('El almacén no puede ser un enlace.');
    this.root = await realpath(this.directory);
    let text: string;
    try {
      if ((await lstat(join(this.root, 'manifest.json'))).isSymbolicLink())
        throw new Error('Índice de imágenes no seguro.');
      text = await readFile(join(this.root, 'manifest.json'), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // A backup means this is damaged existing storage, not a new empty store.
      try {
        await lstat(join(this.root, 'manifest.backup.json'));
      } catch (backupError) {
        if ((backupError as NodeJS.ErrnoException).code === 'ENOENT') {
          this.ready = true;
          return;
        }
        throw backupError;
      }
      throw new Error('Falta el índice de imágenes. Conserva el respaldo y revisa el almacén.');
    }
    const manifest: unknown = JSON.parse(text);
    if (!Array.isArray(manifest)) throw new Error('Índice de imágenes inválido.');
    const records = new Map<string, OfficeArtifact>();
    for (const value of manifest) {
      const a = value as OfficeArtifact;
      if (!validateArtifactReference(a) || records.has(a.id))
        throw new Error('Índice de imágenes inválido.');
      records.set(a.id, { ...a });
    }
    this.records = records;
    this.ready = true;
  }

  private assertReady(): void {
    if (!this.ready) throw new Error('El almacén de imágenes no está inicializado.');
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(operation);
    this.queue = pending.catch(() => undefined);
    return pending;
  }
  private async persist(next: Map<string, OfficeArtifact>): Promise<void> {
    await this.checkRoot();
    const target = join(this.root, 'manifest.json');
    const temp = join(this.root, `manifest-${randomUUID()}.tmp`);
    await writeFile(temp, JSON.stringify([...next.values()]), { flag: 'wx', mode: 0o600 });
    try {
      if ((await lstat(target)).isSymbolicLink()) throw new Error('Índice de imágenes no seguro.');
      try {
        if ((await lstat(join(this.root, 'manifest.backup.json'))).isSymbolicLink())
          throw new Error('Respaldo de imágenes no seguro.');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await copyFile(target, join(this.root, 'manifest.backup.json'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await rename(temp, target);
    this.records = next;
  }

  async put(input: ArtifactInput): Promise<OfficeArtifact> {
    this.assertReady();
    if (
      !Buffer.isBuffer(input.bytes) ||
      input.bytes.length < 1 ||
      input.bytes.length > MAX_IMAGE_BYTES
    )
      throw new InvalidOfficeImage('Cada imagen debe ocupar como máximo 20 MB.');
    if (typeof input.name !== 'string')
      throw new InvalidOfficeImage('El archivo necesita un nombre.');
    if (!['attachment', 'screenshot', 'generated'].includes(input.kind))
      throw new Error('Tipo de imagen inválido.');
    const decoder = sharp(input.bytes, {
      failOn: 'warning',
      limitInputPixels: 40_000_000,
      animated: false,
    });
    const metadata = await decoder.metadata().catch(() => {
      throw new InvalidOfficeImage(
        'No se puede leer esta imagen. Adjunta un PNG, JPEG o WebP válido.',
      );
    });
    if (!metadata.format || !(metadata.format in MIME) || (metadata.pages ?? 1) > 1)
      throw new InvalidOfficeImage('Solo se admiten imágenes PNG, JPEG y WebP estáticas.');
    // Decode all pixels, rather than trusting a header or a declared MIME type.
    await decoder.stats().catch(() => {
      throw new InvalidOfficeImage('La imagen está dañada o supera las dimensiones permitidas.');
    });
    const artifact: OfficeArtifact = {
      id: randomUUID(),
      name:
        basename(input.name.replaceAll('\\', '/'))
          .replace(/[\u0000-\u001f]/g, '')
          .slice(0, 180) || 'imagen',
      mime: MIME[metadata.format as keyof typeof MIME],
      size: input.bytes.length,
      createdAt: new Date().toISOString(),
      kind: input.kind,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.taskId ? { taskId: input.taskId } : {}),
    };
    return this.serialize(async () => {
      await this.checkRoot();
      await writeFile(join(this.root, artifact.id), input.bytes, { flag: 'wx', mode: 0o600 });
      const next = new Map(this.records);
      next.set(artifact.id, artifact);
      await this.persist(next);
      return { ...artifact };
    });
  }
  get(id: string): OfficeArtifact {
    this.assertReady();
    const artifact = ID.test(id) ? this.records.get(id) : undefined;
    if (!artifact) throw new Error('Imagen no encontrada.');
    return { ...artifact };
  }
  private async checkRoot(): Promise<void> {
    if (
      (await lstat(this.directory)).isSymbolicLink() ||
      (await realpath(this.directory)) !== this.root
    )
      throw new Error('El almacén de imágenes ha cambiado.');
  }
  async path(id: string): Promise<string> {
    this.get(id);
    await this.checkRoot();
    const candidate = join(this.root, id);
    if (
      (await lstat(candidate)).isSymbolicLink() ||
      dirname(await realpath(candidate)) !== resolve(this.root)
    )
      throw new Error('Ruta de imagen no segura.');
    return candidate;
  }
  async read(id: string): Promise<{ artifact: OfficeArtifact; bytes: Buffer }> {
    const artifact = this.get(id),
      file = await this.path(id);
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size !== artifact.size)
        throw new Error('La imagen almacenada ha cambiado.');
      const bytes = await handle.readFile();
      if (bytes.length !== artifact.size) throw new Error('La imagen almacenada ha cambiado.');
      return { artifact, bytes };
    } finally {
      await handle.close();
    }
  }
  list(filter: { conversationId?: string; taskId?: string } = {}): OfficeArtifact[] {
    this.assertReady();
    return [...this.records.values()]
      .filter(
        (a) =>
          (filter.conversationId === undefined || a.conversationId === filter.conversationId) &&
          (filter.taskId === undefined || a.taskId === filter.taskId),
      )
      .map((a) => ({ ...a }));
  }
  async bind(ids: string[], conversationId: string, taskId?: string): Promise<OfficeArtifact[]> {
    this.assertReady();
    if (!conversationId || ids.length > MAX_IMAGES_PER_MESSAGE || new Set(ids).size !== ids.length)
      throw new Error('Adjuntos inválidos: máximo diez imágenes por mensaje.');
    return this.serialize(async () => {
      const artifacts = ids.map((id) => this.get(id));
      if (artifacts.some((a) => a.conversationId && a.conversationId !== conversationId))
        throw new Error('La imagen pertenece a otra conversación.');
      const next = new Map(this.records);
      for (const a of artifacts)
        next.set(a.id, { ...a, conversationId, ...(taskId && !a.taskId ? { taskId } : {}) });
      await this.persist(next);
      return ids.map((id) => this.get(id));
    });
  }
}
