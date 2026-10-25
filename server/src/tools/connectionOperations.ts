import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { object } from '../execution/subscriptionPolicy.js';

const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)]),
        )
      : value;
const hash = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
export interface ConnectionOperationOwner {
  taskId?: string;
  conversationId?: string;
  approval?: { id: string; fingerprint: string; approvedAt: number };
}
interface Receipt extends ConnectionOperationOwner {
  id: string;
  connectionId: string;
  tool: string;
  argumentsHash: string;
  toolDefinitionHash: string;
  resultHash?: string;
  status: 'dispatching' | 'completed' | 'failed' | 'review_required' | 'not_sent';
  createdAt: number;
  updatedAt: number;
}
/** Hashes and operation metadata only: never persist arguments, responses or credentials. */
export class ConnectionOperations {
  private recordingStartedAt = 0;
  constructor(private directory: string) {}
  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = join(this.directory, 'coverage.json');
    try {
      await writeFile(file, JSON.stringify({ recordingStartedAt: Date.now() }), {
        flag: 'wx',
        mode: 0o600,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    this.recordingStartedAt = object(JSON.parse(await readFile(file, 'utf8')))
      .recordingStartedAt as number;
    if (!Number.isFinite(this.recordingStartedAt))
      throw new Error('El registro de operaciones necesita revisión.');
  }
  private async save(receipt: Receipt) {
    receipt.updatedAt = Date.now();
    const file = join(this.directory, receipt.id + '.json'),
      temp = file + '.' + randomUUID() + '.tmp';
    await writeFile(temp, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 });
    await rename(temp, file);
  }
  async start(
    connectionId: string,
    tool: string,
    args: unknown,
    definition: unknown,
    owner: ConnectionOperationOwner,
  ) {
    const receipt: Receipt = {
      ...owner,
      id: randomUUID(),
      connectionId,
      tool,
      argumentsHash: hash(args),
      toolDefinitionHash: hash(definition),
      status: 'dispatching',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await this.save(receipt);
    return receipt;
  }
  async finish(receipt: Receipt, status: Receipt['status'], response?: unknown) {
    receipt.status = status;
    if (response !== undefined) receipt.resultHash = hash(response);
    await this.save(receipt);
  }
  async list(connectionId?: string) {
    const operations = [];
    for (const file of await readdir(this.directory)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(file)) continue;
      const raw = await readFile(join(this.directory, file), 'utf8');
      const receipt = JSON.parse(raw) as Receipt;
      // A receipt or provider result cannot declare its own human acknowledgement.
      delete (receipt as Receipt & { review?: unknown }).review;
      if (receipt.id + '.json' !== file)
        throw new Error('El recibo de la conexión necesita revisión.');
      if (connectionId && receipt.connectionId !== connectionId) continue;
      let acknowledgedAt: number | undefined;
      try {
        const acknowledgement = object(
          JSON.parse(await readFile(join(this.directory, `${file}.${hash(raw)}.review`), 'utf8')),
        );
        if (typeof acknowledgement.acknowledgedAt === 'number')
          acknowledgedAt = acknowledgement.acknowledgedAt;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      operations.push({
        ...receipt,
        ...(acknowledgedAt
          ? { review: { acknowledgedAt, outcome: 'not_determined' as const } }
          : {}),
      });
    }
    return {
      recordingStartedAt: this.recordingStartedAt,
      historicalCoverage:
        'Solo estos recibos; no acredita operaciones anteriores al inicio del registro.',
      operations: operations.sort((a, b) => a.createdAt - b.createdAt),
    };
  }
  async acknowledge(connectionId: string) {
    for (const receipt of (await this.list(connectionId)).operations) {
      if (!['dispatching', 'review_required'].includes(receipt.status) || receipt.review) continue;
      const file = receipt.id + '.json',
        raw = await readFile(join(this.directory, file), 'utf8');
      await writeFile(
        join(this.directory, `${file}.${hash(raw)}.review`),
        JSON.stringify({ acknowledgedAt: Date.now() }),
        { flag: 'wx', mode: 0o600 },
      );
    }
  }
}
