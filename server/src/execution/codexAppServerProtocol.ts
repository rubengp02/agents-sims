import { type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

import { stopProcess } from './cliProcess.js';
import { object } from './subscriptionPolicy.js';
import { ExecutionBlocked } from './types.js';

export interface AppServerProtocol {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
  notify(method: string, params?: Record<string, unknown>): void;
  onNotification(listener: (method: string, params: Record<string, unknown>) => void): () => void;
  onRequest(listener: (method: string, params: Record<string, unknown>) => Promise<unknown>): void;
  onDisconnect(listener: () => void): () => void;
  close(): Promise<void>;
}

/** Only fixed categories escape the transport; never retain provider payloads. */
function protocolRejection(value: unknown): ExecutionBlocked {
  const error = object(value),
    message = String(error.message ?? ''),
    httpStatus =
      message.match(
        /\b(?:HTTP(?:\/[\d.]+)?(?: status)?|status(?: code)?)\s*[:=]?\s*(401|403|404|429)\b/i,
      )?.[1] ??
      message.match(
        /\b(401|403|404|429)\s+(?:Unauthorized|Forbidden|Not Found|Too Many Requests)\b/i,
      )?.[1];
  if (/403/.test(message) && /cloudflare|cdn-cgi|challenge-platform/i.test(message))
    return new ExecutionBlocked(
      'app_server_access_challenge',
      'El servicio oficial devolvió 403 con una comprobación de acceso. No se ha verificado la conexión; no implica que falte instalar o autenticar el plugin.',
    );
  if (error.code === -32602)
    return new ExecutionBlocked(
      'app_server_invalid_params',
      'Codex rechazó los parámetros de la solicitud.',
    );
  if (error.code === -32601 || /not supported|unsupported|not implemented/i.test(message))
    return new ExecutionBlocked(
      'app_server_unsupported',
      'El servicio oficial no admite esta operación.',
    );
  if (
    httpStatus === '401' ||
    /authentication required|not authenticated|unauthorized/i.test(message)
  )
    return new ExecutionBlocked(
      'app_server_auth_required',
      'El servicio oficial requiere autenticación para esta operación.',
    );
  if (httpStatus === '403' || /permission denied|access denied|forbidden/i.test(message))
    return new ExecutionBlocked(
      'app_server_access_denied',
      'El servicio oficial denegó el acceso a esta operación.',
    );
  if (httpStatus === '404')
    return new ExecutionBlocked(
      'app_server_not_found',
      'El servicio oficial devolvió HTTP 404: no encontró el recurso solicitado.',
    );
  if (httpStatus === '429')
    return new ExecutionBlocked(
      'app_server_rate_limited',
      'El servicio oficial ha limitado temporalmente las solicitudes.',
    );
  return new ExecutionBlocked(
    'app_server_rejected',
    'Codex ha rechazado una operación del protocolo.',
  );
}

/** Owned stdio process. Raw errors, stderr and authentication payloads never escape. */
export class CodexAppServerProtocol implements AppServerProtocol {
  private sequence = 0;
  private closed = false;
  private readonly notifications = new Set<
    (method: string, params: Record<string, unknown>) => void
  >();
  private readonly disconnects = new Set<() => void>();
  private serverRequest?: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer?: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly requestTimeoutMs = 30_000,
    private readonly catalogueTimeoutMs = 120_000,
  ) {
    const reader = createInterface({ input: child.stdout });
    reader.on('line', (line) => {
      if (this.closed) return;
      if (Buffer.byteLength(line) > 20_000_000) return this.fail();
      let message: Record<string, unknown>;
      try {
        message = object(JSON.parse(line));
      } catch {
        return this.fail();
      }
      if (typeof message.method === 'string') {
        const method = message.method;
        const params = object(message.params);
        if (typeof message.id === 'number' || typeof message.id === 'string') {
          const id = message.id;
          void Promise.resolve()
            .then(() => {
              if (!this.serverRequest) throw new Error('unsupported');
              return this.serverRequest(method, params);
            })
            .then((result) => this.write({ id, result }))
            .catch(() => {
              this.write({
                id,
                error: { code: -32603, message: 'Solicitud no autorizada por la oficina.' },
              });
            });
        } else {
          for (const listener of this.notifications) listener(method, params);
        }
        return;
      }
      if (typeof message.id !== 'number') return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(protocolRejection(message.error));
      else pending.resolve(message.result);
    });
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => this.fail());
    child.on('error', () => this.fail());
    child.on('close', () => this.fail());
  }

  private write(message: unknown): void {
    if (!this.closed) this.child.stdin.write(JSON.stringify(message) + '\n');
  }

  request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (this.closed)
      return Promise.reject(
        new ExecutionBlocked('app_server_disconnected', 'La conexión con Codex está cerrada.'),
      );
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      // Native tools and package operations own their execution deadline.
      // Closing this client still cancels pending calls without replaying them.
      const longRunning = ['plugin/install', 'plugin/uninstall', 'mcpServer/tool/call'].includes(
        method,
      );
      const timer = longRunning
        ? undefined
        : setTimeout(
            () => {
              this.pending.delete(id);
              reject(
                new ExecutionBlocked(
                  'app_server_timeout',
                  'Codex no ha respondido a una operación del protocolo.',
                ),
              );
            },
            method === 'plugin/list' ? this.catalogueTimeoutMs : this.requestTimeoutMs,
          );
      this.pending.set(id, { resolve, reject, timer });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params?: Record<string, unknown>): void {
    this.write({ method, params });
  }
  onNotification(listener: (method: string, params: Record<string, unknown>) => void): () => void {
    this.notifications.add(listener);
    return () => {
      this.notifications.delete(listener);
    };
  }
  onRequest(listener: (method: string, params: Record<string, unknown>) => Promise<unknown>): void {
    this.serverRequest = listener;
  }
  onDisconnect(listener: () => void): () => void {
    this.disconnects.add(listener);
    return () => {
      this.disconnects.delete(listener);
    };
  }
  private fail(): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(
        new ExecutionBlocked('app_server_disconnected', 'Se ha perdido la conexión con Codex.'),
      );
    }
    this.pending.clear();
    for (const listener of this.disconnects) listener();
  }
  async close(): Promise<void> {
    this.fail();
    await stopProcess(this.child);
  }
}
