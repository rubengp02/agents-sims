import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import type { OfficeCapability } from '../../../core/src/officeTools.js';
import { ExecutionBlocked } from '../execution/types.js';
import { type ConnectionOperationOwner, ConnectionOperations } from './connectionOperations.js';
import { type ManagedMcpTarget, managedMcpTarget } from './officialMcpRegistration.js';
import { publicMcpFetch } from './publicMcpFetch.js';

interface Connection {
  engine?: 'sdk' | 'codex';
  officialServerName?: string;
  uncertain?: { tool: string; at: string };
  enabled?: boolean;
  id: string;
  name: string;
  url: string;
  state: 'unverified' | 'available' | 'needs_connection' | 'blocked';
  reason: string;
  checkedAt: string | null;
  tools: Array<{ name: string; description?: string; inputSchema: unknown }>;
}
export interface RemoteClient {
  listTools(
    params?: { cursor?: string },
    options?: { signal?: AbortSignal },
  ): Promise<{ tools: Connection['tools']; nextCursor?: string }>;
  callTool(
    params: { name: string; arguments: Record<string, unknown> },
    schema?: undefined,
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
  close(): Promise<void>;
}
export type ConnectionOpener = (url: string, signal: AbortSignal) => Promise<RemoteClient>;
export type OfficialConnectionOpener = (
  target: ManagedMcpTarget,
  signal: AbortSignal,
) => Promise<RemoteClient>;
async function openRemote(url: string, signal: AbortSignal): Promise<RemoteClient> {
  const client = new Client({ name: 'oficina-local', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    fetch: publicMcpFetch,
    reconnectionOptions: {
      maxRetries: 0,
      maxReconnectionDelay: 1000,
      initialReconnectionDelay: 1000,
      reconnectionDelayGrowFactor: 1,
    },
  });
  const stop = () => {
    void transport.close();
  };
  signal.addEventListener('abort', stop, { once: true });
  try {
    if (signal.aborted) throw new Error('cancelled');
    await client.connect(transport, { signal, timeout: 30000 });
    return {
      listTools: (params, options) => client.listTools(params, options),
      callTool: (params, schema, options) => client.callTool(params, schema, options),
      close: async () => {
        signal.removeEventListener('abort', stop);
        await client.close();
      },
    };
  } catch (error) {
    signal.removeEventListener('abort', stop);
    await client.close().catch(() => {});
    throw error;
  }
}

/** No commands, tokens, project paths or arbitrary configuration are accepted. */
export class ConnectionManager {
  private entries: Connection[] = [];
  private saving: Promise<void> = Promise.resolve();
  private active = new Map<string, Set<AbortController>>();
  private provisioning = new Map<string, AbortController>();
  private operationsStore: ConnectionOperations;
  constructor(
    private directory: string,
    private open: ConnectionOpener = openRemote,
  ) {
    this.operationsStore = new ConnectionOperations(join(directory, 'operations'));
  }
  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await this.operationsStore.initialize();
    const saved = await readFile(join(this.directory, 'connections.json'), 'utf8').catch(
      (e: NodeJS.ErrnoException) => {
        if (e.code !== 'ENOENT') throw e;
        return '[]';
      },
    );
    const entries: Connection[] = JSON.parse(saved);
    if (
      !Array.isArray(entries) ||
      entries.some(
        (e) =>
          !e || typeof e.id !== 'string' || typeof e.name !== 'string' || typeof e.url !== 'string',
      )
    )
      throw new Error('El registro de conexiones necesita revisión.');
    this.entries = entries.map((e) => ({
      ...e,
      url: this.endpoint(e.url),
      state: e.enabled === false ? 'blocked' : 'unverified',
      reason:
        e.enabled === false
          ? 'Acceso desactivado en la oficina. No revoca permisos en el proveedor.'
          : 'Conexión guardada; hay que comprobarla de nuevo antes de usarla.',
      tools: [],
      checkedAt: null,
    }));
    for (const entry of this.entries) {
      const pending = (await this.operationsStore.list(entry.id)).operations.find(
        (r) => ['dispatching', 'review_required'].includes(r.status) && !r.review,
      );
      if (pending && !entry.uncertain)
        entry.uncertain = { tool: pending.tool, at: new Date(pending.createdAt).toISOString() };
    }
  }
  async operations(connectionId?: string) {
    const result = await this.operationsStore.list(connectionId);
    return {
      ...result,
      operations: result.operations.map((r) => ({
        ...r,
        status:
          r.status === 'dispatching' && !this.active.get(r.connectionId)?.size
            ? 'review_required'
            : r.status,
      })),
    };
  }
  endpoint(raw: string) {
    const url = new URL(raw);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.port && url.port !== '443')
    )
      throw new Error(
        'La conexión necesita una dirección HTTPS sin credenciales, parámetros ni puertos especiales.',
      );
    return url.href;
  }
  list() {
    return structuredClone(this.entries);
  }
  async provision<T>(id: string, signal: AbortSignal, work: (signal: AbortSignal) => Promise<T>) {
    if (this.provisioning.has(id) || this.active.get(id)?.size)
      throw new Error('La conexión ya tiene una operación activa.');
    const controller = new AbortController();
    this.provisioning.set(id, controller);
    try {
      return await work(AbortSignal.any([signal, controller.signal]));
    } finally {
      this.provisioning.delete(id);
    }
  }
  async remember(name: string, raw: string) {
    const url = this.endpoint(raw);
    if (!name.trim() || name.length > 160)
      throw new Error('El nombre de la conexión no es válido.');
    let entry = this.entries.find((e) => e.url === url);
    if (!entry) {
      entry = {
        id: randomUUID(),
        name,
        url,
        enabled: false,
        state: 'unverified',
        reason: 'Pendiente de autorización para conectarse con Codex.',
        checkedAt: null,
        tools: [],
      };
      this.entries.push(entry);
      await this.save();
    }
    return structuredClone(entry);
  }
  async adoptOfficial(id: string, serverName: string) {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) throw new Error('La conexión no existe.');
    if (managedMcpTarget(entry.url).name !== serverName)
      throw new Error('El servidor oficial no coincide con la conexión.');
    if (this.active.get(id)?.size)
      throw new Error('Espera a que termine la operación activa antes de cambiar la conexión.');
    entry.engine = 'codex';
    entry.officialServerName = serverName;
    entry.enabled = true;
    entry.tools = [];
    entry.state = 'unverified';
    entry.reason =
      'Dirección registrada en Codex. Falta comprobar inicio de sesión y herramientas.';
    await this.save();
    return structuredClone(entry);
  }
  async checkOfficial(id: string, signal: AbortSignal, open: OfficialConnectionOpener) {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry || entry.engine !== 'codex') throw new Error('La conexión oficial no existe.');
    if (entry.enabled === false) throw new Error('La conexión está desactivada en la oficina.');
    if (this.active.get(id)?.size) throw new Error('La conexión ya tiene una operación activa.');
    const controller = new AbortController(),
      controllers = this.active.get(id) ?? new Set<AbortController>();
    controllers.add(controller);
    this.active.set(id, controllers);
    try {
      await this.check(entry, AbortSignal.any([signal, controller.signal]), open);
      return structuredClone(entry);
    } finally {
      controllers.delete(controller);
      if (!controllers.size) this.active.delete(id);
    }
  }
  async authenticationIncomplete(id: string, reason: string) {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry || entry.enabled === false) return;
    entry.state = 'needs_connection';
    entry.reason = reason;
    entry.tools = [];
    entry.checkedAt = new Date().toISOString();
    await this.save();
  }
  private async openEntry(
    entry: Connection,
    signal: AbortSignal,
    official?: OfficialConnectionOpener,
  ) {
    if (entry.engine === 'codex') {
      if (!official || !entry.officialServerName)
        throw new Error(
          'La conexión utiliza Codex y este ejecutor no dispone de su adaptador oficial. No se cambiará al cliente HTTP.',
        );
      const target = managedMcpTarget(entry.url);
      if (target.name !== entry.officialServerName)
        throw new Error('La dirección del servidor oficial cambió. Revisa la conexión.');
      return official(target, signal);
    }
    return this.open(entry.url, signal);
  }
  private disabled(entry: Connection) {
    return entry.enabled === false;
  }
  async disable(id: string) {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) throw new Error('La conexión no existe.');
    entry.enabled = false;
    entry.state = 'blocked';
    entry.reason = 'Acceso desactivado en la oficina. No revoca permisos en el proveedor.';
    entry.tools = [];
    entry.checkedAt = new Date().toISOString();
    for (const controller of this.active.get(id) ?? []) controller.abort();
    this.provisioning.get(id)?.abort();
    await this.save();
    return { id: entry.id, enabled: false, reason: entry.reason };
  }
  async acknowledge(id: string) {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) throw new Error('La conexión no existe.');
    if (this.active.get(id)?.size) throw new Error('Espera a que termine la operación activa.');
    await this.operationsStore.acknowledge(id);
    delete entry.uncertain;
    await this.save();
    return { id, reviewed: true };
  }
  capabilities(): OfficeCapability[] {
    return this.entries.map((e) => ({
      id: 'connection:' + e.id,
      name: e.name,
      state: e.state,
      reason: e.reason,
      lastCheckedAt: e.checkedAt,
    }));
  }
  private async save() {
    const content = JSON.stringify(this.entries);
    const next = this.saving
      .catch(() => {})
      .then(async () => {
        const temp = join(this.directory, randomUUID() + '.tmp');
        await writeFile(temp, content, { mode: 0o600, flag: 'wx' });
        await rename(temp, join(this.directory, 'connections.json'));
      });
    this.saving = next;
    await next;
  }
  async connect(name: string, raw: string, signal: AbortSignal) {
    const url = this.endpoint(raw);
    if (!name.trim() || name.length > 160)
      throw new Error('El nombre de la conexión no es válido.');
    let entry = this.entries.find((e) => e.url === url);
    if (!entry) {
      entry = {
        id: randomUUID(),
        name,
        url,
        state: 'unverified',
        reason: 'Pendiente de comprobación.',
        checkedAt: null,
        tools: [],
      };
      this.entries.push(entry);
    }
    if (entry.engine === 'codex')
      throw new Error(
        'Esta conexión se administra con Codex. Utiliza la conexión oficial; no se cambiará al cliente HTTP.',
      );
    if (this.active.get(entry.id)?.size || this.provisioning.has(entry.id))
      throw new Error('La conexión ya tiene una operación activa.');
    entry.enabled = true;
    const controller = new AbortController(),
      controllers = this.active.get(entry.id) ?? new Set<AbortController>();
    controllers.add(controller);
    this.active.set(entry.id, controllers);
    try {
      await this.check(entry, AbortSignal.any([signal, controller.signal]));
    } finally {
      controllers.delete(controller);
      if (!controllers.size) this.active.delete(entry.id);
    }
    return structuredClone(entry);
  }
  private async check(entry: Connection, signal: AbortSignal, official?: OfficialConnectionOpener) {
    let client: RemoteClient | undefined;
    try {
      client = await this.openEntry(entry, signal, official);
      const tools: Connection['tools'] = [];
      let cursor: string | undefined;
      const seen = new Set<string>();
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined, { signal });
        tools.push(...page.tools);
        cursor = page.nextCursor;
        if (cursor && seen.has(cursor)) throw new Error('catalog loop');
        if (cursor) seen.add(cursor);
      } while (cursor);
      if (signal.aborted) throw new Error('cancelled');
      entry.tools = tools;
      entry.state = 'unverified';
      entry.reason = `Conexión y catálogo comprobados: ${tools.length} herramientas. Falta comprobar una operación.`;
    } catch (error) {
      entry.tools = [];
      const auth = /401|unauthorized|authentication|autenticación|inicio de sesión/i.test(
        String(error),
      );
      entry.state = auth ? 'needs_connection' : 'blocked';
      entry.reason = signal.aborted
        ? 'Comprobación cancelada; no se reanudará automáticamente.'
        : /403/.test(String(error))
          ? 'El proveedor denegó el acceso (403). No se cambiará de transporte ni se repetirá el inicio de sesión para eludirlo.'
          : entry.engine === 'codex' && error instanceof ExecutionBlocked
            ? error.message
            : auth
              ? entry.engine === 'codex'
                ? 'El servicio necesita inicio de sesión mediante Codex. Solicita conectar la conexión oficial; no introduzcas claves en el chat.'
                : 'El servicio exige autenticación. Puedes solicitar administrarla con Codex; no introduzcas claves en el chat.'
              : 'No se pudo comprobar la conexión. Revisa la dirección y compatibilidad MCP HTTP.';
    } finally {
      await client?.close().catch(() => {});
      if (this.disabled(entry)) {
        entry.tools = [];
        entry.state = 'blocked';
        entry.reason = 'Acceso desactivado en la oficina. No revoca permisos en el proveedor.';
      }
      entry.checkedAt = new Date().toISOString();
      await this.save();
    }
  }
  async call(
    id: string,
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
    official?: OfficialConnectionOpener,
    expectedTool?: Connection['tools'][number],
    owner: ConnectionOperationOwner = {},
  ) {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) throw new Error('La conexión no existe.');
    if (entry.enabled === false) throw new Error('La conexión está desactivada en la oficina.');
    if (this.active.get(id)?.size || this.provisioning.has(id))
      throw new Error('La conexión ya tiene una operación activa.');
    if (entry.uncertain)
      throw new Error(
        'La conexión tiene una operación de resultado incierto. Revisa el proveedor y confirma la revisión en Herramientas y conexiones antes de solicitar otra operación.',
      );
    const controller = new AbortController(),
      controllers = this.active.get(id) ?? new Set<AbortController>();
    controllers.add(controller);
    this.active.set(id, controllers);
    signal = AbortSignal.any([signal, controller.signal]);
    try {
      return await this.performCall(entry, name, args, signal, official, expectedTool, owner);
    } finally {
      controllers.delete(controller);
      if (!controllers.size) this.active.delete(id);
    }
  }
  private async performCall(
    entry: Connection,
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
    official?: OfficialConnectionOpener,
    expectedTool?: Connection['tools'][number],
    owner: ConnectionOperationOwner = {},
  ) {
    args = structuredClone(args);
    if (
      (await this.operationsStore.list(entry.id)).operations.some(
        (r) => ['dispatching', 'review_required'].includes(r.status) && !r.review,
      )
    )
      throw new Error(
        'La conexión tiene una operación de resultado incierto pendiente de revisión.',
      );
    if (entry.engine === 'codex' && !official)
      throw new Error('El ejecutor no dispone del adaptador oficial de esta conexión.');
    await this.check(entry, signal, official);
    if (entry.enabled === false || signal.aborted || !entry.tools.some((t) => t.name === name))
      throw new Error('La herramienta no está disponible en esta conexión.');
    if (
      expectedTool &&
      JSON.stringify(entry.tools.find((tool) => tool.name === name)) !==
        JSON.stringify(expectedTool)
    )
      throw new Error(
        'La herramienta cambió desde la aprobación. Comprueba el catálogo y solicita una nueva operación.',
      );
    let client: RemoteClient | undefined;
    let dispatched = false;
    let receipt: Awaited<ReturnType<ConnectionOperations['start']>> | undefined;
    try {
      client = await this.openEntry(entry, signal, official);
      if (expectedTool) {
        const page = await client.listTools(undefined, { signal });
        if (
          JSON.stringify(page.tools.find((tool) => tool.name === name)) !==
          JSON.stringify(expectedTool)
        )
          throw new Error('La herramienta cambió desde la aprobación.');
      }
      if (signal.aborted) throw new Error('cancelled before dispatch');
      // A process crash must leave evidence before an external operation can start.
      entry.uncertain = { tool: name, at: new Date().toISOString() };
      receipt = await this.operationsStore.start(
        entry.id,
        name,
        args,
        entry.tools.find((t) => t.name === name),
        owner,
      );
      await this.save();
      if (signal.aborted || this.disabled(entry)) throw new Error('cancelled before dispatch');
      dispatched = true;
      const result = await client.callTool({ name, arguments: args }, undefined, { signal });
      if (signal.aborted) throw new Error('cancelled');
      if (this.disabled(entry)) throw new Error('disabled');
      if (
        !result ||
        typeof result !== 'object' ||
        !('content' in result) ||
        !Array.isArray(result.content)
      )
        throw new Error('unknown result');
      delete entry.uncertain;
      const failed = 'isError' in result && result.isError === true;
      if (!failed) {
        entry.state = 'available';
        entry.reason = `Operación ${name} completada. Cada operación futura mantiene su propia aprobación.`;
      } else {
        entry.state = 'blocked';
        entry.reason = `La operación ${name} devolvió un error. Revisa el resultado antes de continuar.`;
      }
      entry.checkedAt = new Date().toISOString();
      await this.operationsStore.finish(receipt, failed ? 'failed' : 'completed', result);
      await this.save();
      return { ...result, operationId: receipt.id, status: receipt.status };
    } catch {
      if (dispatched) entry.uncertain = { tool: name, at: new Date().toISOString() };
      else delete entry.uncertain;
      entry.state = 'blocked';
      entry.reason = dispatched
        ? 'El resultado de la operación no se pudo confirmar. No se repetirá automáticamente; revisa el servicio antes de reintentar.'
        : 'La operación no se envió: no se pudo verificar la herramienta aprobada. Comprueba el catálogo antes de solicitarla de nuevo.';
      if (receipt)
        await this.operationsStore.finish(receipt, dispatched ? 'review_required' : 'not_sent');
      await this.save();
      throw new Error(entry.reason);
    } finally {
      await client?.close().catch(() => {});
    }
  }
}
