import { useState } from 'react';

import type { TeamSnapshot, TeamTask, TeamWorkflow } from '../../../core/src/team.js';
import { Button } from './ui/Button.js';

type Action = (path: string, body?: unknown) => Promise<boolean>;
const field = 'w-full bg-bg border border-border p-4 text-text';
const seconds = (ms?: number) => (ms === undefined ? '' : String(ms / 1000));

/** Empty estimates require an explicit human choice, never an invented reserve. */
function BudgetForm({
  fields,
  disabled,
  save,
}: {
  fields: Array<{
    key: string;
    label: string;
    value?: number | string;
    max: number;
    step?: number;
  }>;
  disabled: boolean;
  save: (values: Record<string, number>) => Promise<boolean>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, String(f.value ?? '')])),
  );
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="space-y-4 mt-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save(Object.fromEntries(fields.map((f) => [f.key, Number(values[f.key])]))).then(
          setSaved,
        );
      }}
    >
      <fieldset disabled={disabled} className="space-y-4">
        {fields.map((f) => (
          <label className="block" key={f.key}>
            {f.label}
            <input
              className={field}
              aria-label={f.label}
              type="number"
              min={f.step ?? 1}
              step={f.step ?? 1}
              max={f.max}
              required
              value={values[f.key]}
              onChange={(e) => {
                setSaved(false);
                setValues({ ...values, [f.key]: e.target.value });
              }}
            />
          </label>
        ))}
        <p className="text-text-muted">
          Cotas conservadoras revisadas por ti. Guardarlas no ejecuta tareas, no aumenta el
          presupuesto global ni reanuda una pausa.
        </p>
        <Button type="submit" disabled={disabled}>
          Guardar cotas revisadas
        </Button>
        {saved && <p role="status">Cotas guardadas.</p>}
      </fieldset>
    </form>
  );
}

export function TaskBudgetControl({
  task,
  snapshot,
  disabled,
  action,
}: {
  task: TeamTask;
  snapshot: TeamSnapshot;
  disabled: boolean;
  action: Action;
}) {
  return (
    <details className="mt-4">
      <summary>Estimación y reserva de la tarea</summary>
      <p>
        {task.estimate
          ? `Estimación: ${task.estimate.tokens ?? 'desconocidos'} tokens · ${task.estimate.durationMs === null ? 'tiempo desconocido' : seconds(task.estimate.durationMs) + ' s'} · ${task.estimate.samples} muestras · ${task.estimate.confidence}. ${task.estimate.reason}`
          : 'Sin estimación acreditada.'}
      </p>
      {task.budgetReview && (
        <p>
          Cota revisada: {task.budgetReview.tokens} tokens · {seconds(task.budgetReview.durationMs)}{' '}
          s · {task.budgetReview.maxContextCharacters} caracteres de contexto.
        </p>
      )}
      {snapshot.capabilities?.budgetReview && !['completed', 'cancelled'].includes(task.status) ? (
        <>
          {!task.choice && (
            <p>
              Comprueba primero la asignación para vincular la reserva al modelo y razonamiento
              elegidos.
            </p>
          )}
          <BudgetForm
            key={JSON.stringify(task.choice)}
            disabled={disabled || !task.choice}
            fields={[
              {
                key: 'tokens',
                label: 'Cota de tokens de la tarea',
                value: task.budgetReview?.tokens,
                max: snapshot.settings.maxTokens,
              },
              {
                key: 'seconds',
                label: 'Cota de duración de la tarea (segundos)',
                value: seconds(task.budgetReview?.durationMs),
                max: snapshot.settings.maxMinutes * 60,
                step: 0.001,
              },
              {
                key: 'characters',
                label: 'Máximo de caracteres del contexto',
                value: task.budgetReview?.maxContextCharacters,
                max: 90000,
              },
            ]}
            save={(v) =>
              action('budget-review', {
                id: task.id,
                tokens: v.tokens,
                durationMs: Math.round(v.seconds * 1000),
                maxContextCharacters: v.characters,
              })
            }
          />
        </>
      ) : (
        !snapshot.capabilities?.budgetReview && (
          <p>El servidor no ofrece revisión adaptativa de reservas en esta sesión.</p>
        )
      )}
    </details>
  );
}

const states: Record<TeamWorkflow['status'], string> = {
  planned: 'Preparado',
  preparing: 'Preparando espacios',
  working: 'En curso',
  integrating: 'Integrando y comprobando',
  accepted: 'Aceptado',
  paused: 'En pausa: requiere revisión',
};
export function TeamWorkflowCard({
  workflow,
  snapshot,
  disabled,
  action,
}: {
  workflow: TeamWorkflow;
  snapshot: TeamSnapshot;
  disabled: boolean;
  action: Action;
}) {
  const assigned = workflow.taskIds.every((id) =>
    snapshot.tasks.some((t) => t.id === id && t.choice),
  );
  return (
    <article
      className="border border-border p-8 mb-8"
      aria-label={`Flujo: ${workflow.context.objective}`}
    >
      <strong>{workflow.context.objective}</strong>
      <p>Estado del conjunto: {states[workflow.status]}</p>
      <p>
        Organización: {workflow.mode === 'parallel' ? 'Paralela' : 'Secuencial'}. {workflow.reason}
      </p>
      {workflow.reasonCode && <p className="text-warning">Motivo: {workflow.reasonCode}</p>}
      <p>Archivos compartidos de solo lectura: {workflow.sharedFiles.join(', ') || 'Ninguno'}</p>
      {workflow.candidateProject && (
        <p className="break-words">Candidato integrado: {workflow.candidateProject}</p>
      )}
      {workflow.candidateHash && (
        <p className="break-words">Huella comprobada: {workflow.candidateHash}</p>
      )}
      {workflow.status === 'paused' && (
        <p>
          Los resultados se conservan. Esta pausa no permite reaceptar ni repetir el flujo
          automáticamente.
        </p>
      )}
      {!!workflow.localChecks?.length && (
        <ul aria-label="Comprobaciones del conjunto">
          {workflow.localChecks.map((c, i) => (
            <li key={`${c.id}-${i}`}>
              {c.id}: {c.passed ? 'Superada' : 'Fallida'} · {c.durationMs} ms · salida{' '}
              {c.exitCode ?? 'desconocida'}
            </li>
          ))}
        </ul>
      )}
      <p>
        Preparación:{' '}
        {workflow.preparationMs === undefined
          ? 'pendiente'
          : `${seconds(workflow.preparationMs)} s`}
        . Integración:{' '}
        {workflow.integrationMs === undefined
          ? 'pendiente'
          : `${seconds(workflow.integrationMs)} s`}
        .
      </p>
      {workflow.budgetReview && (
        <p>
          Cotas revisadas: preparación {seconds(workflow.budgetReview.preparationMs)} s ·
          integración {seconds(workflow.budgetReview.integrationMs)} s · alternativa secuencial{' '}
          {seconds(workflow.budgetReview.sequentialMs)} s.
        </p>
      )}
      {workflow.status === 'planned' && (
        <details className="mt-4">
          <summary>Revisar coste de preparación e integración</summary>
          {!assigned && (
            <p>Comprueba primero las asignaciones de todos los trabajadores del flujo.</p>
          )}
          <BudgetForm
            key={JSON.stringify(
              workflow.taskIds.map((id) => snapshot.tasks.find((t) => t.id === id)?.choice),
            )}
            disabled={disabled || !assigned}
            fields={[
              {
                key: 'preparation',
                label: 'Preparación de espacios (segundos)',
                value: seconds(workflow.budgetReview?.preparationMs),
                max: snapshot.settings.maxMinutes * 60,
                step: 0.001,
              },
              {
                key: 'integration',
                label: 'Integración y comprobaciones (segundos)',
                value: seconds(workflow.budgetReview?.integrationMs),
                max: snapshot.settings.maxMinutes * 60,
                step: 0.001,
              },
              {
                key: 'sequential',
                label: 'Alternativa secuencial completa (segundos)',
                value: seconds(workflow.budgetReview?.sequentialMs),
                max: snapshot.settings.maxMinutes * 60,
                step: 0.001,
              },
            ]}
            save={(v) =>
              action('workflow-budget-review', {
                id: workflow.id,
                preparationMs: Math.round(v.preparation * 1000),
                integrationMs: Math.round(v.integration * 1000),
                sequentialMs: Math.round(v.sequential * 1000),
              })
            }
          />
        </details>
      )}
    </article>
  );
}
