import type { OfficeWorkSignal } from '../../../core/src/officePresence.js';
import type { TeamTask } from '../../../core/src/team.js';

/** Only registered assignments and final evidence may describe employee work. */
export function officeWorkSignal(
  task: TeamTask | undefined,
  tasks: TeamTask[],
): OfficeWorkSignal | undefined {
  if (!task) return undefined;
  const root = task.officeParentId ? tasks.find((t) => t.id === task.officeParentId) : task;
  if (!root) return undefined;
  const signal = (
    label: string,
    tone: OfficeWorkSignal['tone'],
    active = false,
  ): OfficeWorkSignal => ({
    label,
    tone,
    active,
    ...(root.conversationId ? { conversationId: root.conversationId } : {}),
  });
  if (root.status === 'cancelled') return signal('Cancelado', 'neutral');
  if (['paused', 'blocked', 'failed'].includes(root.status))
    return signal(
      root.humanRequest ? 'Necesita respuesta' : root.status === 'failed' ? 'Error' : 'En pausa',
      'paused',
    );
  if (root.office && root.status === 'completed') {
    const evidence = root.finalEvidence;
    const fresh = evidence && evidence.objectiveRevision === (root.objectiveRevision ?? 0);
    if (task.role === 'chief')
      return signal(
        fresh && evidence.review.state === 'tester'
          ? '✓ Entregado'
          : fresh && evidence.review.state === 'direct'
            ? 'Respuesta lista'
            : 'Finalizado sin ficha',
        fresh ? 'done' : 'neutral',
      );
    return signal(
      task.role === 'tester' && fresh && evidence.review.taskId === task.id
        ? '✓ Revisado'
        : 'Trabajo terminado',
      'neutral',
    );
  }
  if (['paused', 'blocked', 'failed'].includes(task.status))
    return signal(task.status === 'failed' ? 'Error' : 'En pausa', 'paused');
  if (task.status === 'cancelled') return signal('Cancelado', 'neutral');
  if (task.status === 'completed')
    return signal(
      task.role === 'chief'
        ? 'Coordinando'
        : task.role === 'tester'
          ? 'Revisión terminada'
          : 'Trabajo terminado',
      'neutral',
    );
  if (!['running', 'checking'].includes(task.status)) return signal('Pendiente', 'neutral');
  if (task.status === 'checking') return signal('Comprobando', 'active', true);
  if (task.toolActivity === 'Esperando tu confirmación')
    return signal('Necesita aprobación', 'paused');
  const activity = [...(task.liveActivity ?? [])].reverse().find((item) => !item.completed);
  const title = activity?.title ?? '';
  if (/Modificando archivos/.test(title)) return signal('Editando', 'active', true);
  if (/Ejecutando un comando/.test(title)) return signal('Ejecutando comando', 'active', true);
  if (/Buscando información/.test(title)) return signal('Buscando', 'active', true);
  if (/Generando una imagen/.test(title)) return signal('Generando imagen', 'active', true);
  if (/Revisando una imagen/.test(title)) return signal('Revisando imagen', 'active', true);
  return signal(
    task.role === 'tester' ? 'Revisando' : task.role === 'chief' ? 'Coordinando' : 'Trabajando',
    'active',
    true,
  );
}
