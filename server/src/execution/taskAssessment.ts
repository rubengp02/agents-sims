import type { TaskAssessment, TeamRole, TeamTask } from '../../../core/src/team.js';
import { ExecutionBlocked } from './types.js';

export function validateAssessment(value: TaskAssessment): TaskAssessment {
  if (
    !value ||
    !['explanation', 'bounded', 'cross-module'].includes(value.scope) ||
    !['low', 'high', 'unknown'].includes(value.risk) ||
    !['low', 'high', 'unknown'].includes(value.uncertainty) ||
    !['available', 'missing', 'unknown'].includes(value.tests) ||
    !Array.isArray(value.modules) ||
    value.modules.length > 20 ||
    value.modules.some((item) => typeof item !== 'string' || !item.trim() || item.length > 160) ||
    (value.visualDecision !== undefined && typeof value.visualDecision !== 'boolean')
  ) {
    throw new ExecutionBlocked(
      'invalid_assessment',
      'Revisa alcance, riesgo, incertidumbre, módulos y pruebas.',
    );
  }
  return {
    scope: value.scope,
    risk: value.risk,
    uncertainty: value.uncertainty,
    tests: value.tests,
    modules: [...new Set(value.modules)],
    visualDecision: value.visualDecision === true,
  };
}

export function assessTask(
  prompt: string,
  evidence?: TaskAssessment,
): { difficulty: TeamTask['difficulty']; roles: TeamRole[]; reason: string } {
  const explanation =
    /^\s*(explica|resume|lista|documenta|traduce|explain|summari[sz]e|list\b)/i.test(prompt) &&
    !/\b(modifica|cambia|implementa|migra|refactoriza|modify|implement|migrate)\b/i.test(prompt);
  // Words in a documentation request do not imply a security modification.
  const sensitive =
    !explanation &&
    /autentic|authentic|autorizaci[oó]n|authorization|control(?:es)? de acceso|permisos|permissions|credencial|seguridad|concurren|race condition|security|migraci[oó]n|migration|arquitect/i.test(
      prompt,
    );
  const assessment = evidence ? validateAssessment(evidence) : null;
  const highRisk = sensitive || assessment?.risk === 'high';
  const crossModule = assessment?.scope === 'cross-module' || (assessment?.modules.length ?? 0) > 1;
  const uncertain = assessment?.uncertainty === 'high';
  const simple =
    !highRisk &&
    !crossModule &&
    !uncertain &&
    !assessment?.visualDecision &&
    ((assessment?.scope === 'explanation' && explanation) ||
      (!assessment && explanation && prompt.length < 800));
  const roles: TeamRole[] = simple
    ? ['developer']
    : [
        ...(highRisk || crossModule || uncertain ? ['architect' as const] : []),
        ...(assessment?.visualDecision ? ['designer' as const] : []),
        'developer',
        // Only positive evidence can remove independent acceptance for code changes.
        ...(!assessment ||
        assessment.scope !== 'bounded' ||
        assessment.modules.length !== 1 ||
        highRisk ||
        crossModule ||
        uncertain ||
        assessment.risk !== 'low' ||
        assessment.uncertainty !== 'low' ||
        assessment.tests !== 'available'
          ? ['tester' as const]
          : []),
      ];
  return {
    difficulty: highRisk || crossModule || uncertain ? 'complex' : simple ? 'simple' : 'normal',
    roles,
    reason: `Alcance: ${assessment?.scope ?? (simple ? 'explanation' : 'unknown')}; riesgo: ${highRisk ? 'high' : (assessment?.risk ?? 'unknown')}; incertidumbre: ${assessment?.uncertainty ?? 'unknown'}; módulos: ${assessment?.modules.length ?? 'unknown'}; pruebas: ${assessment?.tests ?? 'unknown'}. ${simple ? 'Respuesta directa.' : roles.includes('tester') ? 'Mantener revisión independiente.' : 'Aceptación mecánica local requerida.'}`,
  };
}
