import { useState } from 'react';

import type { ConversationLibrarySnapshot } from '../../../core/src/conversations.js';
import { TEAM_ROLES } from '../../../core/src/team.js';
import { Button } from './ui/Button.js';

const status: Record<string, string> = {
  planned: 'Pendiente de ejecutar',
  queued: 'En cola',
  checking: 'Comprobando',
  running: 'Trabajando',
  completed: 'Respuesta terminada',
  paused: 'En pausa',
  blocked: 'Necesita revisión',
  failed: 'Error',
  cancelled: 'Cancelada',
};

export function SavedConversations({
  library,
  busy,
  action,
}: {
  library: ConversationLibrarySnapshot;
  busy: boolean;
  action: (path: string, body?: unknown) => Promise<boolean>;
}) {
  const [search, setSearch] = useState('');
  const selected = library.selected;
  const project = library.projects.find((p) => p.id === library.selectedProjectId);
  const conversations = library.conversations.filter((c) =>
    `${c.title} ${library.projects.find((p) => p.id === c.projectId)?.name ?? ''}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase()),
  );
  return (
    <div className="border border-border p-8 mb-8 space-y-8" aria-label="Conversaciones guardadas">
      <strong>Conversaciones guardadas</strong>
      {library.warning && <p role="alert">{library.warning}</p>}
      <label className="block">
        Buscar conversación
        <input
          aria-label="Buscar conversación"
          className="w-full bg-bg border border-border p-4 text-text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <label className="block">
        Abrir conversación
        <select
          aria-label="Abrir conversación"
          className="w-full bg-bg border border-border p-4 text-text"
          value={selected?.id ?? ''}
          disabled={busy || !library.writable}
          onChange={(e) => {
            if (e.target.value) void action('conversations/select', { id: e.target.value });
          }}
        >
          <option value="">Elige una conversación</option>
          {conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title} · {library.projects.find((p) => p.id === c.projectId)?.name}
            </option>
          ))}
        </select>
      </label>
      <Button
        disabled={busy || !project || !library.writable}
        onClick={() => void action('conversations', { projectId: project!.id })}
      >
        Nueva conversación
      </Button>
      {!project && (
        <p>
          Guarda la carpeta de tu proyecto para empezar. Los mensajes se guardan en este equipo.
        </p>
      )}
      {selected && (
        <>
          <p>
            <strong>{selected.title}</strong> · {project?.name}
          </p>
          <div
            aria-label="Mensajes de la conversación"
            className="space-y-8 max-h-[360px] overflow-auto"
          >
            {selected.messages.map((m) => (
              <article
                key={m.id}
                className="border border-border p-4"
                aria-label={`${m.kind === 'request' ? 'Petición' : 'Respuesta'} de ${TEAM_ROLES[m.role]}`}
              >
                <p>
                  <strong>{m.kind === 'request' ? 'Petición' : TEAM_ROLES[m.role]}</strong>
                  {m.kind === 'response' ? ` · ${status[m.status] ?? m.status}` : ''}
                </p>
                <pre className="whitespace-pre-wrap break-words text-sm mt-4">
                  {m.content.replace(/^OFFICE_RESULT\s+\{[^\n]*\}\s*$/gm, '').trim() ||
                    (m.status === 'running'
                      ? 'Preparando la respuesta…'
                      : 'Todavía no hay respuesta.')}
                </pre>
                {m.kind === 'response' && m.reasonCode && (
                  <p className="text-text-muted">
                    {m.status === 'paused'
                      ? 'El trabajo está en pausa. Puedes revisar el encargo en la cola.'
                      : 'Revisa el estado del encargo en la cola.'}
                  </p>
                )}
              </article>
            ))}
            {!selected.messages.length && (
              <p>
                Escribe tu primer mensaje abajo. Volver a abrir esta conversación no inicia trabajo.
              </p>
            )}
          </div>
          <Button
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([JSON.stringify({ conversation: selected, project }, null, 2)], {
                  type: 'application/json',
                }),
              );
              const link = document.createElement('a');
              link.href = url;
              link.download = `conversacion-${selected.id}.json`;
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            Descargar conversación
          </Button>
        </>
      )}
    </div>
  );
}

export function ProjectChecksApproval({
  library,
  busy,
  action,
}: {
  library: ConversationLibrarySnapshot;
  busy: boolean;
  action: (path: string, body?: unknown) => Promise<boolean>;
}) {
  const catalog = library.checks;
  const [ids, setIds] = useState(catalog?.checks.filter((c) => c.approved).map((c) => c.id) ?? []);
  if (!catalog) return null;
  return (
    <details className="border border-border p-4 mt-8">
      <summary>Pruebas del proyecto</summary>
      <p className="my-4">{catalog.message}</p>
      {catalog.checks.map((c) => (
        <label key={c.id} className="block my-4">
          <input
            type="checkbox"
            aria-label={`Aprobar prueba ${c.id}`}
            checked={ids.includes(c.id)}
            disabled={busy || !library.writable}
            onChange={(e) =>
              setIds(e.target.checked ? [...ids, c.id] : ids.filter((id) => id !== c.id))
            }
          />{' '}
          {c.id} · {c.approved ? 'Aprobada' : 'Pendiente de tu aprobación'}
          <pre className="whitespace-pre-wrap break-words text-sm">{c.description}</pre>
        </label>
      ))}
      {!!catalog.checks.length && (
        <Button
          disabled={busy || !library.writable}
          onClick={() =>
            void action('projects/checks', {
              projectId: library.selectedProjectId,
              fingerprint: catalog.fingerprint,
              ids,
            })
          }
        >
          Guardar aprobación de pruebas
        </Button>
      )}
      <p className="text-text-muted my-4">
        Solo se ejecutarán las pruebas aprobadas que incluya el encargo. Si cambia su configuración,
        tendrás que revisarlas otra vez.
      </p>
    </details>
  );
}
