import type { TaskContext, WorkflowDecomposition } from '../../../core/src/team.js';
import { validateAssessment } from './taskAssessment.js';
import { validateContext } from './taskContext.js';
import { ExecutionBlocked } from './types.js';
import { validateOwnedFiles } from './workflowWorkspace.js';

/** Conservative across case-insensitive filesystems and file/directory replacements. */
export function ownershipOverlaps(left: string, right: string): boolean {
  const a = left.normalize('NFC').toLowerCase(),
    b = right.normalize('NFC').toLowerCase();
  return a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
}

export function validateDecomposition(
  value: WorkflowDecomposition,
  context: TaskContext,
): WorkflowDecomposition {
  if (
    !value ||
    !Array.isArray(value.parts) ||
    value.parts.length !== 2 ||
    !Array.isArray(value.sharedFiles)
  )
    throw new ExecutionBlocked(
      'invalid_decomposition',
      'Se requieren dos partes acotadas y contratos compartidos explícitos.',
    );
  const sharedFiles = value.sharedFiles.length ? validateOwnedFiles(value.sharedFiles) : [];
  const parts = value.parts.map((p, index) => {
    if (
      !p ||
      typeof p.title !== 'string' ||
      !p.title.trim() ||
      p.title.length > 160 ||
      typeof p.objective !== 'string' ||
      !p.objective.trim() ||
      p.objective.length > 4000
    )
      throw new ExecutionBlocked(
        'invalid_decomposition',
        'Título u objetivo de subtarea incorrectos.',
      );
    if (
      p.dependsOn !== undefined &&
      (!Array.isArray(p.dependsOn) ||
        p.dependsOn.some((i) => !Number.isInteger(i) || i < 0 || i > 1 || i === index))
    )
      throw new ExecutionBlocked('invalid_decomposition', 'Dependencias de subtarea incorrectas.');
    const ownedFiles = validateOwnedFiles(p.ownedFiles),
      packet = validateContext(p.context);
    const assessment = validateAssessment(p.assessment);
    if (
      packet.objective !== p.objective ||
      packet.acceptance.some((c) => !context.acceptance.includes(c)) ||
      packet.checks.some((c) => !context.checks.includes(c)) ||
      packet.files.some((f) => !context.files.includes(f)) ||
      ownedFiles.some(
        (f) =>
          !context.files.includes(f) ||
          !packet.files.includes(f) ||
          sharedFiles.some((s) => ownershipOverlaps(s, f)),
      )
    )
      throw new ExecutionBlocked(
        'invalid_decomposition',
        'La subtarea altera el alcance, aceptación o contrato compartido.',
      );
    return {
      title: p.title,
      objective: p.objective,
      ownedFiles,
      context: packet,
      assessment,
      ...(p.dependsOn?.length ? { dependsOn: [...new Set(p.dependsOn)] } : {}),
    };
  });
  if (
    sharedFiles.some((f) => !context.files.includes(f)) ||
    context.acceptance.some((c) => !parts.some((p) => p.context.acceptance.includes(c)))
  )
    throw new ExecutionBlocked('invalid_decomposition', 'El reparto deja criterios sin cubrir.');
  return { sharedFiles, parts };
}

/** A small, deterministic decision. No claim of statistical efficiency. */
export function chooseWorkflowSchedule(options: {
  isolated: boolean;
  maxParallel: number;
  overlap: boolean;
  dependent?: boolean;
  risky: boolean;
  workersMs: number[];
  preparationMs: number | null;
  integrationMs: number | null;
  sequentialMs: number | null;
}) {
  const serial = (reason: string) => ({ mode: 'serial' as const, reason });
  if (!options.isolated) return serial('Motor sin aislamiento acreditado: un Programador.');
  if (options.maxParallel < 2 || options.overlap || options.dependent)
    return serial('Escrituras compartidas, dependencias o límite manual: ejecución secuencial.');
  if (options.risky)
    return serial('Riesgo o incertidumbre sin acotar: conservar orden y revisión.');
  if (
    options.preparationMs === null ||
    options.integrationMs === null ||
    options.sequentialMs === null ||
    [options.preparationMs, options.integrationMs, options.sequentialMs].some(
      (n) => !Number.isFinite(n) || n <= 0,
    ) ||
    options.workersMs.length !== 2 ||
    options.workersMs.some((n) => !Number.isFinite(n) || n <= 0)
  )
    return serial(
      'Falta evidencia defendible del coste completo; no se presupone beneficio paralelo.',
    );
  const expected = options.preparationMs + Math.max(...options.workersMs) + options.integrationMs;
  return expected < options.sequentialMs
    ? {
        mode: 'parallel' as const,
        reason: `Estimación completa ${Math.ceil(expected)} ms, menor que ${options.sequentialMs} ms secuenciales; beneficio aún no demostrado.`,
      }
    : serial('Preparación e integración anulan el beneficio previsto.');
}
