import { createHash, randomUUID } from 'node:crypto';

import type {
  OfficeToolApproval,
  OfficeToolApprovalField,
  OfficeToolApprovalValues,
} from '../../../core/src/officeTools.js';

interface ApprovalResponse {
  approved: boolean;
  approvalId?: string;
  fingerprint?: string;
  resolvedAt?: number;
  values?: OfficeToolApprovalValues;
}
type ApprovalInput = Omit<OfficeToolApproval, 'id' | 'createdAt'> & {
  args: unknown;
  signal?: AbortSignal;
};

interface Pending {
  public: OfficeToolApproval;
  fingerprint: string;
  finish: (response: ApprovalResponse) => void;
}
const sensitiveField = (value: string) =>
  /password|contrase[ñn]a|passphrase|secret|secreto|credential|credencial|api[ _-]?key|clave[ _-]?(api|privada)|access[ _-]?token|refresh[ _-]?token|authorization|bearer/i.test(
    value,
  );
function validateFields(fields: OfficeToolApprovalField[]): OfficeToolApprovalField[] {
  if (!Array.isArray(fields) || !fields.length || fields.length > 20)
    throw new Error('El formulario necesita entre uno y veinte campos simples.');
  const names = new Set<string>();
  return fields.map((field) => {
    if (
      !field ||
      typeof field.name !== 'string' ||
      !/^[\p{L}\p{N}_. -]{1,80}$/u.test(field.name) ||
      ['__proto__', 'constructor', 'prototype'].includes(field.name) ||
      names.has(field.name) ||
      typeof field.label !== 'string' ||
      !field.label.trim() ||
      field.label.length > 160 ||
      sensitiveField(`${field.name} ${field.label}`) ||
      !['string', 'number', 'boolean'].includes(field.type) ||
      typeof field.required !== 'boolean' ||
      (field.options !== undefined &&
        (field.type !== 'string' ||
          !Array.isArray(field.options) ||
          !field.options.length ||
          field.options.length > 100 ||
          field.options.some((option) => typeof option !== 'string' || option.length > 1000) ||
          new Set(field.options).size !== field.options.length))
    )
      throw new Error(
        'El formulario no es compatible o solicita credenciales. Usa la conexión oficial del servicio.',
      );
    names.add(field.name);
    return {
      name: field.name,
      label: field.label,
      type: field.type,
      required: field.required,
      ...(field.options ? { options: [...field.options] } : {}),
    };
  });
}
function validateValues(
  fields: OfficeToolApprovalField[],
  value: unknown,
): OfficeToolApprovalValues {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Completa los campos de la solicitud.');
  const raw = value as Record<string, unknown>,
    values: OfficeToolApprovalValues = Object.create(null);
  if (Object.keys(raw).some((key) => !fields.some((field) => field.name === key)))
    throw new Error('El formulario contiene campos no autorizados.');
  for (const field of fields) {
    const item = Object.hasOwn(raw, field.name) ? raw[field.name] : undefined;
    if (item === undefined) {
      if (field.required) throw new Error('Falta un campo obligatorio.');
      continue;
    }
    if (
      typeof item !== field.type ||
      (typeof item === 'number' && !Number.isFinite(item)) ||
      (typeof item === 'string' &&
        (item.length > 4000 ||
          (field.required && !item.trim()) ||
          (field.options && !field.options.includes(item))))
    )
      throw new Error('Revisa los valores del formulario.');
    values[field.name] = item as string | number | boolean;
  }
  return values;
}
/** Approvals exist only in memory: restarting cannot replay an external operation. */
export class ToolApprovalStore {
  private pending = new Map<string, Pending>();
  list(): OfficeToolApproval[] {
    return [...this.pending.values()].map((p) => ({
      ...p.public,
      ...(p.public.fields
        ? {
            fields: p.public.fields.map((field) => ({
              ...field,
              ...(field.options ? { options: [...field.options] } : {}),
            })),
          }
        : {}),
    }));
  }
  request(input: ApprovalInput): Promise<boolean> {
    if (input.fields?.length)
      return Promise.reject(new Error('Usa el formulario para responder a esta solicitud.'));
    return this.create(input).then((response) => response.approved);
  }
  requestOperation(input: ApprovalInput): Promise<ApprovalResponse> {
    if (input.fields?.length)
      return Promise.reject(new Error('Usa el formulario para responder a esta solicitud.'));
    return this.create(input);
  }
  async requestFields(
    input: ApprovalInput & { fields: OfficeToolApprovalField[] },
  ): Promise<ApprovalResponse> {
    const fields = validateFields(input.fields);
    return this.create({ ...input, fields }).then(({ approved, values }) => ({
      approved,
      ...(values ? { values } : {}),
    }));
  }
  private create(input: ApprovalInput): Promise<ApprovalResponse> {
    if (input.signal?.aborted) return Promise.resolve({ approved: false });
    const id = randomUUID();
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([input.tool, input.destination, input.content, input.args, input.fields]),
      )
      .digest('hex');
    return new Promise((resolve) => {
      const abort = () => finish({ approved: false });
      const finish = (response: ApprovalResponse) => {
        if (!this.pending.delete(id)) return;
        input.signal?.removeEventListener('abort', abort);
        resolve({ ...response, approvalId: id, fingerprint, resolvedAt: Date.now() });
      };
      this.pending.set(id, {
        public: {
          id,
          taskId: input.taskId,
          tool: input.tool,
          destination: input.destination,
          content: input.content,
          createdAt: new Date().toISOString(),
          ...(input.fields ? { fields: input.fields } : {}),
        },
        fingerprint,
        finish,
      });
      input.signal?.addEventListener('abort', abort, { once: true });
    });
  }
  resolve(id: string, approved: boolean, rawValues?: unknown): boolean {
    const pending = this.pending.get(id);
    if (!pending) return false;
    const values =
      approved && pending.public.fields
        ? validateValues(pending.public.fields, rawValues)
        : undefined;
    if (approved && !pending.public.fields && rawValues !== undefined)
      throw new Error('Esta confirmación no admite campos adicionales.');
    pending.finish({ approved, ...(values ? { values } : {}) });
    return true;
  }
  cancelTask(taskId: string): void {
    for (const entry of [...this.pending.values()])
      if (entry.public.taskId === taskId) entry.finish({ approved: false });
  }
  close(): void {
    for (const entry of [...this.pending.values()]) entry.finish({ approved: false });
  }
}
