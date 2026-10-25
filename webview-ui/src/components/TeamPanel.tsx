import { useCallback, useEffect, useRef, useState } from 'react';

import {
  TEAM_ROLES,
  type TeamChoice,
  type TeamRole,
  type TeamSnapshot,
  type TeamTask,
} from '../../../core/src/team.js';
import { ConversationWorkspace } from './ConversationWorkspace.js';
import { ProjectChecksApproval, SavedConversations } from './SavedConversations.js';
import { TeamScopeForm } from './TeamScopeForm.js';
import { TaskBudgetControl, TeamWorkflowCard } from './TeamWorkflowCard.js';
import { Button } from './ui/Button.js';

const statuses: Record<TeamTask['status'], string> = {
  planned: 'Preparada',
  queued: 'En cola',
  checking: 'Comprobando suscripción',
  running: 'Trabajando',
  completed: 'Terminada',
  paused: 'En pausa',
  blocked: 'Bloqueada',
  failed: 'Error',
  cancelled: 'Cancelada',
};
const field = 'w-full bg-bg border border-border p-4 text-text';

export function TeamPanel({ onClose }: { onClose: () => void }) {
  const [snapshot, setSnapshot] = useState<TeamSnapshot | null>(null);
  const [board, setBoard] = useState(false);
  const [project, setProject] = useState('');
  const [goal, setGoal] = useState('');
  const [projectName, setProjectName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [role, setRole] = useState<TeamRole>('developer');
  const [allowWrites, setAllowWrites] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [planning, setPlanning] = useState(false);
  const token = useRef('');
  const panel = useRef<HTMLElement>(null);
  const loadedSelection = useRef<string | null>(null);
  const loadSequence = useRef(0);
  const mutating = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++loadSequence.current;
    const [response, planResponse] = await Promise.all([
      fetch('/api/team', { signal, cache: 'no-store' }),
      fetch('/api/team/planning', { signal, cache: 'no-store' }),
    ]);
    if (!response.ok || !planResponse.ok)
      throw new Error('No se puede conectar con el equipo local.');
    const data = await response.json();
    const plan = await planResponse.json();
    if (sequence !== loadSequence.current || signal?.aborted) return;
    token.current = data.controlToken;
    setSnapshot(data);
    if (data.library) {
      const library = data.library as NonNullable<TeamSnapshot['library']>;
      const key = `${library.selectedProjectId ?? ''}/${library.selected?.id ?? ''}`;
      if (loadedSelection.current !== key) {
        loadedSelection.current = key;
        const saved = library.projects.find((p) => p.id === library.selectedProjectId);
        setProject(saved?.path ?? '');
        setProjectName(saved?.name ?? '');
        setInstructions(saved?.instructions ?? '');
        setGoal(library.selected?.draft ?? '');
        setAllowWrites(false);
      }
    }
    setPlanning(plan.planning);
    if (plan.error) setError(plan.error.message);
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    let pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        await load(abort.signal);
      } catch {
        if (!abort.signal.aborted) setError('No se puede conectar con el equipo local.');
      } finally {
        pending = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1200);
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => {
      abort.abort();
      clearInterval(timer);
      previous?.focus();
    };
  }, [load]);

  async function action(path: string, body: unknown = {}) {
    mutating.current = true;
    loadSequence.current++;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/team/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Office-Control': token.current },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? 'No se pudo completar la acción.');
      await load();
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No se pudo completar la acción.');
      return false;
    } finally {
      mutating.current = false;
      setBusy(false);
    }
  }

  const active =
    busy ||
    planning ||
    snapshot?.running ||
    snapshot?.tasks.some((task) => task.status === 'running' || task.status === 'checking');
  if (snapshot?.library && !board)
    return (
      <ConversationWorkspace
        snapshot={snapshot}
        busy={busy}
        error={error}
        action={action}
        onClose={onClose}
        onQueue={() => setBoard(true)}
      />
    );
  return (
    <section
      ref={panel}
      tabIndex={-1}
      role="dialog"
      aria-label="Equipo de agentes"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
      className="fixed z-40 top-12 right-12 bottom-64 pixel-panel p-10 text-text overflow-auto"
      style={{
        width: board ? 'min(1100px, calc(100vw - 24px))' : 'min(480px, calc(100vw - 24px))',
        fontSize: 16,
      }}
    >
      <div className="flex justify-between gap-8 items-center mb-8">
        <strong className="text-accent-bright text-2xl">Equipo</strong>
        <Button onClick={onClose} aria-label="Cerrar equipo">
          Cerrar
        </Button>
      </div>
      <div className="flex flex-wrap gap-4 mb-8" aria-label="Vistas del equipo">
        <Button variant={!board ? 'active' : 'default'} onClick={() => setBoard(false)}>
          {snapshot?.library ? 'Volver a la conversación' : 'Oficina y panel'}
        </Button>
        <Button variant={board ? 'active' : 'default'} onClick={() => setBoard(true)}>
          Mesa de asignaciones
        </Button>
      </div>
      {error && (
        <p role="alert" className="border border-warning p-4 mb-8">
          {error}
        </p>
      )}
      {!snapshot ? (
        <p role="status">Conectando con la oficina…</p>
      ) : (
        <>
          {snapshot.library && (
            <SavedConversations library={snapshot.library} busy={busy} action={action} />
          )}
          <details open={!snapshot.library} className="mb-8">
            <summary>Opciones del equipo</summary>
            <div className="flex flex-wrap gap-8 mb-8">
              <label>
                Asignación{' '}
                <select
                  className={field}
                  aria-label="Modo de asignación"
                  value={snapshot.settings.mode}
                  disabled={!!active}
                  onChange={(event) =>
                    void action('settings', { ...snapshot.settings, mode: event.target.value })
                  }
                >
                  <option value="auto">Automático</option>
                  <option value="manual">Manual</option>
                  <option value="mixed">Mixto: confirmar propuestas</option>
                </select>
              </label>
              <label className="flex items-center gap-4">
                <input
                  type="checkbox"
                  checked={snapshot.settings.claudeEnabled}
                  disabled={!!active}
                  onChange={(event) =>
                    void action('settings', {
                      ...snapshot.settings,
                      claudeEnabled: event.target.checked,
                    })
                  }
                />{' '}
                Habilitar comprobación de Claude
              </label>
            </div>
            <details className="border border-border p-4 mb-8">
              <summary>Organización del trabajo · un Programador por defecto</summary>
              <p className="my-4">
                Motor actual:{' '}
                {snapshot.capabilities?.engine === 'agent-orchestrator'
                  ? 'Agent Orchestrator'
                  : snapshot.capabilities
                    ? 'Codex CLI'
                    : 'no comunicado'}
                . Aislamiento de escritores:{' '}
                {snapshot.capabilities?.isolatedWriters ? 'disponible' : 'no disponible'}.
              </p>
              <label className="block">
                <input
                  type="checkbox"
                  aria-label="Activar dos Programadores experimentales"
                  checked={snapshot.settings.experimentalParallelWriters === true}
                  disabled={
                    !!active ||
                    (!snapshot.capabilities?.isolatedWriters &&
                      !snapshot.settings.experimentalParallelWriters)
                  }
                  onChange={(event) =>
                    void action('settings', {
                      ...snapshot.settings,
                      experimentalParallelWriters: event.target.checked,
                    })
                  }
                />{' '}
                Activar dos Programadores experimentales
              </label>
              <p className="text-text-muted mt-4">
                Activarlo permite proponer repartos; no garantiza concurrencia ni inicia llamadas.
                Requiere AO seleccionado y aislamiento disponible. Se mantienen el límite de dos
                ejecuciones, las pruebas y el presupuesto. Este control no cambia de motor.
              </p>
            </details>
            <Button disabled={busy} onClick={() => void action('check')}>
              Comprobar suscripciones y modelos
            </Button>
            <div className="my-8 space-y-4">
              {snapshot.providers.length === 0 && (
                <p>Codex disponible para comprobar. Claude desactivado inicialmente.</p>
              )}
              {snapshot.providers.map((provider) => (
                <p key={provider.provider}>
                  <strong>{provider.provider === 'codex' ? 'Codex' : 'Claude'}: </strong>
                  {provider.message}
                </p>
              ))}
            </div>
            <details className="border border-border p-4 mb-8">
              <summary>
                Límites y consumo · {snapshot.runsUsed}/{snapshot.settings.maxRuns} llamadas ·{' '}
                {snapshot.tokensUsed.toLocaleString()} tokens comunicados
              </summary>
              <div className="grid grid-cols-2 gap-8 mt-8">
                {(
                  [
                    ['maxRuns', 'Llamadas', 1, 20],
                    ['maxParallel', 'Simultáneas', 1, 2],
                    ['maxMinutes', 'Minutos por tanda', 1, 15],
                    ['maxTokens', 'Presupuesto de tokens', 1000, 200000],
                  ] as const
                ).map(([key, label, min, max]) => (
                  <label key={key}>
                    {label}
                    <input
                      aria-label={label}
                      className={field}
                      type="number"
                      min={min}
                      max={max}
                      defaultValue={snapshot.settings[key]}
                      key={`${key}-${snapshot.settings[key]}`}
                      disabled={!!active}
                      onBlur={(event) => {
                        const value = Number(event.target.value);
                        if (value !== snapshot.settings[key])
                          void action('settings', { ...snapshot.settings, [key]: value });
                      }}
                    />
                  </label>
                ))}
              </div>
              <p className="mt-8 text-text-muted">
                Los tokens se comprueban entre llamadas con el consumo comunicado. Una respuesta
                puede superar el presupuesto. No es un importe en euros. Un Programador por defecto;
                dos escritores requieren activación experimental y aislamiento acreditado.
              </p>
              <p>
                Tiempo de pared: {((snapshot.elapsedMs ?? 0) / 1000).toFixed(1)} s · suma de
                duraciones: {((snapshot.timeUsedMs ?? 0) / 1000).toFixed(1)} s. Consumo total:{' '}
                {snapshot.usageKnown === false
                  ? 'desconocido; el contador no es un total definitivo'
                  : snapshot.usageKnown === true
                    ? 'conocido'
                    : 'no comunicado'}
                .
              </p>
            </details>
          </details>
          <div className="border border-border p-8 mb-8 space-y-8">
            {snapshot.library && (
              <label className="block">
                Proyectos guardados
                <select
                  aria-label="Proyectos guardados"
                  className={field}
                  value={snapshot.library.projects.some((p) => p.path === project) ? project : ''}
                  onChange={(e) => {
                    const saved = snapshot.library?.projects.find((p) => p.path === e.target.value);
                    if (saved) {
                      setProject(saved.path);
                      setProjectName(saved.name);
                      setInstructions(saved.instructions);
                      void action('projects', { project: saved.path });
                    }
                  }}
                >
                  <option value="">Elige o guarda un proyecto</option>
                  {snapshot.library.projects.map((p) => (
                    <option key={p.id} value={p.path}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block">
              Carpeta del proyecto
              <input
                aria-label="Carpeta del proyecto"
                disabled={busy}
                className={field}
                placeholder="Ruta completa de tu proyecto"
                value={project}
                onChange={(event) => setProject(event.target.value)}
              />
            </label>
            {snapshot.library && (
              <details className="border border-border p-4">
                <summary>Guardar proyecto e instrucciones</summary>
                <label className="block my-4">
                  Nombre del proyecto
                  <input
                    aria-label="Nombre del proyecto"
                    className={field}
                    maxLength={160}
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                  />
                </label>
                <label className="block my-4">
                  Instrucciones para este proyecto
                  <textarea
                    aria-label="Instrucciones del proyecto"
                    className={field}
                    rows={3}
                    maxLength={8000}
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                  />
                </label>
                <Button
                  disabled={!!active || !project.trim() || !snapshot.library.writable}
                  onClick={() =>
                    void action('projects', {
                      project,
                      name: projectName.trim() || undefined,
                      instructions,
                    })
                  }
                >
                  Guardar proyecto
                </Button>
                <ProjectChecksApproval
                  key={`${snapshot.library.selectedProjectId}-${snapshot.library.checks?.fingerprint}`}
                  library={snapshot.library}
                  busy={!!active}
                  action={action}
                />
              </details>
            )}
            <label className="block">
              Qué quieres conseguir
              <textarea
                aria-label="Objetivo o tarea"
                disabled={busy}
                className={field}
                rows={3}
                maxLength={12000}
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
              />
            </label>
            {snapshot.library && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-4">
                  <Button
                    disabled={
                      busy ||
                      !goal.trim() ||
                      !snapshot.library.selected ||
                      !snapshot.library.writable ||
                      snapshot.library.projects.find(
                        (p) => p.id === snapshot.library?.selected?.projectId,
                      )?.path !== project
                    }
                    onClick={() =>
                      void action('conversations/message', {
                        id: snapshot.library!.selected!.id,
                        message: goal,
                        allowWrites,
                      }).then((ok) => {
                        if (ok) setGoal('');
                      })
                    }
                  >
                    Enviar mensaje
                  </Button>
                  <Button
                    disabled={busy || !snapshot.library.selected || !snapshot.library.writable}
                    onClick={() =>
                      void action('conversations/draft', {
                        id: snapshot.library!.selected!.id,
                        draft: goal,
                      })
                    }
                  >
                    Guardar borrador
                  </Button>
                </div>
                <p className="text-text-muted">
                  Enviar guarda el mensaje y prepara el encargo. Pulsa Ejecutar cola cuando quieras
                  iniciarlo. Puedes leer y descargar las conversaciones aunque la carpeta del
                  proyecto ya no esté disponible.
                </p>
              </div>
            )}
            <label className="flex items-center gap-4">
              <input
                type="checkbox"
                checked={allowWrites}
                onChange={(event) => setAllowWrites(event.target.checked)}
              />{' '}
              Permitir cambios en archivos (para el Programador del plan)
            </label>
            <details open={!snapshot.library}>
              <summary>Más opciones para este encargo</summary>
              <div className="flex flex-wrap gap-4">
                <Button
                  disabled={
                    !!active ||
                    !project.trim() ||
                    !goal.trim() ||
                    snapshot.settings.mode === 'manual'
                  }
                  onClick={() => void action('plan', { project, goal, allowWrites })}
                >
                  Pedir plan al Jefe · 1 llamada
                </Button>
              </div>
              <div className="flex flex-wrap gap-4 items-end">
                <label>
                  Asignar directamente
                  <select
                    aria-label="Personaje para tarea directa"
                    className={field}
                    value={role}
                    onChange={(event) => setRole(event.target.value as TeamRole)}
                  >
                    {Object.entries(TEAM_ROLES).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  disabled={busy || !project.trim() || !goal.trim()}
                  onClick={() =>
                    void action('tasks', {
                      project,
                      prompt: goal,
                      title: goal.slice(0, 120),
                      role,
                      allowWrites,
                    }).then((ok) => {
                      if (ok) setGoal('');
                    })
                  }
                >
                  Añadir tarea sin plan
                </Button>
              </div>
            </details>
          </div>
          <TeamScopeForm
            key={snapshot.library?.selectedProjectId ?? 'legacy'}
            project={project}
            goal={goal}
            allowWrites={allowWrites}
            snapshot={snapshot}
            disabled={!!active}
            action={action}
          />
          {snapshot.settings.mode === 'manual' && (
            <p>
              En modo manual, añade las tareas directamente y elige su modelo antes de ejecutarlas.
            </p>
          )}
          {planning && (
            <p role="status">El Jefe está preparando el plan mediante el CLI oficial…</p>
          )}
          <div className="flex flex-wrap gap-4 mb-8">
            <Button
              variant="accent"
              disabled={!!active || snapshot.tasks.length === 0 || !!snapshot.budgetReason}
              onClick={() => void action('start')}
            >
              Ejecutar cola
            </Button>
            <Button disabled={busy} onClick={() => void action('pause')}>
              Pausar equipo
            </Button>
            {snapshot.budgetReason && !snapshot.workflows?.some((w) => w.status === 'paused') && (
              <Button disabled={!!active} onClick={() => void action('resume')}>
                Revisado: permitir continuar
              </Button>
            )}
          </div>
          {snapshot.library && (
            <p className="text-text-muted">
              La cola reúne los encargos de todas las conversaciones. Puedes revisarlos en «Encargos
              y comprobaciones» antes de ejecutarlos.
            </p>
          )}
          {snapshot.budgetReason && (
            <p role="status">
              Equipo en pausa: {snapshot.budgetReason}. No se cambiará a ningún sistema de pago.
            </p>
          )}
          <details open={!snapshot.library} className="mt-8">
            <summary>Encargos y comprobaciones</summary>
            {!!snapshot.workflows?.length && (
              <section aria-label="Flujos e integración">
                <strong>Flujos e integración</strong>
                {snapshot.workflows.map((workflow) => (
                  <TeamWorkflowCard
                    key={workflow.id}
                    workflow={workflow}
                    snapshot={snapshot}
                    disabled={!!active}
                    action={action}
                  />
                ))}
              </section>
            )}
            <div className={board ? 'grid gap-8 md:grid-cols-2' : 'space-y-8'}>
              {snapshot.tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  snapshot={snapshot}
                  busy={busy}
                  active={!!active}
                  action={action}
                />
              ))}
            </div>
            {snapshot.tasks.length === 0 && (
              <p>Añade una tarea o pide al Jefe un plan. Nada se ejecuta al abrir el panel.</p>
            )}
          </details>
          <p className="text-text-muted mt-8">
            {snapshot.library ? 'Las conversaciones se guardan en este equipo. ' : ''}
            Se conservan cola, resultados y consumo cuando hay almacenamiento configurado. Al
            reiniciar, los flujos requieren revisión y no recuperan aceptación automáticamente.
            Coordinación adaptada de Claw-Empire (Apache-2.0).
          </p>
        </>
      )}
    </section>
  );
}

function TaskCard({
  task,
  snapshot,
  busy,
  active,
  action,
}: {
  task: TeamTask;
  snapshot: TeamSnapshot;
  busy: boolean;
  active: boolean;
  action: (path: string, body?: unknown) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState<TeamChoice>(
    task.override ?? task.choice ?? { provider: 'codex', model: '', effort: '' },
  );
  const models =
    snapshot.providers.find((provider) => provider.provider === choice.provider)?.models ?? [];
  const efforts = models.find((model) => model.id === choice.model)?.efforts ?? [];
  const locked = ['checking', 'running', 'completed', 'cancelled'].includes(task.status);
  return (
    <article
      className="border border-border p-8"
      aria-label={`${TEAM_ROLES[task.role]}: ${task.title}`}
    >
      <div className="flex justify-between gap-8">
        <strong>{TEAM_ROLES[task.role]}</strong>
        <span>{statuses[task.status]}</span>
      </div>
      <p className="my-4">{task.title}</p>
      <p className="text-accent-bright">
        {task.choice
          ? `Solicitado: ${task.choice.provider} · ${task.choice.model} · ${task.choice.effort}`
          : 'Sin modelo asignado'}
      </p>
      {task.runId && (
        <p className="text-text-muted">
          Modelo confirmado por el CLI: {task.confirmedModel ?? 'no comunicado'}
        </p>
      )}
      <p className="text-text-muted my-4">{task.explanation}</p>
      <p className="text-text-muted my-4">Orden de trabajo: {task.scheduleReason}</p>
      <p>
        {task.allowWrites ? 'Cambios en archivos permitidos' : 'Solo lectura'}
        {task.dependsOn.length ? ` · Depende de ${task.dependsOn.length} tarea(s)` : ''}
      </p>
      {task.reasonCode && <p className="text-warning">Motivo: {task.reasonCode}</p>}
      <details className="mt-4">
        <summary>Trabajador, archivos y comprobaciones</summary>
        <p className="break-words">
          Trabajador: {task.workerId ?? 'no comunicado'} · flujo: {task.workflowId ?? 'individual'}
        </p>
        {task.executionProject && (
          <p className="break-words">Carpeta de ejecución: {task.executionProject}</p>
        )}
        <p>Archivos propios: {task.ownedFiles?.join(', ') || 'sin reparto aislado'}</p>
        <p>
          Dependencias:{' '}
          {task.dependsOn
            .map((id) => snapshot.tasks.find((t) => t.id === id)?.title ?? id)
            .join(', ') || 'ninguna'}
        </p>
        {task.context && (
          <>
            <p>Criterios: {task.context.acceptance.join('; ')}</p>
            <p>
              Comprobaciones requeridas: {task.context.checks.join(', ') || 'ninguna configurada'}
            </p>
          </>
        )}
        {task.localChecks?.map((c, i) => (
          <p key={`${c.id}-${i}`}>
            {c.id}: {c.passed ? 'Superada' : 'Fallida'} · {c.durationMs} ms
          </p>
        ))}
      </details>
      <TaskBudgetControl task={task} snapshot={snapshot} disabled={active} action={action} />
      <div className="flex flex-wrap gap-4 my-4">
        {!locked && (
          <>
            <Button disabled={busy} onClick={() => void action('assign', { id: task.id })}>
              Comprobar asignación
            </Button>
            <Button disabled={busy} onClick={() => setEditing((value) => !value)}>
              Cambiar modelo
            </Button>
          </>
        )}
        {!locked && task.choice && snapshot.settings.mode !== 'auto' && !task.approved && (
          <Button disabled={busy} onClick={() => void action('approve', { id: task.id })}>
            Confirmar asignación
          </Button>
        )}
        {task.approved && <span>Asignación confirmada</span>}
        {!['completed', 'cancelled'].includes(task.status) && (
          <Button disabled={busy} onClick={() => void action('cancel', { id: task.id })}>
            Cancelar tarea
          </Button>
        )}
      </div>
      {editing && !locked && (
        <div className="space-y-4">
          <label className="block">
            Proveedor
            <select
              aria-label={`Proveedor de ${task.title}`}
              className={field}
              value={choice.provider}
              onChange={(event) =>
                setChoice({
                  provider: event.target.value as TeamChoice['provider'],
                  model: '',
                  effort: '',
                })
              }
            >
              <option value="codex">Codex</option>
              <option value="claude">Claude</option>
            </select>
          </label>
          <label className="block">
            Modelo
            <select
              aria-label={`Modelo de ${task.title}`}
              className={field}
              value={choice.model}
              onChange={(event) => setChoice({ ...choice, model: event.target.value, effort: '' })}
            >
              <option value="">Elige un modelo verificado</option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.id}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            Razonamiento
            <select
              aria-label={`Razonamiento de ${task.title}`}
              className={field}
              value={choice.effort}
              onChange={(event) => setChoice({ ...choice, effort: event.target.value })}
            >
              <option value="">Elige nivel</option>
              {efforts.map((effort) => (
                <option key={effort} value={effort}>
                  {effort}
                </option>
              ))}
            </select>
          </label>
          <Button
            disabled={busy || !choice.model || !choice.effort}
            onClick={() =>
              void action('override', { id: task.id, choice }).then((ok) => {
                if (ok) setEditing(false);
              })
            }
          >
            Guardar elección manual
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              void action('override', { id: task.id, choice: null }).then((ok) => {
                if (ok) setEditing(false);
              })
            }
          >
            Volver a automático
          </Button>
        </div>
      )}
      {!!task.output && (
        <details className="mt-4">
          <summary>Ver respuesta</summary>
          <pre className="whitespace-pre-wrap break-words text-sm p-4">{task.output}</pre>
        </details>
      )}
    </article>
  );
}
