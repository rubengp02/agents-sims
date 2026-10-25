import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
const hidden = (name: string) =>
  /^\.env(?:\.|$)|^(?:credentials|auth|secrets)(?:\.(?:json|toml|ya?ml|ini))?$|^(?:\.npmrc|\.git-credentials|id_rsa|id_ed25519|\.git|\.hg|\.svn|\.local-office)$|\.(?:pem|key|pfx|p12)$/i.test(
    name,
  );
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
    if ((await lstat(cursor)).isSymbolicLink())
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
    const buffer = Buffer.alloc(Number(bytes)),
      { bytesRead } = await handle.read(buffer, 0, buffer.length, Number(offset));
    return {
      path: name,
      text: buffer.subarray(0, bytesRead).toString('utf8'),
      nextOffset: Number(offset) + bytesRead,
      eof: bytesRead < buffer.length,
    };
  } finally {
    await handle.close();
  }
}
