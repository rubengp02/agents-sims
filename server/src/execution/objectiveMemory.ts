import type { OfficeObjectiveMemory, TeamTask } from '../../../core/src/team.js';
import { parseOfficeDecision } from './officeLoop.js';
import { assessTask } from './taskAssessment.js';

/** A small informational request may finish without delegating; consent to write
 * is not evidence that the user requested an implementation. */
function simpleInformation(prompt: string, assessment: TeamTask['assessment']): boolean {
  const normalized = prompt.replace(
    /\bno\s+(?:modifiques|modificar|edites|editar|cambies|cambiar)\s+(?:los\s+)?archivos\b/gi,
    '',
  );
  if (!normalized.trim()) return true;
  const followup =
    /^(?:(?:incluye|añade|agrega)(?: también)? (?:los )?(?:siguientes|próximos) pasos|(?:resúmelo|resumelo|resúmela|resumela|explícalo|explicalo|explícala|explicala)(?: mejor| brevemente)?|(?:resume|reformula|reformúlalo|reformulalo|reescribe)(?: (?:el resumen|la respuesta|el texto))? en (?:\d+|tres|cuatro|cinco|seis|diez) puntos|(?:hazlo|hazla) más breve|limita el resumen a (?:\d+|tres|cuatro|cinco|seis|diez) puntos)[.!?\s]*$/i.test(
      normalized.trim(),
    );
  return (
    normalized.length < 800 &&
    !/completo|exhaustiv|auditor[ií]a|revisi[oó]n independiente|tester|\b(?:ejecuta|instala|conecta|publica|env[ií]a|despliega|run|install|connect|publish|send|deploy)\w*/i.test(
      normalized,
    ) &&
    assessTask(followup ? 'Resume la respuesta anterior' : normalized, assessment).difficulty ===
      'simple'
  );
}

export function directOfficeAnswer(root: TeamTask, tasks: TeamTask[] = []): boolean {
  if (
    ![root.prompt, ...(root.userInstructions ?? []).map((i) => i.content)].every((text) =>
      simpleInformation(text, root.assessment),
    )
  )
    return false;
  const revision = root.objectiveRevision ?? 0;
  return !tasks.some(
    (t) =>
      t.officeParentId === root.id &&
      t.role !== 'chief' &&
      (t.role === 'developer' ||
        ['running', 'checking', 'queued', 'planned'].includes(t.status) ||
        (t.status !== 'completed' &&
          !(t.status === 'cancelled' && t.reasonCode === 'redirected_by_user')) ||
        (t.objectiveRevision ?? 0) === revision),
  );
}

/** Derived from durable server records; prose from agents never grants authority. */
export function objectiveMemory(
  root: TeamTask,
  tasks: TeamTask[],
  checks: OfficeObjectiveMemory['checks'] = tasks
    .filter((t) => t.officeParentId === root.id && t.localChecks)
    .at(-1)?.localChecks ?? [],
): OfficeObjectiveMemory {
  const assessment = assessTask(
    [root.prompt, ...(root.userInstructions ?? []).map((i) => i.content)].join('\n'),
    root.assessment,
  );
  const direct = directOfficeAnswer(root, tasks);
  const size =
    direct || assessment.difficulty === 'simple'
      ? 'small'
      : assessment.difficulty === 'complex'
        ? 'extended'
        : 'standard';
  return {
    version: 1,
    objectiveId: root.id,
    objective: root.prompt,
    revision: root.objectiveRevision ?? 0,
    instructions: structuredClone(root.userInstructions ?? []),
    team: {
      size,
      reason: direct
        ? 'Petición informativa breve: respuesta directa del Jefe, sin cambios ni revisión rutinaria.'
        : assessment.reason,
      guidance: direct
        ? 'Responde directamente como Jefe. Reutiliza el contexto y consulta únicamente las fuentes necesarias. No convoques Arquitecto ni Tester por rutina. No consultes pruebas para una descripción. Si aparece una incertidumbre material, justifica el especialista necesario.'
        : size === 'small'
          ? 'Resuelve con el equipo mínimo. Si hay cambios, encarga solo Programador y Tester. Evita Arquitecto y Diseñador salvo una necesidad concreta.'
          : size === 'extended'
            ? 'Usa Arquitecto cuando haya incertidumbre técnica y Diseñador cuando haya decisiones visuales. Un solo Programador y revisión independiente del Tester. Justifica cada especialista.'
            : 'Empieza con Programador y Tester para implementar. Para investigar utiliza Arquitecto y Tester. Añade otros especialistas solo por una necesidad concreta; no formes todo el equipo por defecto.',
    },
    deliveries: tasks
      .filter((t) => t.officeParentId === root.id)
      .map((t) => ({
        taskId: t.id,
        role: t.role,
        status: t.status,
        title: t.title,
        summary: t.output.slice(-1200),
        shortened: t.output.length > 1200,
        decision: t.role === 'chief' ? chiefDecision(t.output) : undefined,
        reason: t.reasonCode ?? undefined,
      })),
    checks: structuredClone(checks),
  };
}

function chiefDecision(output: string) {
  try {
    return parseOfficeDecision(output);
  } catch {
    return undefined;
  }
}

export function chiefMemoryPrompt(memory: OfficeObjectiveMemory): string {
  return JSON.stringify({
    ...memory,
    deliveries: memory.deliveries.map((d, i) =>
      i < memory.deliveries.length - 4
        ? {
            ...d,
            summary: undefined,
            decision: d.decision ? { action: d.decision.action, role: d.decision.role } : undefined,
            shortened: true,
          }
        : d,
    ),
  });
}
