import { useEffect, useState } from 'react';

import type { OfficeOperationReview } from '../../../core/src/officeTools.js';
import { Button } from './ui/Button.js';

type Outcome = 'completed' | 'not_completed';
export function OperationReviewList({
  operations,
  running,
  busy,
  onReview,
  onOpenConversation,
}: {
  operations: OfficeOperationReview[];
  running: boolean;
  busy: boolean;
  onReview: (id: string, outcome: Outcome) => void;
  onOpenConversation?: (id: string) => void;
}) {
  if (!operations.length)
    return <p>No hay resultados inciertos pendientes en los recibos consultados.</p>;
  return (
    <>
      <p>
        Comprueba la solicitud original y el destino. Confirma solo si puedes identificar esta
        operación. Registrar tu revisión no reanuda la oficina ni repite la operación; las nuevas
        acciones mantienen su aprobación.
      </p>
      {running && (
        <p>
          Puedes revisar los resultados cerrados mientras la oficina sigue trabajando. Las
          operaciones sin recibo cerrado tendrán que esperar.
        </p>
      )}
      {operations.map((operation) => (
        <article key={operation.id}>
          <strong>{operation.action}</strong>
          {operation.description && <p>{operation.description}</p>}
          <p>Destino: {operation.destination}</p>
          {operation.conversationId && onOpenConversation ? (
            <Button disabled={busy} onClick={() => onOpenConversation(operation.conversationId!)}>
              Ver conversación original
            </Button>
          ) : (
            <p>
              La conversación original no consta en este recibo. Busca su referencia en el historial
              antes de confirmar.
            </p>
          )}
          {operation.occurredAt && (
            <p>Último registro: {new Date(operation.occurredAt).toLocaleString('es-ES')}</p>
          )}
          <details>
            <summary>Referencia de la operación</summary>
            <p>
              {operation.diagnostic ??
                'La causa del resultado incierto no consta acreditada en este recibo.'}
            </p>
            {operation.failureStage && (
              <p>
                Fase:{' '}
                {operation.failureStage === 'request'
                  ? 'solicitud enviada, sin confirmación de respuesta'
                  : 'respuesta recibida, sin verificación final'}
                .
              </p>
            )}
            <p>
              Recibo: <code>{operation.receiptId}</code>
            </p>
            <code>{operation.reference}</code>
            <p>
              El recibo conserva una huella de los datos, no su contenido completo. Consulta la
              solicitud original antes de decidir.
            </p>
          </details>
          {operation.review ? (
            <p>
              Revisada por ti:{' '}
              {operation.review.outcome === 'completed' ? 'se realizó' : 'no se realizó'}. El recibo
              original se conserva.
            </p>
          ) : (
            <>
              <p>¿Has comprobado si esta operación llegó a realizarse?</p>
              <div className="chat-actions">
                <Button
                  disabled={busy || (running && operation.originalStatus === 'dispatching')}
                  onClick={() => onReview(operation.id, 'completed')}
                >
                  Sí, he comprobado que se realizó
                </Button>
                <Button
                  disabled={busy || (running && operation.originalStatus === 'dispatching')}
                  onClick={() => onReview(operation.id, 'not_completed')}
                >
                  He comprobado que no se realizó
                </Button>
              </div>
              <p>Si todavía no lo sabes, déjala pendiente. No se repetirá automáticamente.</p>
            </>
          )}
        </article>
      ))}
    </>
  );
}

export function OfficeOperationReviews({
  busy,
  running,
  action,
}: {
  busy: boolean;
  running: boolean;
  action: (path: string, body?: unknown) => Promise<boolean>;
}) {
  const [operations, setOperations] = useState<OfficeOperationReview[] | null>(null);
  const [loading, setLoading] = useState(true),
    [reviewing, setReviewing] = useState(false),
    [error, setError] = useState('');
  async function load(signal?: AbortSignal) {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/team/tool-operations', { cache: 'no-store', signal });
      if (!response.ok) throw new Error('load');
      const data = (await response.json()) as { operations: OfficeOperationReview[] };
      if (!Array.isArray(data.operations)) throw new Error('load');
      if (!signal?.aborted) setOperations(data.operations);
    } catch {
      if (!signal?.aborted)
        setError(
          'No se pudieron consultar los recibos. No se ha solicitado ejecutar ni repetir ninguna operación.',
        );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, []);
  async function review(id: string, outcome: Outcome) {
    if (busy || reviewing || loading) return;
    setReviewing(true);
    setError('');
    try {
      if (
        await action(`tool-operations/${encodeURIComponent(id)}/review`, {
          reviewed: true,
          outcome,
        })
      )
        await load();
      else
        setError(
          'No se pudo registrar o confirmar la revisión. Actualiza para comprobar su estado.',
        );
    } catch {
      setError('No se pudo registrar o confirmar la revisión. Actualiza para comprobar su estado.');
    } finally {
      setReviewing(false);
    }
  }
  return (
    <section className="chat-operation-reviews" aria-label="Revisión de resultados inciertos">
      <div className="chat-actions">
        <h3>Resultados que necesitan revisión</h3>
        <Button disabled={busy || loading || reviewing} onClick={() => void load()}>
          Actualizar recibos
        </Button>
      </div>
      {loading && <p>Consultando recibos…</p>}
      {error && <p role="alert">{error}</p>}
      {operations && (
        <OperationReviewList
          operations={operations}
          running={running}
          busy={busy || loading || reviewing}
          onReview={(id, outcome) => void review(id, outcome)}
          onOpenConversation={(id) => {
            void action('conversations/select', { id })
              .then((ok) => {
                if (!ok) setError('No se pudo abrir la conversación original.');
              })
              .catch(() => setError('No se pudo abrir la conversación original.'));
          }}
        />
      )}
    </section>
  );
}
