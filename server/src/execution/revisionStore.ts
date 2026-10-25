import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import { adaptiveStateDirectory } from './adaptiveState.js';
import { ExecutionBlocked } from './types.js';

export interface FileRevision {
  digest: string;
  files: Record<string, string>;
  format?: 'sha256-v1';
  blobDirectory?: string;
}
export function gitFileNames(root: string): string[] {
  const directory = adaptiveStateDirectory(root),
    file = join(directory, `${randomUUID()}.git-files.tmp`);
  const output = openSync(file, 'wx', 0o600);
  try {
    execFileSync(
      'git',
      ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'],
      { windowsHide: true, stdio: ['ignore', output, 'pipe'] },
    );
  } catch (error) {
    closeSync(output);
    unlinkSync(file);
    throw error;
  }
  closeSync(output);
  const input = openSync(file, 'r'),
    buffer = Buffer.allocUnsafe(64 * 1024),
    decoder = new StringDecoder('utf8'),
    names: string[] = [];
  try {
    let pending = '',
      count: number;
    while ((count = readSync(input, buffer, 0, buffer.length, null)) > 0) {
      const parts = (pending + decoder.write(buffer.subarray(0, count))).split('\0');
      pending = parts.pop()!;
      names.push(...parts.filter(Boolean));
    }
    pending += decoder.end();
    if (pending) names.push(pending);
  } finally {
    closeSync(input);
    unlinkSync(file);
  }
  return names;
}
export function hashFile(file: string, buffer = Buffer.allocUnsafe(64 * 1024)): string {
  const fd = openSync(file, 'r');
  const hash = createHash('sha256');
  try {
    let count: number;
    while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0)
      hash.update(buffer.subarray(0, count));
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}
export function captureFiles(root: string, names: string[]): FileRevision {
  const blobDirectory = join(adaptiveStateDirectory(root), 'revision-blobs');
  mkdirSync(blobDirectory, { recursive: true, mode: 0o700 });
  if (lstatSync(blobDirectory).isSymbolicLink())
    throw new ExecutionBlocked('review_path', 'El almacén de revisión no permite enlaces.');
  const files: Record<string, string> = Object.create(null);
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const verified = new Set<string>();
  for (const name of [...new Set(names)].sort()) {
    const file = join(root, name);
    let stat;
    try {
      stat = lstatSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink())
      throw new ExecutionBlocked(
        'review_symlink',
        'Revisa los enlaces antes de capturar el alcance.',
      );
    if (!stat.isFile()) continue;
    const rel = relative(root, realpathSync(file));
    if (!rel || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel))
      throw new ExecutionBlocked('review_path', 'Archivo fuera del alcance de revisión.');
    const digest = hashFile(file, buffer),
      destination = join(blobDirectory, digest);
    if (!verified.has(digest)) {
      if (existsSync(destination)) {
        if (lstatSync(destination).isSymbolicLink() || hashFile(destination, buffer) !== digest)
          throw new ExecutionBlocked(
            'review_revision_invalid',
            'La evidencia guardada de revisión ha cambiado.',
          );
      } else {
        const temp = join(blobDirectory, `${randomUUID()}.tmp`);
        try {
          copyFileSync(file, temp, constants.COPYFILE_EXCL);
          if (hashFile(temp, buffer) !== digest)
            throw new ExecutionBlocked(
              'review_changed_files',
              'El archivo cambió mientras se preparaba la revisión.',
            );
          renameSync(temp, destination);
        } finally {
          if (existsSync(temp)) unlinkSync(temp);
        }
      }
      verified.add(digest);
    }
    const after = lstatSync(file);
    if (
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs ||
      after.ctimeMs !== stat.ctimeMs ||
      after.ino !== stat.ino
    )
      throw new ExecutionBlocked(
        'review_changed_files',
        'El archivo cambió mientras se preparaba la revisión.',
      );
    files[name] = digest;
  }
  return {
    format: 'sha256-v1',
    blobDirectory,
    files,
    digest: createHash('sha256').update(JSON.stringify(files)).digest('hex'),
  };
}
export function revisionFile(revision: FileRevision, name: string): string | undefined {
  const digest = revision.files[name];
  if (digest === undefined) return undefined;
  if (revision.format !== 'sha256-v1' || !revision.blobDirectory || !/^[a-f0-9]{64}$/.test(digest))
    throw new ExecutionBlocked('review_revision_invalid', 'La captura de revisión no es válida.');
  const file = join(revision.blobDirectory, digest);
  if (
    lstatSync(revision.blobDirectory).isSymbolicLink() ||
    lstatSync(file).isSymbolicLink() ||
    hashFile(file) !== digest
  )
    throw new ExecutionBlocked(
      'review_revision_invalid',
      'La evidencia guardada de revisión ha cambiado.',
    );
  return file;
}
