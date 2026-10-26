import { useEffect, useState } from 'react';

import type { TeamTask } from '../../../core/src/team.js';

function activityTitle(title: string, detail?: string): string {
  if (title !== 'Usando una herramienta' || !detail) return title;
  try {
    const tool = JSON.parse(detail).tool;
    return typeof tool === 'string' && /^[\w./:-]{1,160}$/.test(tool) ? `${title}: ${tool}` : title;
  } catch {
    return title;
  }
}

export function LiveOfficeActivity({
  tasks,
  working,
  waiting,
}: {
  tasks: TeamTask[];
  working: boolean;
  waiting: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [working]);
  const events = tasks
    .flatMap((t) =>
      (t.liveActivity ?? []).map((e) => ({
        ...e,
        title: activityTitle(e.title, e.detail),
        completed: e.completed || !['running', 'checking'].includes(t.status),
        role: t.role,
      })),
    )
    .sort((a, b) => a.at - b.at);
  const active = events.filter((e) => !e.completed).at(-1);
  const latest = events.at(-1);
  if (!working && !events.length) return null;
  const title = waiting
    ? 'Esperando tu confirmación'
    : (active?.title ?? (working ? 'Esperando la respuesta del empleado' : 'Actividad finalizada'));
  const elapsed = active ? Math.max(0, Math.floor((now - active.at) / 1000)) : 0;
  return (
    <section className="chat-live-activity" aria-label="Actividad en directo">
      <details>
        <summary>
          <span aria-hidden="true">{working ? '· ·' : '✓'}</span>{' '}
          <span className={working && !waiting ? 'chat-live-shimmer' : ''}>{title}</span>
          {working && active && <span className="chat-live-time"> {elapsed}s</span>}
        </summary>
        <ol>
          {events.map((e, index) => {
            const nextThinking = events.findIndex(
              (event, i) => i > index && event.title === 'Pensando',
            );
            const observed =
              e.title === 'Pensando' && !e.detail
                ? events
                    .slice(index + 1, nextThinking < 0 ? undefined : nextThinking)
                    .filter((event) => event.detail)
                : [];
            return (
              <li key={e.role + e.id}>
                <details open={!e.completed}>
                  <summary>
                    {e.completed ? '✓' : '◷'} {e.title}
                  </summary>
                  {e.detail ? (
                    <pre>{e.detail}</pre>
                  ) : observed.length ? (
                    <>
                      <p>Actividad observada después de esta fase:</p>
                      {observed.map((event) => (
                        <div key={event.id}>
                          <strong>{event.title}</strong>
                          <pre>{event.detail}</pre>
                        </div>
                      ))}
                    </>
                  ) : (
                    <p>
                      {e.title === 'Pensando'
                        ? e.completed
                          ? 'Esta fase ha terminado sin resumen público. Las búsquedas, comandos y resultados comunicados aparecen en la actividad; el razonamiento interno no está disponible.'
                          : 'El empleado está procesando el encargo. Aquí aparecerá su resumen público cuando lo comunique y las acciones que realice después; el razonamiento interno no está disponible.'
                        : e.completed
                          ? 'Operación finalizada. No se recibió contenido adicional para este evento.'
                          : 'Esperando los datos de esta operación: se mostrarán cuando lleguen del ejecutor.'}
                    </p>
                  )}
                </details>
              </li>
            );
          })}
        </ol>
        {!events.length && <p>Esperando los primeros eventos del ejecutor.</p>}
      </details>
      {working && active?.title === 'Pensando' && active.detail && (
        <p className="chat-live-thought">{active.detail}</p>
      )}
      {working && (
        <p>
          {waiting
            ? 'Siguiente paso: revisar la acción solicitada.'
            : active
              ? 'Después: recibir el resultado de esta actividad.'
              : latest
                ? 'Siguiente paso: esperar la siguiente actividad del ejecutor.'
                : 'Siguiente paso: recibir la primera actividad del ejecutor.'}
        </p>
      )}
    </section>
  );
}
