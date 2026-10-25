import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { join } from 'node:path';

import type { OfficeAuthentication } from '../../../core/src/officeTools.js';
import { object } from '../execution/subscriptionPolicy.js';
import type { OfficialApplications, PreparedApplication } from './officialApplications.js';
import { readReviewedReceipt } from './operationReviews.js';
import { publicAddress } from './publicMcpFetch.js';

export interface AuthenticationClient {
  logout?(name: string): Promise<void>;
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
  onNotification(listener: (method: string, params: Record<string, unknown>) => void): () => void;
  onDisconnect(listener: () => void): () => void;
  close(): Promise<void>;
}
export type AuthenticationOpener = (signal: AbortSignal) => Promise<AuthenticationClient>;
const identity = (name: string) => createHash('sha256').update(name).digest('hex');
export function authorizationUrl(value: unknown): string {
  if (typeof value !== 'string')
    throw new Error('La autorización oficial no tiene una dirección válida.');
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== '443') ||
    (isIP(url.hostname.replace(/^\[|\]$/g, '')) !== 0 &&
      !publicAddress(url.hostname.replace(/^\[|\]$/g, ''))) ||
    !url.hostname.includes('.') ||
    /^(localhost|127\.|\[)/i.test(url.hostname)
  )
    throw new Error('La autorización necesita una página HTTPS del proveedor.');
  return url.href;
}

/** The official process owns OAuth and credentials. We retain only public lifecycle receipts. */
export class OfficialAuthentication {
  private entries = new Map<string, OfficeAuthentication>();
  private pending = new Map<string, () => void>();
  private serversInUse = new Set<string>();
  private applicationChecks = new Map<string, () => Promise<boolean>>();
  private writes = new Map<string, Promise<void>>();
  constructor(
    private directory: string,
    private timeoutMs = 300000,
  ) {}
  private async save(entry: OfficeAuthentication) {
    const { authorizationUrl: _url, ...safe } = entry;
    void _url;
    const contents = JSON.stringify(safe);
    // Initial publication, manual checks and completion can save the same receipt
    // together. Serialize replacements so Windows never sees competing renames.
    const write = (this.writes.get(entry.id) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const file = join(this.directory, entry.id + '.json'),
          temp = file + '.' + randomUUID() + '.tmp';
        await writeFile(temp, contents, { flag: 'wx', mode: 0o600 });
        await rename(temp, file);
      });
    this.writes.set(entry.id, write);
    try {
      await write;
    } finally {
      if (this.writes.get(entry.id) === write) this.writes.delete(entry.id);
    }
  }
  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (const file of await readdir(this.directory))
      if (/^[a-f0-9-]{36}\.json$/.test(file)) {
        const entry = JSON.parse(
          await readFile(join(this.directory, file), 'utf8'),
        ) as OfficeAuthentication;
        if (
          typeof entry.id !== 'string' ||
          file !== entry.id + '.json' ||
          typeof entry.taskId !== 'string' ||
          typeof entry.service !== 'string' ||
          typeof entry.reason !== 'string' ||
          !Number.isFinite(entry.expiresAt) ||
          ![
            'awaiting_user',
            'verifying',
            'authenticated',
            'failed',
            'cancelled',
            'expired',
          ].includes(entry.status)
        )
          throw new Error('El historial de autenticación necesita revisión.');
        delete entry.authorizationUrl;
        if (entry.status === 'awaiting_user' || entry.status === 'verifying') {
          entry.status = 'cancelled';
          entry.reason =
            'La oficina se reinició. No se conserva ni reabre la autorización anterior.';
          await this.save(entry);
        }
        this.entries.set(entry.id, entry);
      }
  }
  list() {
    return structuredClone([...this.entries.values()]);
  }
  cancel(id: string) {
    const cancel = this.pending.get(id);
    if (!cancel || !['awaiting_user', 'verifying'].includes(this.entries.get(id)?.status ?? ''))
      return false;
    cancel();
    return true;
  }
  close() {
    for (const cancel of [...this.pending.values()]) cancel();
  }
  async checkApplication(id: string) {
    return this.applicationChecks.get(id)?.() ?? false;
  }
  async connectApplication(
    manager: OfficialApplications,
    application: PreparedApplication,
    taskId: string,
    signal: AbortSignal,
  ) {
    if (!application.url)
      throw new Error('La aplicación no ofrece una página oficial de conexión.');
    const key = 'application:' + application.id;
    if (this.serversInUse.has(key))
      throw new Error('Esta aplicación ya tiene una conexión pendiente.');
    this.serversInUse.add(key);
    const entry: OfficeAuthentication = {
      id: randomUUID(),
      taskId,
      service: application.name,
      kind: 'application',
      status: 'awaiting_user',
      authorizationUrl: application.url,
      reason:
        'Completa la conexión en la página oficial de ChatGPT. Después pulsa «Ya he conectado, comprobar». No se solicitan credenciales en la oficina.',
      expiresAt: Date.now() + this.timeoutMs,
    };
    let finish = () => {},
      checking = false;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const conclude = (status: OfficeAuthentication['status'], reason: string) => {
      if (!['awaiting_user', 'verifying'].includes(entry.status)) return;
      entry.status = status;
      entry.reason = reason;
      delete entry.authorizationUrl;
      finish();
    };
    const abort = () =>
      conclude(
        'cancelled',
        'La conexión se ha cancelado. No se revocan permisos en el proveedor ni se reanudará automáticamente.',
      );
    const timer = setTimeout(
      () => conclude('expired', 'La espera de conexión caducó. No se reabrirá automáticamente.'),
      this.timeoutMs,
    );
    const verification = new AbortController();
    const cancel = () => {
      verification.abort();
      abort();
    };
    this.entries.set(entry.id, entry);
    this.pending.set(entry.id, cancel);
    this.applicationChecks.set(entry.id, async () => {
      if (entry.expiresAt <= Date.now()) {
        conclude('expired', 'La espera de conexión caducó.');
        return false;
      }
      if (checking || entry.status !== 'awaiting_user' || signal.aborted) return false;
      checking = true;
      entry.status = 'verifying';
      entry.reason = 'Comprobando el estado instalado oficial de esta aplicación.';
      try {
        const state = await manager.check(
          application,
          AbortSignal.any([signal, verification.signal]),
        );
        if (entry.status !== 'verifying') return false;
        if (state.enabled && state.callable)
          conclude(
            'authenticated',
            'Codex confirma la aplicación habilitada y con herramientas permitidas. Falta comprobar la operación solicitada; no autoriza acciones futuras.',
          );
        else {
          conclude(
            'failed',
            'La comprobación terminó: esta aplicación no ofrece herramientas habilitadas al ejecutor de Codex. Tu cuenta puede estar conectada correctamente en ChatGPT; eso no confirma su disponibilidad aquí. No necesitas repetir el inicio de sesión. Este intento se cierra sin desconectar la cuenta. Si existe una conexión MCP verificada, puede utilizarse como vía explícita independiente.',
          );
        }
        await this.save(entry);
        return this.entries.get(entry.id)?.status === 'authenticated';
      } catch {
        if (entry.status === 'verifying') {
          entry.status = 'awaiting_user';
          entry.reason =
            'No se pudo comprobar el estado oficial. No se da la conexión por completada; puedes comprobarla de nuevo o cancelar.';
          await this.save(entry);
        }
        return false;
      } finally {
        checking = false;
      }
    });
    signal.addEventListener('abort', cancel, { once: true });
    try {
      await this.save(entry);
      if (signal.aborted) cancel();
      await done;
      await this.save(entry);
    } finally {
      clearTimeout(timer);
      verification.abort();
      signal.removeEventListener('abort', cancel);
      this.pending.delete(entry.id);
      this.applicationChecks.delete(entry.id);
      this.serversInUse.delete(key);
    }
    return { id: entry.id, service: entry.service, status: entry.status, reason: entry.reason };
  }
  private async servers(client: AuthenticationClient) {
    const result: Array<{ id: string; name: string; authStatus: string }> = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const page = object(
        await client.request('mcpServerStatus/list', { limit: 100, ...(cursor ? { cursor } : {}) }),
      );
      if (!Array.isArray(page.data))
        throw new Error('El catálogo de autenticación no se pudo comprobar.');
      for (const raw of page.data) {
        const e = object(raw);
        if (typeof e.name === 'string')
          result.push({
            id: identity(e.name),
            name: e.name,
            authStatus: typeof e.authStatus === 'string' ? e.authStatus : 'unknown',
          });
      }
      cursor = typeof page.nextCursor === 'string' ? page.nextCursor : undefined;
      if (cursor && seen.has(cursor))
        throw new Error('El catálogo de autenticación está incompleto.');
      if (cursor) seen.add(cursor);
    } while (cursor);
    return result;
  }
  async describe(open: AuthenticationOpener, signal: AbortSignal) {
    const client = await open(signal);
    try {
      return {
        servers: await this.servers(client),
        note: 'Solo servidores registrados en Codex. bearerToken no implica que su token se deba copiar o volver a pedir. OAuth configurado no acredita una operación.',
      };
    } finally {
      await client.close();
    }
  }
  async prepare(open: AuthenticationOpener, id: string, signal: AbortSignal) {
    const { servers } = await this.describe(open, signal),
      server = servers.find((e) => e.id === id);
    if (!server) throw new Error('El servidor no aparece en el catálogo oficial de autenticación.');
    if (!['notLoggedIn', 'oAuth'].includes(server.authStatus))
      throw new Error(
        'El servidor no expone un flujo OAuth compatible. No copies tokens ni credenciales; revisa su conexión oficial.',
      );
    return server;
  }
  async disconnectOperations(): Promise<Array<Record<string, unknown>>> {
    const directory = join(this.directory, 'disconnect');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    return Promise.all(
      (await readdir(directory))
        .filter((file) => /^[a-f0-9-]{36}\.json$/.test(file))
        .map(async (file) => {
          const { record: entry, review } = await readReviewedReceipt(directory, file);
          return {
            ...entry,
            ...(review ? { review } : {}),
            status: entry.status === 'dispatching' ? 'review_required' : entry.status,
          };
        }),
    );
  }
  async checkDisconnect(open: AuthenticationOpener, operationId: string, signal: AbortSignal) {
    if (!/^[a-f0-9-]{36}$/.test(operationId)) throw new Error('La desconexión no existe.');
    const receipt = (await this.disconnectOperations()).find((r) => r.id === operationId);
    if (!receipt || typeof receipt.serverId !== 'string')
      throw new Error('La desconexión no existe.');
    if (receipt.status !== 'review_required' || this.serversInUse.has(receipt.serverId))
      return receipt;
    const server = (await this.describe(open, signal)).servers.find(
      (s) => s.id === receipt.serverId,
    );
    if (signal.aborted || server?.authStatus !== 'notLoggedIn') return receipt;
    receipt.status = 'signed_out';
    receipt.updatedAt = Date.now();
    receipt.reason =
      'Codex confirmó ahora que el servidor no tiene sesión OAuth local. No se repitió el cierre ni se acreditó revocación en el proveedor.';
    const file = join(this.directory, 'disconnect', operationId + '.json'),
      temp = file + '.' + randomUUID() + '.tmp';
    await writeFile(temp, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 });
    await rename(temp, file);
    return receipt;
  }
  async disconnect(
    open: AuthenticationOpener,
    serverId: string,
    taskId: string,
    signal: AbortSignal,
  ) {
    const server = await this.prepare(open, serverId, signal);
    if (server.authStatus !== 'oAuth')
      throw new Error('El servidor no tiene una sesión OAuth comprobada.');
    if (this.serversInUse.has(serverId))
      throw new Error('Este servidor ya tiene una autorización o desconexión en curso.');
    if (
      (await this.disconnectOperations()).some(
        (e) => e.serverId === serverId && e.status === 'review_required' && !e.review,
      )
    )
      throw new Error(
        'La desconexión anterior tiene un resultado incierto. Revisa su recibo y el estado oficial antes de otra operación.',
      );
    if (this.serversInUse.has(serverId))
      throw new Error('Este servidor ya tiene una autorización o desconexión en curso.');
    this.serversInUse.add(serverId);
    const receipt = {
      id: randomUUID(),
      taskId,
      serverId,
      service: server.name,
      status: 'prepared',
      updatedAt: Date.now(),
      reason:
        'Cerrar sesión OAuth guardada en Codex. No acredita revocación de permisos en el proveedor.',
    };
    const save = async () => {
      const directory = join(this.directory, 'disconnect');
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const file = join(directory, receipt.id + '.json'),
        temp = file + '.' + randomUUID() + '.tmp';
      receipt.updatedAt = Date.now();
      await writeFile(temp, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 });
      await rename(temp, file);
    };
    let client: AuthenticationClient | undefined;
    try {
      client = await open(signal);
      if (!client.logout) throw new Error('El ejecutor no admite el cierre de sesión MCP oficial.');
      if (signal.aborted) throw new Error('La desconexión se ha cancelado.');
      receipt.status = 'dispatching';
      await save();
      await client.logout(server.name);
      await client.close();
      client = undefined;
      const after = (await this.describe(open, signal)).servers.find((s) => s.id === serverId);
      if (signal.aborted || after?.authStatus !== 'notLoggedIn')
        throw new Error('unknown logout result');
      receipt.status = 'signed_out';
      receipt.reason =
        'Codex confirmó que el servidor ya no tiene sesión OAuth local. No acredita revocación en el proveedor ni detiene clientes externos ya conectados.';
      await save();
      return receipt;
    } catch {
      receipt.status = receipt.status === 'dispatching' ? 'review_required' : 'failed';
      receipt.reason =
        receipt.status === 'review_required'
          ? 'No se pudo confirmar el cierre de sesión. No se repetirá automáticamente; revisa el estado oficial.'
          : 'No se inició el cierre de sesión oficial.';
      await save();
      return receipt;
    } finally {
      this.serversInUse.delete(serverId);
      await client?.close().catch(() => {});
    }
  }
  async login(
    open: AuthenticationOpener,
    serverId: string,
    taskId: string,
    signal: AbortSignal,
    serviceLabel?: string,
  ) {
    const server = await this.prepare(open, serverId, signal);
    if (server.authStatus === 'oAuth')
      return {
        status: 'authenticated',
        service: serviceLabel ?? server.name,
        reason: 'Codex ya informa de OAuth configurado. Falta comprobar una operación.',
      };
    if (this.serversInUse.has(serverId))
      throw new Error(
        'Este servidor ya tiene una autorización en curso. Completa o cancela el intento actual.',
      );
    this.serversInUse.add(serverId);
    let client: AuthenticationClient;
    try {
      client = await open(signal);
    } catch (error) {
      this.serversInUse.delete(serverId);
      throw error;
    }
    const entry: OfficeAuthentication = {
      id: randomUUID(),
      taskId,
      service: serviceLabel ?? server.name,
      status: 'awaiting_user',
      reason:
        'Completa el inicio de sesión en la página oficial del proveedor. La oficina no solicita ni almacena tus credenciales.',
      expiresAt: Date.now() + this.timeoutMs,
    };
    const events: Record<string, unknown>[] = [];
    let loginId: string | undefined,
      finish: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const conclude = (status: OfficeAuthentication['status'], reason: string) => {
      if (!['awaiting_user', 'verifying'].includes(entry.status)) return;
      entry.status = status;
      entry.reason = reason;
      delete entry.authorizationUrl;
      finish();
      if (status === 'cancelled' || status === 'expired') void client.close().catch(() => {});
    };
    const receive = (method: string, p: Record<string, unknown>) => {
      if (method !== 'mcpServer/oauthLogin/completed' || p.name !== server.name) return;
      if (entry.status !== 'awaiting_user') return;
      if (!loginId) {
        events.push(p);
        return;
      }
      if (p.loginId !== loginId) return;
      conclude(
        p.success === true ? 'verifying' : 'failed',
        p.success === true
          ? 'Comprobando la autorización con Codex.'
          : 'El proveedor no confirmó la autorización. No se reintentará automáticamente.',
      );
    };
    const unsubscribe = client.onNotification(receive);
    const disconnect = client.onDisconnect(() => {
      if (signal.aborted)
        conclude('cancelled', 'Autorización cancelada. No se reanudará automáticamente.');
      else if (Date.now() >= entry.expiresAt)
        conclude(
          'expired',
          'La autorización ha caducado. Inicia un nuevo intento cuando quieras continuar.',
        );
      else
        conclude(
          'failed',
          'La conexión oficial se interrumpió. No se reintentará automáticamente.',
        );
    });
    const abort = () =>
      conclude('cancelled', 'Autorización cancelada. No se reanudará automáticamente.');
    const timer = setTimeout(
      () =>
        conclude(
          'expired',
          'La autorización ha caducado. Inicia un nuevo intento cuando quieras continuar.',
        ),
      this.timeoutMs,
    );
    this.entries.set(entry.id, entry);
    this.pending.set(entry.id, abort);
    signal.addEventListener('abort', abort, { once: true });
    try {
      await this.save(entry);
      if (signal.aborted) {
        abort();
      } else {
        const response = object(
          await client.request('mcpServer/oauth/login', {
            name: server.name,
            timeoutSecs: Math.ceil(this.timeoutMs / 1000),
          }),
        );
        if (typeof response.loginId !== 'string' || !response.loginId)
          throw new Error('La versión de Codex no permite correlacionar esta autorización.');
        loginId = response.loginId;
        if (entry.status === 'awaiting_user')
          entry.authorizationUrl = authorizationUrl(response.authorizationUrl);
        for (const event of events) receive('mcpServer/oauthLogin/completed', event);
      }
      await done;
      if (entry.status === 'verifying') {
        const current = (await this.servers(client)).find((e) => e.id === serverId);
        if (entry.status === 'verifying') {
          entry.status = current?.authStatus === 'oAuth' ? 'authenticated' : 'failed';
          entry.reason =
            current?.authStatus === 'oAuth'
              ? 'Codex confirmó OAuth configurado. Falta comprobar una operación.'
              : 'La notificación terminó, pero Codex no acredita OAuth configurado. Revisa la conexión antes de usarla.';
        }
      }
    } catch {
      if (entry.status === 'awaiting_user' || entry.status === 'verifying') {
        entry.status = 'failed';
        entry.reason =
          'No se pudo completar el flujo oficial. No se pedirán tokens ni se reintentará automáticamente.';
      }
    } finally {
      clearTimeout(timer);
      unsubscribe();
      disconnect();
      signal.removeEventListener('abort', abort);
      this.pending.delete(entry.id);
      this.serversInUse.delete(serverId);
      delete entry.authorizationUrl;
      await client.close().catch(() => {});
      await this.save(entry);
    }
    return { id: entry.id, service: entry.service, status: entry.status, reason: entry.reason };
  }
}
