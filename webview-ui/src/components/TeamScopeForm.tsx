import { useState } from 'react';

import type {
  TaskAssessment,
  TeamSnapshot,
  WorkflowDecomposition,
} from '../../../core/src/team.js';
import { Button } from './ui/Button.js';

const field = 'w-full bg-bg border border-border p-4 text-text';
const lines = (value: string) => [
  ...new Set(
    value
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean),
  ),
];

function CheckPicker({
  snapshot,
  value,
  label,
  onChange,
}: {
  snapshot: TeamSnapshot;
  value: string;
  label: string;
  onChange: (value: string) => void;
}) {
  const available = snapshot.capabilities?.checks;
  return available?.length ? (
    <fieldset className="space-y-4">
      <legend>Comprobaciones disponibles para {label}</legend>
      {available.map((check) => (
        <label className="block" key={check.id}>
          <input
            type="checkbox"
            aria-label={`Incluir ${check.id} en ${label}`}
            checked={lines(value).includes(check.id)}
            onChange={(e) =>
              onChange(
                (e.target.checked
                  ? [...lines(value), check.id]
                  : lines(value).filter((id) => id !== check.id)
                ).join('\n'),
              )
            }
          />{' '}
          {check.id}
          {check.acceptance ? ' · aceptación del conjunto' : ''}
        </label>
      ))}
    </fieldset>
  ) : (
    <p className="text-text-muted">
      El servidor no comunica un catálogo de comprobaciones. Los IDs introducidos se validarán al
      preparar.
    </p>
  );
}

/** Only contracts cross HTTP. The server owns paths, checks, permissions and scheduling. */
export function TeamScopeForm({
  project,
  goal,
  allowWrites,
  snapshot,
  disabled,
  action,
}: {
  project: string;
  goal: string;
  allowWrites: boolean;
  snapshot: TeamSnapshot;
  disabled: boolean;
  action: (path: string, body?: unknown) => Promise<boolean>;
}) {
  const savedContext = snapshot.library?.projects.find((p) => p.path === project)?.context;
  const [values, setValues] = useState({
    files: savedContext?.files.join('\n') ?? '',
    decisions: savedContext?.decisions.join('\n') ?? '',
    acceptance: savedContext?.acceptance.join('\n') ?? '',
    checks: savedContext?.checks.join('\n') ?? '',
    modules: '',
    shared: '',
  });
  const [assessment, setAssessment] = useState<TaskAssessment>({
    scope: 'bounded',
    risk: 'unknown',
    uncertainty: 'unknown',
    tests: 'unknown',
    modules: [],
  });
  const [split, setSplit] = useState(false);
  const [parts, setParts] = useState([
    { objective: '', files: '', checks: '', acceptance: '' },
    { objective: '', files: '', checks: '', acceptance: '' },
  ]);
  const canSplit =
    !!snapshot.settings.experimentalParallelWriters && !!snapshot.capabilities?.isolatedWriters;
  const splitting = split && canSplit;
  const [error, setError] = useState('');
  return (
    <details className="border border-border p-4 mb-8">
      <summary>Encargo acotado y reparto de archivos</summary>
      <form
        className="space-y-8 mt-8"
        onSubmit={(event) => {
          event.preventDefault();
          setError('');
          if (!project.trim() || !goal.trim() || goal.length > 4000) {
            setError(
              'Indica la carpeta y un objetivo de hasta 4.000 caracteres en los campos superiores.',
            );
            return;
          }
          const context = {
            objective: goal.trim(),
            files: lines(values.files),
            decisions: lines(values.decisions),
            acceptance: lines(values.acceptance),
            checks: lines(values.checks),
          };
          const evidence = { ...assessment, modules: lines(values.modules) };
          const decomposition: WorkflowDecomposition | undefined = splitting
            ? {
                sharedFiles: lines(values.shared),
                parts: parts.map((part, i) => ({
                  title: `Programador ${i + 1}: ${part.objective.trim().slice(0, 140)}`,
                  objective: part.objective.trim(),
                  ownedFiles: lines(part.files),
                  assessment: evidence,
                  context: {
                    objective: part.objective.trim(),
                    files: [...new Set([...lines(part.files), ...lines(values.shared)])],
                    decisions: context.decisions,
                    acceptance: lines(part.acceptance),
                    checks: lines(part.checks),
                  },
                })),
              }
            : undefined;
          void action('scope', {
            project: project.trim(),
            context,
            assessment: evidence,
            allowWrites,
            ...(decomposition ? { decomposition } : {}),
          });
        }}
      >
        <p>
          Usa la carpeta, el objetivo y el permiso de cambios indicados arriba. Un elemento por
          línea. Preparar no llama a la IA ni inicia la cola.
        </p>
        {error && <p role="alert">{error}</p>}
        <fieldset disabled={disabled} className="space-y-8">
          {(
            [
              ['files', 'Archivos relevantes (rutas relativas)'],
              ['decisions', 'Decisiones e instrucciones del encargo'],
              ['acceptance', 'Criterios de aceptación del conjunto'],
              ['checks', 'Comprobaciones del conjunto (IDs configurados)'],
              ['modules', 'Módulos afectados'],
            ] as const
          ).map(([key, label]) => (
            <label className="block" key={key}>
              {label}
              <textarea
                aria-label={label}
                className={field}
                rows={2}
                required={key === 'acceptance' || key === 'files'}
                value={values[key]}
                onChange={(e) => setValues({ ...values, [key]: e.target.value })}
              />
            </label>
          ))}
          <CheckPicker
            snapshot={snapshot}
            value={values.checks}
            label="el conjunto"
            onChange={(checks) => setValues({ ...values, checks })}
          />
          <p className="text-text-muted">
            Las comprobaciones deben existir en el registro local. Escribe sus identificadores,
            nunca comandos. El servidor verifica la cobertura; no se presupone aceptación completa.
          </p>
          <label className="block">
            Alcance
            <select
              className={field}
              aria-label="Alcance del encargo"
              value={assessment.scope}
              onChange={(e) =>
                setAssessment({ ...assessment, scope: e.target.value as TaskAssessment['scope'] })
              }
            >
              <option value="bounded">Acotado</option>
              <option value="cross-module">Varios módulos</option>
              <option value="explanation">Explicación de solo lectura</option>
            </select>
          </label>
          {(['risk', 'uncertainty'] as const).map((key) => (
            <label className="block" key={key}>
              {key === 'risk' ? 'Riesgo' : 'Incertidumbre'}
              <select
                className={field}
                aria-label={key === 'risk' ? 'Riesgo del encargo' : 'Incertidumbre del encargo'}
                value={assessment[key]}
                onChange={(e) => setAssessment({ ...assessment, [key]: e.target.value })}
              >
                <option value="unknown">Sin determinar</option>
                <option value="low">Bajo</option>
                <option value="high">Alto</option>
              </select>
            </label>
          ))}
          <label className="block">
            Pruebas disponibles
            <select
              className={field}
              aria-label="Pruebas disponibles"
              value={assessment.tests}
              onChange={(e) =>
                setAssessment({ ...assessment, tests: e.target.value as TaskAssessment['tests'] })
              }
            >
              <option value="unknown">Sin determinar</option>
              <option value="available">Disponibles</option>
              <option value="missing">Ausentes</option>
            </select>
          </label>
          <label className="block">
            <input
              type="checkbox"
              checked={splitting}
              disabled={!canSplit || !allowWrites}
              onChange={(e) => setSplit(e.target.checked)}
            />{' '}
            Proponer dos partes independientes
          </label>
          {!canSplit && (
            <p className="text-text-muted">
              Un Programador por defecto. El reparto requiere AO con aislamiento y la opción
              experimental activada.
            </p>
          )}
          {splitting && (
            <>
              <p>
                Incluye los archivos propios y compartidos en la lista global. Los criterios y
                comprobaciones de cada parte deben pertenecer al contrato global. El Jefe puede
                conservar el trabajo secuencial según riesgo, dependencias, solapamiento y coste.
              </p>
              <label className="block">
                Archivos compartidos de solo lectura
                <textarea
                  className={field}
                  aria-label="Archivos compartidos de solo lectura"
                  rows={2}
                  value={values.shared}
                  onChange={(e) => setValues({ ...values, shared: e.target.value })}
                />
              </label>
              {parts.map((part, i) => (
                <fieldset className="border border-border p-4 space-y-4" key={i}>
                  <legend>Programador {i + 1}</legend>
                  {(
                    [
                      ['objective', 'Objetivo'],
                      ['files', 'Archivos propios'],
                      ['acceptance', 'Criterios de aceptación'],
                      ['checks', 'Comprobaciones (IDs)'],
                    ] as const
                  ).map(([key, label]) => (
                    <label className="block" key={key}>
                      {label}
                      <textarea
                        className={field}
                        aria-label={`${label} del Programador ${i + 1}`}
                        rows={2}
                        required
                        maxLength={key === 'objective' ? 4000 : undefined}
                        value={part[key]}
                        onChange={(e) =>
                          setParts(
                            parts.map((p, j) => (j === i ? { ...p, [key]: e.target.value } : p)),
                          )
                        }
                      />
                    </label>
                  ))}
                  <CheckPicker
                    snapshot={snapshot}
                    value={part.checks}
                    label={`el Programador ${i + 1}`}
                    onChange={(checks) =>
                      setParts(parts.map((p, j) => (j === i ? { ...p, checks } : p)))
                    }
                  />
                </fieldset>
              ))}
            </>
          )}
          <Button
            type="submit"
            disabled={disabled || !project.trim() || !goal.trim() || (splitting && !allowWrites)}
          >
            Preparar encargo sin IA
          </Button>
        </fieldset>
      </form>
    </details>
  );
}
