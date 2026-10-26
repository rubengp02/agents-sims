import { createHash } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import { lstat, mkdir, open, readdir, realpath, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { isAbsolute, relative, resolve, sep } from 'node:path';
const hidden = (name: string) =>
  /^\.env(?:\.|$)|^(?:credentials|auth|secrets)(?:\.(?:json|toml|ya?ml|ini))?$|^(?:\.npmrc|\.git-credentials|id_rsa|id_ed25519|\.git|\.hg|\.svn|\.local-office)$|\.(?:pem|key|pfx|p12)$/i.test(
    name,
  );
async function fileHash(handle: FileHandle): Promise<string> {
  const hash = createHash('sha256'),
    block = Buffer.alloc(64 * 1024);
  let position = 0;
  for (;;) {
    const { bytesRead } = await handle.read(block, 0, block.length, position);
    if (!bytesRead) break;
    hash.update(block.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest('hex');
}
export async function projectFileTool(
  root: string,
  operation: string,
  args: Record<string, unknown>,
) {
  const base = await realpath(root),
    name = args.path ?? '.';
  if (
    typeof name !== 'string' ||
    name.includes(':') ||
    isAbsolute(name) ||
    name.split(/[\\/]/).some((p) => p === '..' || hidden(p))
  )
    throw new Error('La ruta solicitada está fuera de los archivos autorizados.');
  const file = resolve(base, name),
    rel = relative(base, file);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep))
    throw new Error('La ruta está fuera del proyecto.');
  let cursor = base;
  for (const part of rel.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, part);
    const info = await lstat(cursor).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' && ['project_write', 'project_delete'].includes(operation))
        return null;
      throw error;
    });
    if (info?.isSymbolicLink())
      throw new Error('Los enlaces necesitan revisión antes de acceder a otros archivos.');
  }
  if (operation === 'project_list')
    return {
      path: name,
      entries: (await readdir(file, { withFileTypes: true }))
        .filter(
          (e) => !hidden(e.name) && !['.git', 'node_modules', '.vscode-test'].includes(e.name),
        )
        .map((e) => ({ name: e.name, directory: e.isDirectory() })),
    };
  if (operation === 'project_write' || operation === 'project_delete') {
    const expected = args.expectedSha256;
    if (expected !== null && (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)))
      throw new Error('Falta la huella expectedSha256 del archivo, o null para crear uno nuevo.');
    if (operation === 'project_delete' && expected === null)
      throw new Error('La eliminación necesita la huella del archivo existente.');
    if (operation === 'project_write' && typeof args.content !== 'string')
      throw new Error('Falta el contenido de texto autorizado.');
    if (operation === 'project_write' && expected === null)
      await mkdir(dirname(file), { recursive: true });
    const handle = await open(file, expected === null ? 'wx+' : 'r+');
    try {
      if (expected !== null) {
        const hash = await fileHash(handle);
        if (hash !== expected)
          throw new Error(
            'El archivo cambió desde su lectura. Vuelve a revisarlo antes de escribir.',
          );
      }
      if (operation === 'project_write') {
        await handle.write(
          Buffer.from(args.content as string, 'utf8'),
          0,
          Buffer.byteLength(args.content as string),
          0,
        );
        await handle.truncate(Buffer.byteLength(args.content as string));
      }
    } finally {
      await handle.close();
    }
    if (operation === 'project_delete') await unlink(file);
    return {
      path: name,
      operation,
      sha256:
        operation === 'project_delete'
          ? null
          : createHash('sha256')
              .update(args.content as string)
              .digest('hex'),
    };
  }
  const offset = args.offset ?? 0,
    bytes = args.bytes ?? 16000;
  if (
    !Number.isSafeInteger(offset) ||
    Number(offset) < 0 ||
    !Number.isSafeInteger(bytes) ||
    Number(bytes) < 1 ||
    Number(bytes) > 65536
  )
    throw new Error('La lectura necesita un desplazamiento y un bloque de hasta 65536 bytes.');
  const handle = await open(file, 'r');
  try {
    const sha256 = await fileHash(handle);
    const buffer = Buffer.alloc(Number(bytes)),
      { bytesRead } = await handle.read(buffer, 0, buffer.length, Number(offset));
    return {
      path: name,
      sha256,
      text: buffer.subarray(0, bytesRead).toString('utf8'),
      nextOffset: Number(offset) + bytesRead,
      eof: bytesRead < buffer.length,
    };
  } finally {
    await handle.close();
  }
}
