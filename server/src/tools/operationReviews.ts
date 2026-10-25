import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { OfficeOperationReview } from '../../../core/src/officeTools.js';
import { object } from '../execution/subscriptionPolicy.js';
import { ExecutionBlocked } from '../execution/types.js';

const receiptFile = /^[a-f0-9-]{36}\.json$/;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const failureMessages: Record<string, string> = {
  app_server_disconnected: 'Se perdió la conexión con Codex antes de confirmar el resultado.',
  app_server_timeout: 'Codex no respondió dentro del plazo de la solicitud.',
  app_server_access_challenge: 'El servicio oficial exigió una comprobación de acceso.',
  app_server_rejected: 'Codex rechazó la solicitud; no se confirmó su resultado.',
  app_server_invalid_params: 'Codex rechazó los parámetros de la solicitud.',
  app_server_unsupported: 'El servicio oficial no admite esta operación.',
  app_server_auth_required: 'El servicio oficial requiere autenticación para esta operación.',
  app_server_access_denied: 'El servicio oficial denegó el acceso a esta operación.',
  app_server_not_found: 'El servicio oficial devolvió HTTP 404: no encontró el recurso solicitado.',
  app_server_rate_limited: 'El servicio oficial ha limitado temporalmente las solicitudes.',
  operation_unverified: 'No se pudo verificar el resultado de la operación.',
};
type Outcome = 'completed' | 'not_completed';
export interface OperationOwner {
  taskId?: string;
  conversationId?: string;
}
interface Review {
  outcome: Outcome;
  reviewedAt: string;
}

/** Reviews bind exact receipt bytes. A receipt change invalidates an earlier acknowledgement. */
export async function readReviewedReceipt(directory: string, file: string) {
  if (!receiptFile.test(file)) throw new Error('El recibo no es válido.');
  const raw = await readFile(join(directory, file), 'utf8'),
    digest = hash(raw);
  const record = object(JSON.parse(raw));
  if (record.id + '.json' !== file)
    throw new Error('El recibo necesita revisión de su identificador.');
  // Never accept a review claimed by the original operation or remote result.
  delete record.review;
  let review: Review | undefined;
  try {
    const saved = object(
      JSON.parse(
        await readFile(join(directory, '.reviews', file + '.' + digest + '.json'), 'utf8'),
      ),
    );
    if (
      saved.receiptHash === digest &&
      ['completed', 'not_completed'].includes(String(saved.outcome)) &&
      typeof saved.reviewedAt === 'string' &&
      Number.isFinite(Date.parse(saved.reviewedAt))
    )
      review = { outcome: saved.outcome as Outcome, reviewedAt: saved.reviewedAt };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return { record, receiptHash: digest, review };
}

async function files(directory: string) {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((e) => e.isFile() && receiptFile.test(e.name))
      .map((e) => e.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/** Only fixed office-owned directories are indexed; the browser never supplies paths. */
export class OperationReviewRegistry {
  private reviewing = new Set<string>();
  constructor(private directory: string) {}
  private async entries() {
    const sources: Array<{
      kind: OfficeOperationReview['kind'];
      scope: string;
      directory: string;
    }> = [
      { kind: 'plugin', scope: 'plugins', directory: join(this.directory, 'plugin-operations') },
      {
        kind: 'mcp_registration',
        scope: 'mcp-registration',
        directory: join(this.directory, 'mcp-registrations'),
      },
      {
        kind: 'plugin_mcp',
        scope: 'plugin-mcp',
        directory: join(this.directory, 'plugin-operations', 'mcp-operations'),
      },
      {
        kind: 'authentication',
        scope: 'logout',
        directory: join(this.directory, 'authentication-history', 'disconnect'),
      },
    ];
    const integrations = join(this.directory, 'integration-operations');
    try {
      for (const entry of await readdir(integrations, { withFileTypes: true }))
        if (entry.isDirectory() && /^[a-zA-Z0-9_-]{1,100}$/.test(entry.name))
          sources.push({
            kind: 'integration',
            scope: entry.name,
            directory: join(integrations, entry.name),
          });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const entries = [];
    for (const source of sources)
      for (const file of await files(source.directory)) {
        const receipt = await readReviewedReceipt(source.directory, file),
          r = receipt.record;
        if (!['review_required', 'dispatching'].includes(String(r.status))) continue;
        const preview = object(r.preview),
          plugin = object(preview.plugin);
        const value = typeof r.updatedAt === 'number' ? r.updatedAt : undefined;
        const pluginDescription =
          source.kind === 'plugin'
            ? [
                typeof plugin.name === 'string' ? plugin.name : 'Plugin',
                typeof plugin.version === 'string' ? `versión ${plugin.version}` : undefined,
                typeof plugin.marketplace === 'string' ? `origen ${plugin.marketplace}` : undefined,
              ]
                .filter(Boolean)
                .join(' · ')
            : undefined;
        const diagnostic =
          typeof r.failureCode === 'string' && Object.hasOwn(failureMessages, r.failureCode)
            ? failureMessages[r.failureCode]
            : undefined;
        const publicEntry: OfficeOperationReview = {
          id: hash(JSON.stringify([source.kind, source.scope, file, receipt.receiptHash])),
          kind: source.kind,
          receiptId: String(r.id),
          ...(typeof r.taskId === 'string'
            ? { taskId: r.taskId }
            : source.kind === 'integration'
              ? { taskId: source.scope }
              : {}),
          ...(typeof r.conversationId === 'string' ? { conversationId: r.conversationId } : {}),
          ...(typeof r.description === 'string'
            ? { description: r.description }
            : pluginDescription
              ? { description: pluginDescription }
              : {}),
          ...(diagnostic ? { diagnostic } : {}),
          ...(r.failureStage === 'request' || r.failureStage === 'verification'
            ? { failureStage: r.failureStage }
            : {}),
          action:
            source.kind === 'plugin'
              ? r.operation === 'install'
                ? 'Instalar plugin'
                : r.operation === 'uninstall'
                  ? 'Retirar plugin'
                  : 'Operación de plugin sin detalle registrado'
              : source.kind === 'mcp_registration'
                ? 'Registrar conexión en Codex'
                : source.kind === 'authentication'
                  ? 'Cerrar sesión OAuth local'
                  : typeof r.tool === 'string'
                    ? r.tool
                    : 'Operación de herramienta',
          destination:
            source.kind === 'plugin'
              ? String(plugin.name ?? 'Plugin')
              : String(r.service ?? r.plugin ?? r.tool ?? 'Integración oficial'),
          occurredAt:
            value !== undefined && Number.isFinite(value) && Math.abs(value) <= 8640000000000000
              ? new Date(value).toISOString()
              : null,
          reference: typeof r.argumentsHash === 'string' ? r.argumentsHash : receipt.receiptHash,
          status: receipt.review ? 'reviewed' : 'pending',
          originalStatus: String(r.status),
          ...(receipt.review ? { review: receipt.review } : {}),
        };
        entries.push({ publicEntry, source, file, receipt });
      }
    return entries;
  }
  async list() {
    return (await this.entries())
      .map((e) => e.publicEntry)
      .sort((a, b) => (b.occurredAt ?? '').localeCompare(a.occurredAt ?? ''));
  }
  async acknowledge(id: string, outcome: Outcome) {
    if (!['completed', 'not_completed'].includes(outcome))
      throw new Error('Elige el resultado que has comprobado.');
    if (this.reviewing.has(id))
      throw new ExecutionBlocked(
        'operation_review_pending',
        'Esta revisión ya se está guardando. Espera su resultado.',
      );
    this.reviewing.add(id);
    try {
      const entry = (await this.entries()).find((e) => e.publicEntry.id === id);
      if (!entry || entry.receipt.review)
        throw new ExecutionBlocked(
          'operation_receipt_changed',
          'El recibo cambió o ya fue revisado. Actualiza la lista.',
        );
      const review = {
        receiptHash: entry.receipt.receiptHash,
        outcome,
        reviewedAt: new Date().toISOString(),
      };
      const directory = join(entry.source.directory, '.reviews'),
        file = join(directory, entry.file + '.' + review.receiptHash + '.json'),
        temporary = file + '.' + randomUUID() + '.tmp';
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(temporary, JSON.stringify(review), { flag: 'wx', mode: 0o600 });
      try {
        // Publish complete bytes without replacing an existing human decision.
        await link(temporary, file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST')
          throw new ExecutionBlocked(
            'operation_receipt_changed',
            'Esta revisión ya fue registrada. Actualiza la lista.',
          );
        throw error;
      } finally {
        await unlink(temporary);
      }
      if (
        (await readReviewedReceipt(entry.source.directory, entry.file)).receiptHash !==
        review.receiptHash
      )
        throw new ExecutionBlocked(
          'operation_receipt_changed',
          'El recibo cambió durante la revisión. Comprueba su estado actual.',
        );
      return { id, reviewed: true, outcome };
    } finally {
      this.reviewing.delete(id);
    }
  }
}
