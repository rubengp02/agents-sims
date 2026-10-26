import type { ConversationMessage } from '../../../core/src/conversations.js';
import type { TeamTask } from '../../../core/src/team.js';

const officeCompletionEnding =
  'La oficina ha terminado el objetivo con revisión del Tester. La aprobación final del resultado corresponde a la persona.';
export function isOfficeFinalDelivery(message: ConversationMessage, tasks: TeamTask[]) {
  return (
    message.kind === 'response' &&
    message.role === 'chief' &&
    message.status === 'completed' &&
    message.origin !== 'internal' &&
    !message.officeAssignment &&
    !tasks.some((task) => task.id === message.taskId && task.officeParentId) &&
    (tasks.some((task) => task.id === message.taskId && !!task.office) ||
      message.content.trim().endsWith(officeCompletionEnding))
  );
}

/** Root output is updated in place; display its final delivery after that objective's activity. */
export function conversationDisplayMessages(messages: ConversationMessage[], tasks: TeamTask[]) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const internal = (message: ConversationMessage) =>
    message.origin === 'internal' ||
    !!message.officeAssignment ||
    !!byId.get(message.taskId)?.officeParentId;
  const moved = new Set<string>();
  const after = new Map<number, ConversationMessage[]>();
  messages.forEach((message, index) => {
    if (!isOfficeFinalDelivery(message, tasks)) return;
    let end = index;
    for (let next = index + 1; next < messages.length; next++) {
      const following = messages[next];
      if (!internal(following)) {
        if (following.taskId !== message.taskId) break;
        continue;
      }
      const parent = byId.get(following.taskId)?.officeParentId;
      if (parent && parent !== message.taskId) break;
      end = next;
    }
    if (end > index) {
      moved.add(message.id);
      after.set(end, [...(after.get(end) ?? []), message]);
    }
  });
  return messages.flatMap((message, index) => [
    ...(moved.has(message.id) ? [] : [message]),
    ...(after.get(index) ?? []),
  ]);
}

/** Presentation only: the persisted message order and contents stay untouched. */
export function conversationMessageGroups(messages: ConversationMessage[], tasks: TeamTask[]) {
  const internalTasks = new Set(tasks.filter((task) => task.officeParentId).map((task) => task.id));
  const groups: Array<{ internal: boolean; messages: ConversationMessage[] }> = [];
  for (const message of conversationDisplayMessages(messages, tasks)) {
    const internal =
      message.origin === 'internal' ||
      !!message.officeAssignment ||
      internalTasks.has(message.taskId);
    const previous = groups.at(-1);
    if (internal && previous?.internal) previous.messages.push(message);
    else groups.push({ internal, messages: [message] });
  }
  return groups;
}

export function conversationTask(tasks: TeamTask[], conversationId?: string): TeamTask | undefined {
  if (!conversationId) return undefined;
  return [...tasks]
    .reverse()
    .find((task) => task.conversationId === conversationId && !task.officeParentId);
}

export const projectChangeDescription =
  'Los archivos del proyecto cambiaron durante un análisis o una revisión de solo lectura. La comparación no permite identificar quién los modificó.';

export const reasons: Record<string, string> = {
  model_at_capacity:
    'El modelo está temporalmente saturado. Se conserva el trabajo; no se ha iniciado otra ejecución automáticamente.',
  app_server_rate_limited:
    'Codex ha comunicado un límite temporal de solicitudes. No se confunde con saturación del modelo ni con cuota agotada.',
  quota_reserve:
    'La cuota ha llegado al margen de seguridad. La oficina espera a que se renueve o a una nueva comprobación explícita; no usa créditos adicionales.',
  quota_unknown:
    'No se ha podido comprobar la cuota incluida. La oficina no iniciará otra ejecución hasta verificarla.',
  provider_limit:
    'El proveedor ha indicado un límite de uso. Se conserva el trabajo y hace falta comprobar la cuota antes de continuar.',
  review_scope_large:
    'La restricción de tamaño que detuvo esta revisión se ha retirado. Pulsa Ejecutar para comprobar el estado actual y continuar; la entrega anterior está guardada.',
  instruction_delivery_unknown:
    'No se pudo confirmar si el ejecutor recibió la nueva indicación. El trabajo se ha detenido para evitar un resultado con requisitos inciertos. Revisa la respuesta y el mensaje pendiente antes de continuar.',
  project_changed_during_read: projectChangeDescription,
  review_changed_files: projectChangeDescription,
  budget_review_required:
    'Todavía no hay una estimación fiable. Revisa el límite de este encargo antes de ejecutar.',
  token_budget: 'Se ha alcanzado el límite de tokens del encargo.',
  run_budget: 'Se ha alcanzado el límite de llamadas.',
  time_budget: 'Se ha agotado el tiempo autorizado.',
  server_restarted:
    'La oficina se ha reiniciado. El historial está guardado; el trabajo necesita tu confirmación.',
  server_stopped: 'La oficina se cerró con el trabajo en pausa. Confirma si quieres continuar.',
  user_pause: 'Has pausado el trabajo.',
  cancelled_by_user: 'Se ha registrado la cancelación del encargo.',
  usage_unknown_after_restart:
    'Falta el consumo del trabajo interrumpido. Al continuar se comprobará la cuota actual del proveedor y se conservará el historial incompleto.',
  usage_unknown:
    'La ejecución anterior no comunicó su consumo. Puedes continuar comprobando la cuota actual del proveedor; los datos anteriores no se borrarán.',
  checkpoint_invalid: 'No se puede recuperar la cola. Tus conversaciones siguen disponibles.',
  check_unconfigured:
    'Hay pruebas del encargo pendientes de aprobación o cuya configuración ha cambiado.',
  local_checks_failed: 'Una prueba local ha fallado. Revisa el resultado antes de continuar.',
  conversation_confirmation_required:
    'La autorización de este encargo ha cambiado. Vuelve a revisar y confirmar.',
  office_no_progress:
    'El equipo ha repetido entregas sin progreso verificable. Revisa las entregas antes de continuar.',
  office_human_required: 'El Jefe necesita tu decisión. Lee su pregunta en la conversación.',
  office_completion_unverified:
    'El objetivo necesita una revisión independiente vigente antes de darlo por terminado.',
  review_findings: 'La revisión ha registrado hallazgos pendientes de resolver.',
};

/** Correct an old attribution in presentation without rewriting the saved history. */
export function stateText(text: string, reason?: string | null): string {
  return [
    'review_changed_files',
    'project_changed_during_read',
    'server_restarted',
    'server_stopped',
  ].includes(reason ?? '')
    ? text.replace(
        'Un empleado de solo lectura modificó archivos. Se necesita revisión.',
        projectChangeDescription,
      )
    : text;
}

/** Derived exclusively from recorded status/reason, never inferred from model prose. */
export function executionState(
  status: TeamTask['status'],
  reason?: string | null,
  explanation?: string,
) {
  if (reason === 'office_human_required' && explanation)
    return {
      title: 'El Jefe necesita tu respuesta',
      detail: explanation,
      next: 'Responde en la tarjeta de la conversación para continuar.',
    };
  if (reason === 'project_changed_during_read' || reason === 'review_changed_files')
    return {
      title: 'El proyecto cambió durante la revisión',
      detail: projectChangeDescription,
      next: 'Revisa los cambios y continúa el encargo para analizar el estado actualizado. Las entregas anteriores siguen guardadas.',
    };
  const defaults: Record<TeamTask['status'], { title: string; detail: string; next: string }> = {
    planned: {
      title: 'Encargo preparado',
      detail: 'La petición está registrada y pendiente de ejecución.',
      next: 'Revisa los controles del encargo para ejecutarlo.',
    },
    queued: {
      title: 'Esperando ejecución',
      detail: 'El encargo está en la cola de la oficina.',
      next: 'Los resultados aparecerán aquí cuando se ejecute. Puedes detenerlo.',
    },
    checking: {
      title: 'Comprobación previa',
      detail: 'La oficina está comprobando si puede iniciar el encargo.',
      next: 'Espera el resultado de la comprobación. Todavía no se acredita la ejecución.',
    },
    running: {
      title: 'Trabajo en curso',
      detail: 'El servidor registra el encargo en ejecución.',
      next: 'Las entregas aparecerán en esta conversación. Puedes detener el trabajo.',
    },
    completed: {
      title: 'Ejecución terminada',
      detail: 'El encargo consta como completado en el servidor.',
      next: 'Lee la entrega y sus comprobaciones antes de dar tu aprobación final.',
    },
    paused: {
      title: 'Trabajo en pausa',
      detail: 'El servidor ha pausado el encargo.',
      next: 'Revisa el motivo y los controles de continuación. No se reanudará automáticamente.',
    },
    blocked: {
      title: 'Encargo bloqueado',
      detail: 'El encargo no puede continuar con las condiciones actuales.',
      next: 'Revisa el motivo y resuelve lo indicado antes de volver a ejecutar.',
    },
    failed: {
      title: 'Ejecución con error',
      detail: 'El encargo consta como fallido.',
      next: 'Consulta el error antes de volver a intentarlo. Puede haber entregas parciales guardadas.',
    },
    cancelled: {
      title: 'Encargo cancelado',
      detail: 'El servidor registra el encargo como cancelado.',
      next: 'Las entregas guardadas siguen disponibles. Puedes escribir una nueva petición.',
    },
  };
  const result = defaults[status];
  return {
    ...result,
    detail: (reason && reasons[reason]) || (reason && explanation) || result.detail,
  };
}
