import { describe, expect, it } from 'vitest';

import { CODEX_TASK_PREFIX } from '../src/execution/codexExecutor.js';
import {
  OFFICE_CHIEF_GUIDE,
  OfficeProgressGuard,
  parseOfficeDecision,
} from '../src/execution/officeLoop.js';
import { prepareTaskContext } from '../src/execution/taskContext.js';

describe('office decision contract (no inference)', () => {
  it('authorizes office assignments in the complete chief prompt while restricting external launches', () => {
    const prompt = CODEX_TASK_PREFIX + prepareTaskContext('chief', OFFICE_CHIEF_GUIDE).prompt;
    expect(prompt).toContain('Puedes asignar encargos al Arquitecto');
    expect(prompt).toContain('OFFICE_DECISION con action assign');
    expect(prompt).toContain('asígnala al Tester');
    expect(prompt).toContain('No inicies CLIs de IA, subagentes ni proveedores por tu cuenta');
    expect(prompt).toContain('Evita delegar por rutina');
    expect(prompt).toContain(
      'respuestas informativas breves autorizadas como directas no exijas Tester',
    );
    expect(prompt).toContain('Respeta las restricciones explícitas de la petición actual');
    expect(prompt).toContain(
      'no atribuyas al usuario restricciones mencionadas solo por otro agente',
    );
  });
  it.each(['architect', 'designer', 'developer', 'tester'] as const)(
    'keeps %s within the assigned work without granting coordination authority',
    (role) => {
      const prompt = prepareTaskContext(role, 'Encargo acotado').prompt;
      expect(prompt).toContain('solo el Jefe asigna nuevos trabajos');
      expect(prompt).toContain('No inicies CLIs de IA, subagentes ni proveedores por tu cuenta');
      expect(prompt).not.toContain('Puedes asignar encargos');
    },
  );
  it('accepts only the final structured decision', () => {
    expect(
      parseOfficeDecision(
        'Explicación\nOFFICE_DECISION {"action":"human","message":"Elige la propuesta visual"}',
      ),
    ).toEqual({ action: 'human', message: 'Elige la propuesta visual' });
  });
  it.each([
    { action: 'assign', role: 'chief', title: 'Más', task: 'Más', message: 'Recursión' },
    {
      action: 'assign',
      role: 'developer',
      title: 'Más',
      task: 'Más',
      message: 'Permisos',
      allowWrites: true,
    },
    { action: 'complete', message: 'Listo', command: 'publish' },
    { action: 'assign', role: 'tester', title: '', task: 'Revisa', message: 'Revisión' },
  ])('rejects unsupported roles, settings and extra fields', (value) => {
    expect(() => parseOfficeDecision('OFFICE_DECISION ' + JSON.stringify(value))).toThrow();
  });
  it('counts repeated evidence across intervening work without capping useful rounds', () => {
    const progress = new OfficeProgressGuard();
    for (let i = 0; i < 100; i++) progress.observe('developer', `revision-${i}`);
    progress.observe('developer', 'unchanged');
    progress.observe('architect', 'other evidence');
    progress.observe('developer', 'unchanged');
    expect(() => progress.observe('developer', 'unchanged')).toThrow('tres entregas');
  });
});
