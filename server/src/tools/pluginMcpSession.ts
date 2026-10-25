import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { object } from '../execution/subscriptionPolicy.js';
import { type OperationOwner, readReviewedReceipt } from './operationReviews.js';

export interface PluginMcpSelection {
  pluginId: string;
  nativeId: string;
  name: string;
  marketplace: string;
  fingerprint: string;
  pluginIds: string[];
  servers: string[];
}
export interface PluginMcpClient {
  list(): Promise<unknown>;
  call(server: string, tool: string, args: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}
export type PluginMcpOpener = (
  selection: PluginMcpSelection,
  signal: AbortSignal,
) => Promise<PluginMcpClient>;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => [key, canonical(v)]),
    );
  return value;
}
const hash = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
interface Tool {
  id: string;
  server: string;
  name: string;
  description: string;
  inputSchema: unknown;
}
interface Connection {
  id: string;
  selection: PluginMcpSelection;
  client: PluginMcpClient;
  tools: Tool[];
  busy: boolean;
}

/** Connections are private to one employee lifetime. Only public opaque IDs reach the model. */
export class PluginMcpSession {
  private connections = new Map<string, Connection>();
  private closed = false;
  constructor(
    private directory: string,
    private open: PluginMcpOpener,
    private refresh: (pluginId: string, signal: AbortSignal) => Promise<PluginMcpSelection>,
    private owner?: OperationOwner,
  ) {}
  private async catalogue(client: PluginMcpClient, selection: PluginMcpSelection): Promise<Tool[]> {
    const response = object(await client.list());
    if (!Array.isArray(response.data) || response.nextCursor)
      throw new Error('El catálogo MCP del plugin está incompleto.');
    const servers = response.data.map(object).filter((s) => s.pluginId === selection.nativeId);
    const names = new Set<string>();
    const tools: Tool[] = [];
    for (const server of servers) {
      if (typeof server.name !== 'string' || names.has(server.name) || server.toolsError)
        throw new Error('El catálogo MCP del plugin necesita revisión.');
      names.add(server.name);
      for (const [name, raw] of Object.entries(object(server.tools))) {
        const metadata = object(raw);
        tools.push({
          id: hash([selection.fingerprint, server.name, name, metadata]),
          server: server.name,
          name,
          description: typeof metadata.description === 'string' ? metadata.description : '',
          inputSchema: metadata.inputSchema,
        });
      }
    }
    if (!tools.length) throw new Error('El plugin no ha expuesto herramientas MCP comprobables.');
    return tools;
  }
  async connect(selection: PluginMcpSelection, signal: AbortSignal) {
    if (this.closed || signal.aborted) throw new Error('La conexión del plugin se ha cancelado.');
    const current = await this.refresh(selection.pluginId, signal);
    if (current.fingerprint !== selection.fingerprint)
      throw new Error('El plugin cambió desde la aprobación. Prepara otra conexión.');
    const client = await this.open(current, signal);
    try {
      const tools = await this.catalogue(client, current);
      if (this.closed || signal.aborted) throw new Error('La conexión del plugin se ha cancelado.');
      const id = randomUUID();
      this.connections.set(id, { id, selection: current, client, tools, busy: false });
      return {
        plugin: current.name,
        ...this.list(id),
        note: 'Conexión comprobada para este empleado; no autoriza operaciones futuras. No se restaura al reiniciar.',
      };
    } catch (error) {
      await client.close().catch(() => {});
      throw error;
    }
  }
  list(connectionId: string, query = '', offset = 0, limit = 25) {
    const connection = this.connections.get(connectionId);
    if (this.closed || !connection)
      throw new Error('La conexión del plugin ya no está disponible.');
    if (
      typeof query !== 'string' ||
      query.length > 200 ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new Error('La consulta necesita texto y una página de una a cien herramientas.');
    const tools = connection.tools.filter((t) =>
      `${t.server} ${t.name}`.toLowerCase().includes(query.toLowerCase()),
    );
    return {
      connectionId,
      total: tools.length,
      catalogueTotal: connection.tools.length,
      nextOffset: offset + limit < tools.length ? offset + limit : null,
      tools: tools.slice(offset, offset + limit),
    };
  }
  prepare(connectionId: string, toolId: string) {
    const connection = this.connections.get(connectionId),
      tool = connection?.tools.find((t) => t.id === toolId);
    if (this.closed || !connection || !tool)
      throw new Error(
        'La conexión o herramienta ya no está disponible. Solicita una conexión nueva.',
      );
    return {
      plugin: connection.selection.name,
      marketplace: connection.selection.marketplace,
      ...structuredClone(tool),
    };
  }
  async operations(): Promise<Array<Record<string, unknown>>> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    return Promise.all(
      (await readdir(this.directory))
        .filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))
        .map(async (name) => {
          const { record: receipt, review } = await readReviewedReceipt(this.directory, name);
          return {
            ...receipt,
            ...(review ? { review } : {}),
            status: receipt.status === 'dispatching' ? 'review_required' : receipt.status,
          };
        }),
    );
  }
  async call(
    connectionId: string,
    toolId: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ) {
    args = structuredClone(args);
    const connection = this.connections.get(connectionId);
    const tool = this.prepare(connectionId, toolId);
    if (!connection || connection.busy)
      throw new Error('La conexión del plugin ya tiene una operación activa.');
    connection.busy = true;
    const receipt = {
      id: randomUUID(),
      pluginId: connection.selection.pluginId,
      plugin: connection.selection.name,
      server: tool.server,
      tool: tool.name,
      description: tool.description,
      taskId: this.owner?.taskId,
      conversationId: this.owner?.conversationId,
      argumentsHash: hash(args),
      status: 'prepared',
      updatedAt: Date.now(),
    };
    const save = async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const file = join(this.directory, receipt.id + '.json'),
        temp = file + '.' + randomUUID() + '.tmp';
      receipt.updatedAt = Date.now();
      await writeFile(temp, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 });
      await rename(temp, file);
    };
    const abort = () => {
      this.connections.delete(connectionId);
      void connection.client.close().catch(() => {});
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      if (
        (await this.operations()).some(
          (r) =>
            r.pluginId === receipt.pluginId &&
            r.server === receipt.server &&
            r.tool === receipt.tool &&
            r.argumentsHash === receipt.argumentsHash &&
            r.status === 'review_required' &&
            !r.review,
        )
      )
        throw new Error(
          'La operación anterior tiene resultado incierto. Revisa el servicio; no se repetirá automáticamente.',
        );
      const current = await this.refresh(connection.selection.pluginId, signal);
      if (current.fingerprint !== connection.selection.fingerprint)
        throw new Error('El plugin cambió desde la aprobación. Solicita otra conexión.');
      if (!(await this.catalogue(connection.client, current)).some((t) => t.id === toolId))
        throw new Error('La herramienta cambió desde la aprobación. Solicita otra conexión.');
      if (this.closed || signal.aborted)
        throw new Error('La operación del plugin se ha cancelado.');
      receipt.status = 'dispatching';
      await save();
      const result = object(
        await connection.client.call(tool.server, tool.name, structuredClone(args)),
      );
      if (this.closed || signal.aborted || !Array.isArray(result.content))
        throw new Error('unknown outcome');
      receipt.status = result.isError === true ? 'failed' : 'completed';
      await save();
      return {
        ...result,
        isError: result.isError === true,
        operationId: receipt.id,
        status: receipt.status,
      };
    } catch (error) {
      if (receipt.status === 'dispatching') {
        receipt.status = 'review_required';
        await save();
        throw new Error(
          'El resultado MCP del plugin es incierto. No se repetirá automáticamente. Revisa su recibo y el servicio.',
        );
      }
      throw error;
    } finally {
      signal.removeEventListener('abort', abort);
      connection.busy = false;
    }
  }
  async close() {
    this.closed = true;
    const clients = [...this.connections.values()];
    this.connections.clear();
    await Promise.allSettled(clients.map((c) => c.client.close()));
  }
}
