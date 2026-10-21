/** A successful CLI turn is not proof that the assigned work was completed. */
export const TASK_OUTCOME_INSTRUCTION =
  '\n\nAl terminar, comunica el resultado del encargo con honestidad. Si los permisos o el entorno impiden cumplirlo, indica blocked; si las pruebas fallan o el trabajo falla, indica failed. Usa completed solo cuando hayas realizado lo solicitado. No inventes archivos ni pruebas. Termina tu respuesta con una línea exacta, sin bloques de código: OFFICE_RESULT {"status":"completed"} (o blocked / failed). Esta declaración no sustituye la verificación independiente del trabajo.';

export type TaskOutcome = 'completed' | 'blocked' | 'failed';

/** Read only the final line, so quoted examples and earlier progress cannot approve work. */
export function parseTaskOutcome(tail: string): TaskOutcome | null {
  const last = tail.trimEnd().split(/\r?\n/).at(-1);
  if (!last?.startsWith('OFFICE_RESULT ')) return null;
  try {
    const value: unknown = JSON.parse(last.slice('OFFICE_RESULT '.length));
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length !== 1 ||
      !('status' in value)
    )
      return null;
    return ['completed', 'blocked', 'failed'].includes(String(value.status)) &&
      typeof value.status === 'string'
      ? (value.status as TaskOutcome)
      : null;
  } catch {
    return null;
  }
}
