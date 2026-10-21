import type { TeamChoice, TeamSettings, TeamTask } from '../../../core/src/team.js';
import { assessTask } from './taskAssessment.js';
import { ExecutionBlocked, type SubscriptionEvidence } from './types.js';

export const DEFAULT_TEAM_SETTINGS: TeamSettings = {
  mode: 'auto',
  claudeEnabled: false,
  maxRuns: 8,
  maxParallel: 2,
  experimentalParallelWriters: false,
  maxMinutes: 15,
  maxTokens: 30_000,
};

export function validateSettings(value: TeamSettings): TeamSettings {
  if (
    value.experimentalParallelWriters !== undefined &&
    typeof value.experimentalParallelWriters !== 'boolean'
  )
    throw new ExecutionBlocked(
      'invalid_settings',
      'La activación experimental debe ser explícita y booleana.',
    );
  if (!['auto', 'manual', 'mixed'].includes(value.mode) || typeof value.claudeEnabled !== 'boolean')
    throw new ExecutionBlocked('invalid_settings', 'Modo o proveedor incorrectos.');
  for (const [key, min, max] of [
    ['maxRuns', 1, 20],
    ['maxParallel', 1, 2],
    ['maxMinutes', 1, 15],
    ['maxTokens', 1000, 200_000],
  ] as const)
    if (!Number.isInteger(value[key]) || value[key] < min || value[key] > max)
      throw new ExecutionBlocked(
        'invalid_settings',
        'Los límites deben estar dentro del intervalo permitido.',
      );
  return {
    mode: value.mode,
    claudeEnabled: value.claudeEnabled,
    maxRuns: value.maxRuns,
    maxParallel: value.maxParallel,
    experimentalParallelWriters: value.experimentalParallelWriters === true,
    maxMinutes: value.maxMinutes,
    maxTokens: value.maxTokens,
  };
}

/** Routing is bounded and free of extra model calls. API price is not subscription quota. */
export function chooseModel(
  task: Pick<
    TeamTask,
    'prompt' | 'role' | 'override' | 'assessment' | 'proposedChoice' | 'reviewMode'
  >,
  evidence: SubscriptionEvidence,
): {
  choice: TeamChoice;
  difficulty: TeamTask['difficulty'];
  explanation: string;
} {
  const assessment = assessTask(task.prompt, task.assessment);
  const { difficulty } = assessment;
  const simple = difficulty === 'simple';
  const complex = difficulty === 'complex';
  const deep = task.role === 'tester' && task.reviewMode === 'deep';
  if (task.override) {
    const model = evidence.models.find((m) => m.id === task.override!.model);
    if (!model?.efforts.includes(task.override.effort))
      throw new ExecutionBlocked(
        'choice_unavailable',
        'La elección manual no está disponible en el CLI.',
      );
    return {
      choice: { ...task.override },
      difficulty,
      explanation: 'Elección manual; catálogo y suscripción se verifican antes de ejecutar.',
    };
  }
  if (task.proposedChoice) {
    const proposed = task.proposedChoice;
    const allowed =
      proposed.provider === 'codex' &&
      ((proposed.model === 'gpt-6-luna' && proposed.effort === 'low' && !complex) ||
        (proposed.model === 'gpt-6.1-sol' && ['low', 'medium', 'high'].includes(proposed.effort)));
    if (
      !allowed ||
      !evidence.models.some((m) => m.id === proposed.model && m.efforts.includes(proposed.effort))
    )
      throw new ExecutionBlocked(
        'plan_choice_unavailable',
        'La propuesta del Jefe no pertenece al catálogo automático permitido.',
      );
    if ((complex || deep) && proposed.effort === 'low')
      throw new ExecutionBlocked(
        'reasoning_review_required',
        'Un trabajo de alto riesgo necesita revisar su razonamiento.',
      );
    return {
      choice: { ...proposed },
      difficulty,
      explanation: `${assessment.reason} Asignación propuesta por el Jefe, validada por la aplicación; eficiencia aún no demostrada.`,
    };
  }
  // Curated automatic set. Never silently expand to old or high consumption models.
  const preferred = simple && !deep ? ['gpt-6-luna', 'gpt-6.1-sol'] : ['gpt-6.1-sol'];
  const effort = complex || deep ? 'high' : 'low';
  for (const id of preferred) {
    const model = evidence.models.find((m) => m.id === id);
    if (model?.efforts.includes(effort))
      return {
        choice: { provider: 'codex', model: id, effort },
        difficulty,
        explanation: `${assessment.reason} ${deep ? 'Revisión profunda: Sol y razonamiento alto.' : simple ? 'Modelo ligero y razonamiento bajo.' : complex ? 'Sol y razonamiento alto.' : 'Sol y razonamiento bajo.'}`,
      };
  }
  throw new ExecutionBlocked(
    'optimal_model_unavailable',
    'El catálogo no contiene una combinación automática autorizada. Puedes elegir manualmente.',
  );
}
