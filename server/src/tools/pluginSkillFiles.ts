import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { projectFileTool } from './projectFiles.js';

const inside = (root: string, file: string) => {
  const path = relative(root, file);
  return path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path);
};

/** Official metadata selects the file; callers supply only skill IDs and relative resources. */
export async function pluginSkillFile(input: {
  cache: string;
  marketplace: string;
  plugin: string;
  path: string;
  resource?: Record<string, unknown>;
}) {
  for (const part of [input.marketplace, input.plugin])
    if (!part || part === '.' || part === '..' || /[\\/:\0]/.test(part))
      throw new Error('El origen del plugin no permite comprobar sus archivos locales.');
  if (!isAbsolute(input.path))
    throw new Error('La skill no dispone de un archivo local compatible.');
  const cache = resolve(input.cache);
  const bundled = join(dirname(dirname(cache)), '.tmp', 'bundled-marketplaces');
  const cacheRoot = join(cache, input.marketplace, input.plugin);
  const bundledRoot = join(bundled, input.marketplace, 'plugins', input.plugin);
  const origin = inside(cacheRoot, input.path)
    ? 'installed_cache'
    : inside(bundledRoot, input.path)
      ? 'official_bundled_source'
      : null;
  if (!origin) throw new Error('El archivo de la skill está fuera del plugin registrado.');
  const base = await realpath(origin === 'installed_cache' ? cache : bundled);
  const expectedRoot =
    origin === 'installed_cache'
      ? join(base, input.marketplace, input.plugin)
      : join(base, input.marketplace, 'plugins', input.plugin);
  // Refuse a package root redirected to another plugin, even inside the cache.
  for (const file of [
    join(base, input.marketplace),
    ...(origin === 'official_bundled_source' ? [join(base, input.marketplace, 'plugins')] : []),
    expectedRoot,
  ])
    if ((await lstat(file)).isSymbolicLink())
      throw new Error('El paquete necesita revisión por sus enlaces.');
  const root = await realpath(expectedRoot),
    file = await realpath(input.path);
  if (!inside(base, root) || !inside(root, file) || !/[\\/]SKILL\.md$/i.test(file))
    throw new Error('El archivo de la skill está fuera del plugin registrado.');
  if (input.resource)
    return {
      origin,
      ...(await projectFileTool(
        dirname(file),
        input.resource.list === true ? 'project_list' : 'project_read',
        input.resource,
      )),
    };
  return { origin, text: await readFile(file, 'utf8'), complete: true };
}
