import { createHash } from 'node:crypto';

import {
  type DeliveryEvidence,
  type ExecutionEvidenceKind,
  validDeliveryEvidence,
} from '../../../core/src/deliveryEvidence.js';
import type { TeamTask } from '../../../core/src/team.js';
import type { FileRevision } from './revisionStore.js';

export function buildDeliveryEvidence(input: {
  root: TeamTask;
  tasks: TeamTask[];
  base?: FileRevision;
  candidate?: FileRevision;
  checks: NonNullable<TeamTask['localChecks']>;
  reviewTask?: TeamTask;
  direct: boolean;
  execution: ExecutionEvidenceKind;
}): DeliveryEvidence {
  const { root, base, candidate, reviewTask } = input;
  const fingerprint = (revision: FileRevision, name: string) =>
    revision.files[name] === undefined
      ? undefined
      : revision.format === 'sha256-v1'
        ? revision.files[name]
        : createHash('sha256').update(Buffer.from(revision.files[name], 'base64')).digest('hex');
  const compared = !!base && !!candidate;
  if (input.direct && compared && base.digest !== candidate.digest)
    throw new Error('Una respuesta directa no puede acreditar cambios sin revisión.');
  const files = compared
    ? [...new Set([...Object.keys(base.files), ...Object.keys(candidate.files)])]
        .filter((name) => fingerprint(base, name) !== fingerprint(candidate, name))
        .sort()
    : [];
  const limitations: string[] = [];
  if (!compared)
    limitations.push('No hay una comparación de archivos acreditada para esta entrega.');
  if (!input.checks.length)
    limitations.push(
      'No hay comprobaciones locales ejecutadas por el servidor para esta entrega. Los comandos mencionados por el modelo no cuentan como pruebas registradas.',
    );
  if (input.direct)
    limitations.push('Respuesta directa: no hubo revisión independiente del Tester.');
  if (input.execution === 'simulated')
    limitations.push(
      'El recorrido usó un ejecutor simulado; no acredita un resultado con un modelo real.',
    );
  if (input.execution === 'unknown')
    limitations.push('El tipo de ejecución no está acreditado por el adaptador.');
  limitations.push('La aceptación humana y la publicación no están acreditadas por esta ficha.');
  if (compared)
    limitations.push(
      'Los cambios se detectaron entre capturas; la comparación no atribuye por sí sola su autoría.',
    );
  const evidence: DeliveryEvidence = {
    version: 1,
    createdAt: Date.now(),
    objectiveRevision: root.objectiveRevision ?? 0,
    execution: input.execution,
    changes: {
      state: compared ? 'compared' : 'not_captured',
      files,
      base: base?.digest ?? null,
      candidate: candidate?.digest ?? null,
    },
    checks: input.checks.map(({ id, exitCode, durationMs, passed }) => ({
      id,
      exitCode,
      durationMs,
      passed,
    })),
    review: {
      state: input.direct ? 'direct' : 'tester',
      taskId: input.direct ? null : (reviewTask?.id ?? null),
      candidate: input.direct ? null : (reviewTask?.checkedRevision ?? null),
    },
    artifactIds: [
      ...new Set(
        input.tasks
          .filter((task) => task.id === root.id || task.officeParentId === root.id)
          .flatMap((task) => (task.artifacts ?? []).map((artifact) => artifact.id)),
      ),
    ],
    limitations,
  };
  if (
    !input.direct &&
    (!reviewTask ||
      reviewTask.role !== 'tester' ||
      reviewTask.status !== 'completed' ||
      reviewTask.officeParentId !== root.id ||
      (reviewTask.objectiveRevision ?? 0) !== (root.objectiveRevision ?? 0) ||
      (compared && reviewTask.checkedRevision !== candidate.digest))
  )
    throw new Error('Falta una revisión independiente vigente para la ficha.');
  if (!validDeliveryEvidence(evidence)) throw new Error('La ficha de evidencias no es válida.');
  return evidence;
}
