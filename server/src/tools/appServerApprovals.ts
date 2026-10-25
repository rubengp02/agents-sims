import type { AppServerApprovalRequest } from '../execution/codexAppServerExecutor.js';
import { object } from '../execution/subscriptionPolicy.js';
import type { OfficeServices } from './officeServices.js';
import { toolPreview } from './toolPreview.js';

export function approvalPreview(value: unknown): unknown {
  const redacted = toolPreview(value);
  if (JSON.stringify(redacted).length > 128000)
    throw new Error('La operación requiere dividir sus datos para poder revisarla completa.');
  return redacted;
}

/** Every grant is one operation, never a persistent policy or a whole session. */
export function approvalResponse(
  method: string,
  params: Record<string, unknown>,
  approved: boolean,
): unknown {
  if (
    method === 'item/commandExecution/requestApproval' ||
    method === 'item/fileChange/requestApproval'
  )
    return { decision: approved ? 'accept' : 'decline' };
  if (method === 'item/permissions/requestApproval') return { permissions: {}, scope: 'turn' };
  if (method === 'mcpServer/elicitation/request') {
    const schema = object(params.requestedSchema);
    const required = Array.isArray(schema.required) ? schema.required : [];
    return {
      action: approved && required.length === 0 ? 'accept' : 'decline',
      content: approved && required.length === 0 ? {} : null,
    };
  }
  if (method === 'item/tool/requestUserInput') {
    const answers: Record<string, { answers: string[] }> = {};
    for (const raw of Array.isArray(params.questions) ? params.questions : []) {
      const question = object(raw);
      if (
        /always|future|all\s+operations|entire\s+session|siempre|futur[ao]|todas\s+las\s+operaciones|toda\s+la\s+sesión/i.test(
          `${String(question.question ?? '')} ${String(question.header ?? '')}`,
        )
      )
        continue;
      const options = Array.isArray(question.options) ? question.options.map(object) : [];
      const option = options.find(
        (o) =>
          typeof o.label === 'string' &&
          (approved
            ? /^(accept|approve|allow|yes|allow once|approve once|allow this time|permitir|aceptar|autorizar|sí|permitir una vez|autorizar una vez)$/i
            : /^(decline|deny|reject|no|rechazar|cancel|cancelar)$/i
          ).test(o.label.trim()),
      );
      if (option && typeof question.id === 'string')
        answers[question.id] = { answers: [String(option.label)] };
    }
    return { answers };
  }
  return { decision: 'decline' };
}

export function officeApprovalHandler(services: OfficeServices) {
  return {
    request: async ({ taskId, method, params, signal }: AppServerApprovalRequest) => {
      if (method === 'item/permissions/requestApproval')
        return approvalResponse(method, params, false);
      if (method === 'mcpServer/elicitation/request' && params.requestedSchema) {
        const schema = object(params.requestedSchema);
        const required = Array.isArray(schema.required) ? schema.required : [];
        const fields = Object.entries(object(schema.properties)).map(([name, raw]) => {
          const prop = object(raw),
            type = prop.type;
          if (
            !['string', 'number', 'boolean'].includes(String(type)) ||
            /password|token|secret|credential|api.?key|contraseñ/i.test(
              `${name} ${prop.title ?? ''}`,
            )
          )
            throw new Error(
              'Este formulario requiere una conexión oficial o un tipo de dato no compatible.',
            );
          return {
            name,
            label: typeof prop.title === 'string' ? prop.title : name,
            type: type as 'string' | 'number' | 'boolean',
            required: required.includes(name),
            ...(Array.isArray(prop.enum) && prop.enum.every((v) => typeof v === 'string')
              ? { options: prop.enum as string[] }
              : {}),
          };
        });
        if (fields.length) {
          const answer = await services.runtime.approvals.requestFields({
            taskId,
            tool: method,
            destination: String(params.serverName ?? 'Aplicación conectada'),
            content: String(params.message ?? 'Completa los datos de esta operación.'),
            args: params,
            fields,
            signal,
          });
          return {
            action: answer.approved ? 'accept' : 'decline',
            content: answer.approved ? (answer.values ?? {}) : null,
          };
        }
      }
      const approved = await services.runtime.approvals.request({
        taskId,
        tool: method,
        destination:
          typeof params.serverName === 'string' ? params.serverName : 'Herramienta de Codex',
        content: JSON.stringify(approvalPreview(params), null, 2),
        args: params,
        signal,
      });
      return approvalResponse(method, params, approved);
    },
  };
}
