import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { join } from 'node:path';

import { object } from '../execution/subscriptionPolicy.js';
import { type OperationOwner, readReviewedReceipt } from './operationReviews.js';
import { publicAddress } from './publicMcpFetch.js';

export interface ManagedMcpTarget {
  name: string;
  url: string;
}
export interface ManagedMcpState {
  exists: boolean;
  matches: boolean;
  file: string;
  version: string;
}
export interface ManagedMcpRegistrationClient {
  inspect(target: ManagedMcpTarget): Promise<ManagedMcpState>;
  register(target: ManagedMcpTarget, expected: ManagedMcpState): Promise<void>;
  close(): Promise<void>;
}
export type ManagedMcpRegistrationOpener = (
  signal: AbortSignal,
) => Promise<ManagedMcpRegistrationClient>;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function managedMcpTarget(raw: string): ManagedMcpTarget {
  const url = new URL(raw),
    host = url.hostname
      .replace(/^\[|\]$/g, '')
      .replace(/\.$/, '')
      .toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && url.port !== '443') ||
    (!host.includes('.') && isIP(host) === 0) ||
    (isIP(host) !== 0 && !publicAddress(host)) ||
    host === 'localhost' ||
    host.endsWith('.localhost')
  )
    throw new Error(
      'La conexión oficial necesita HTTPS público sin credenciales, parámetros ni puertos especiales.',
    );
  return { name: 'office-managed-' + hash(url.href).slice(0, 24), url: url.href };
}
interface Registration {
  id: string;
  connectionId: string;
  service: string;
  target: ManagedMcpTarget;
  expected: ManagedMcpState;
  taskId?: string;
  conversationId?: string;
  status: 'prepared' | 'dispatching' | 'registered' | 'review_required';
  updatedAt: number;
  reason?: string;
}
/** Registers public connection data through Codex. It never handles provider credentials or signs in. */
export class OfficialMcpRegistration {
  private busy = false;
  constructor(
    private directory: string,
    private open: ManagedMcpRegistrationOpener,
    private owner?: OperationOwner,
  ) {}
  private async save(record: Registration) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = join(this.directory, record.id + '.json'),
      temporary = file + '.' + randomUUID() + '.tmp';
    record.updatedAt = Date.now();
    await writeFile(temporary, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  }
  async operations(): Promise<Array<Record<string, unknown>>> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    return Promise.all(
      (await readdir(this.directory))
        .filter((f) => /^[a-f0-9-]{36}\.json$/.test(f))
        .map(async (file) => {
          const { record, review } = await readReviewedReceipt(this.directory, file);
          return {
            id: record.id,
            connectionId: record.connectionId,
            service: record.service,
            target: record.target,
            status: record.status === 'dispatching' ? 'review_required' : record.status,
            reason: record.reason,
            ...(review ? { review } : {}),
          };
        }),
    );
  }
  async prepare(connection: { id: string; name: string; url: string }, signal: AbortSignal) {
    const target = managedMcpTarget(connection.url);
    if (
      (await this.operations()).some(
        (r) => r.connectionId === connection.id && r.status === 'review_required' && !r.review,
      )
    )
      throw new Error(
        'El registro anterior tiene resultado incierto. Revisa su recibo antes de otra operación.',
      );
    const client = await this.open(signal);
    try {
      const expected = await client.inspect(target);
      if (signal.aborted) throw new Error('El registro de la conexión se ha cancelado.');
      if (expected.exists && !expected.matches)
        throw new Error('El nombre de conexión ya tiene otra configuración. No se sobrescribirá.');
      const record: Registration = {
        id: randomUUID(),
        connectionId: connection.id,
        service: connection.name,
        target,
        expected,
        taskId: this.owner?.taskId,
        conversationId: this.owner?.conversationId,
        status: expected.matches ? 'registered' : 'prepared',
        updatedAt: Date.now(),
      };
      if (expected.matches)
        record.reason =
          'Codex ya tiene esta dirección registrada. Falta comprobar autenticación y herramientas.';
      await this.save(record);
      return {
        id: record.id,
        alreadyRegistered: expected.matches,
        preview: {
          operation: 'Registrar conexión HTTP en Codex',
          service: connection.name,
          url: target.url,
          serverName: target.name,
          scope:
            'Guarda sólo la dirección pública en la configuración de usuario compartida de Codex. No inicia sesión, no copia credenciales ni autoriza herramientas. No sobrescribe otro servidor. Falta autenticar y comprobar una operación.',
        },
      };
    } finally {
      await client.close();
    }
  }
  async apply(id: string, signal: AbortSignal) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('La propuesta de conexión no es válida.');
    if (this.busy) throw new Error('Ya hay un registro oficial en curso.');
    this.busy = true;
    let client: ManagedMcpRegistrationClient | undefined;
    try {
      const record = object(
        JSON.parse(await readFile(join(this.directory, id + '.json'), 'utf8')),
      ) as unknown as Registration;
      if (record.id !== id || record.status !== 'prepared')
        throw new Error('La propuesta ya terminó o necesita revisión. Prepara otra.');
      if (hash(managedMcpTarget(record.target.url)) !== hash(record.target))
        throw new Error('El destino guardado no es válido.');
      client = await this.open(signal);
      const current = await client.inspect(record.target);
      if (hash(current) !== hash(record.expected))
        throw new Error(
          'La configuración de Codex cambió desde la propuesta. Prepara otra antes de registrar.',
        );
      if (signal.aborted) throw new Error('El registro de la conexión se ha cancelado.');
      record.status = 'dispatching';
      await this.save(record);
      try {
        await client.register(record.target, current);
        await client.close();
        client = undefined;
        client = await this.open(signal);
        const after = await client.inspect(record.target);
        if (signal.aborted || !after.matches) throw new Error('unverified registration');
        record.status = 'registered';
        record.reason =
          'Dirección confirmada en un cliente nuevo de Codex. Falta autenticar y comprobar herramientas.';
        await this.save(record);
        return {
          operationId: id,
          status: record.status,
          serverName: record.target.name,
          reason: record.reason,
        };
      } catch {
        record.status = 'review_required';
        record.reason =
          'No se pudo confirmar el registro oficial. No se repetirá automáticamente; comprueba la configuración antes de continuar.';
        await this.save(record);
        throw new Error(record.reason);
      }
    } finally {
      this.busy = false;
      await client?.close().catch(() => {});
    }
  }
}
