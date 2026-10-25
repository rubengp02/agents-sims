import { createHash } from 'node:crypto';

import { object } from '../execution/subscriptionPolicy.js';

export interface ApplicationClient {
  list(cursor?: string): Promise<unknown>;
  read(ids: string[]): Promise<unknown>;
  installed(refresh: boolean): Promise<unknown>;
  close(): Promise<void>;
}
export type ApplicationOpener = (signal: AbortSignal) => Promise<ApplicationClient>;
export interface PreparedApplication {
  id: string;
  nativeId: string;
  name: string;
  url: string | null;
  fingerprint: string;
  source: 'directory' | 'installed' | 'plugin';
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function applicationUrl(raw: unknown) {
  if (typeof raw !== 'string')
    throw new Error('La aplicación no ofrece un enlace oficial de conexión.');
  const url = new URL(raw);
  if (
    url.origin !== 'https://chatgpt.com' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/apps\/[^/]+\/[^/]+\/?$/.test(url.pathname)
  )
    throw new Error('El enlace de conexión no corresponde al directorio oficial de ChatGPT.');
  return url.href;
}
/** App metadata and committed runtime state are separate evidence, never credentials. */
export class OfficialApplications {
  constructor(readonly open: ApplicationOpener) {}
  private async catalogue(client: ApplicationClient) {
    const apps: Array<Record<string, unknown>> = [],
      cursors = new Set<string>(),
      ids = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = object(await client.list(cursor));
      if (!Array.isArray(page.data))
        throw new Error('El catálogo oficial de aplicaciones está incompleto.');
      for (const raw of page.data) {
        const app = object(raw);
        if (typeof app.id !== 'string' || typeof app.name !== 'string' || ids.has(app.id))
          throw new Error('El catálogo oficial de aplicaciones necesita revisión.');
        ids.add(app.id);
        apps.push(app);
      }
      cursor = typeof page.nextCursor === 'string' ? page.nextCursor : undefined;
      if (cursor && cursors.has(cursor))
        throw new Error('El catálogo oficial de aplicaciones repite una página.');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return apps;
  }
  async list(signal: AbortSignal, query = '', offset = 0, limit = 25) {
    if (
      query.length > 200 ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new Error('La consulta de aplicaciones necesita una página válida.');
    const client = await this.open(signal);
    try {
      const apps = (await this.catalogue(client)).filter((a) =>
        String(a.name).toLowerCase().includes(query.toLowerCase()),
      );
      return {
        total: apps.length,
        nextOffset: offset + limit < apps.length ? offset + limit : null,
        apps: apps.slice(offset, offset + limit).map((a) => ({
          id: digest(a.id),
          name: a.name,
          accessible: a.isAccessible === true,
          enabled: a.isEnabled !== false,
          connectionOffered: typeof a.installUrl === 'string',
        })),
        note: 'Catálogo oficial. Accesible no acredita inicio de sesión ni una operación. Usa app_connect para la conexión y integrations_list para las herramientas. Un 403 se conserva; no se sustituye por otro catálogo.',
      };
    } finally {
      await client.close();
    }
  }
  async installed(signal: AbortSignal) {
    const client = await this.open(signal);
    try {
      const result = object(await client.installed(true));
      if (!Array.isArray(result.apps))
        throw new Error('Codex no confirmó las aplicaciones instaladas.');
      return {
        source: 'installed' as const,
        apps: result.apps.map((raw) => {
          const app = object(raw);
          if (typeof app.id !== 'string')
            throw new Error('El estado de las aplicaciones instaladas necesita revisión.');
          return {
            id: digest(app.id),
            name: typeof app.runtimeName === 'string' ? app.runtimeName : 'Aplicación instalada',
            enabled: app.enabled === true,
            callable: app.callable === true,
          };
        }),
        note: 'Estado del runtime instalado, distinto del directorio general. callable acredita herramientas permitidas, no una operación ni una autorización futura.',
      };
    } finally {
      await client.close();
    }
  }
  async prepare(
    id: string,
    signal: AbortSignal,
    source: 'directory' | 'installed' | 'plugin' = 'directory',
    pluginApps?: ReadonlyArray<{ id: string; name: string }>,
  ): Promise<PreparedApplication> {
    const client = await this.open(signal);
    try {
      let apps: Array<Record<string, unknown>>;
      if (source === 'plugin') {
        if (!pluginApps)
          throw new Error('Falta comprobar las aplicaciones declaradas por el plugin instalado.');
        apps = pluginApps.map((app) => ({ ...app }));
      } else if (source === 'installed') {
        const result = object(await client.installed(false));
        if (!Array.isArray(result.apps))
          throw new Error('Codex no confirmó las aplicaciones instaladas.');
        apps = result.apps.map(object);
      } else apps = await this.catalogue(client);
      const app = apps.find((a) => digest(a.id) === id);
      if (!app) throw new Error('La aplicación no aparece en el catálogo oficial.');
      const metadata = object(await client.read([String(app.id)]));
      if (
        !Array.isArray(metadata.apps) ||
        metadata.apps.length !== 1 ||
        object(metadata.apps[0]).id !== app.id
      )
        throw new Error('Codex no confirmó los metadatos de la aplicación.');
      const detail = object(metadata.apps[0]);
      const offered = detail.installUrl ?? app.installUrl;
      const url = offered === undefined || offered === null ? null : applicationUrl(offered);
      return {
        id,
        nativeId: String(app.id),
        name: String(detail.name ?? app.name),
        url,
        fingerprint: digest([app.id, detail.name ?? app.name, url]),
        source,
      };
    } finally {
      await client.close();
    }
  }
  async check(application: PreparedApplication, signal: AbortSignal) {
    const client = await this.open(signal);
    try {
      const result = object(await client.installed(true));
      if (!Array.isArray(result.apps))
        throw new Error('Codex no confirmó el estado de las aplicaciones instaladas.');
      const matches = result.apps.map(object).filter((a) => a.id === application.nativeId);
      if (matches.length > 1) throw new Error('El estado de la aplicación necesita revisión.');
      return { enabled: matches[0]?.enabled === true, callable: matches[0]?.callable === true };
    } finally {
      await client.close();
    }
  }
}
