import { useState } from 'react';

import type { PendingConversationInput } from '../../../core/src/conversations.js';
import { ArtifactGallery } from './ArtifactGallery.js';
import { Button } from './ui/Button.js';

type Action = (path: string, body?: unknown) => Promise<boolean>;

export function PendingConversationInputs({
  conversationId,
  inputs,
  hold,
  busy,
  canSteer,
  working,
  action,
}: {
  conversationId: string;
  inputs: PendingConversationInput[];
  hold: boolean;
  busy: boolean;
  canSteer: boolean;
  working: boolean;
  action: Action;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  if (!inputs.length) return null;
  return (
    <section className="chat-pending-inputs" aria-label="Mensajes pendientes">
      <h2>
        {inputs.length === 1 ? 'Mensaje pendiente' : `${inputs.length} mensajes pendientes`} ·
        después de la entrega del Jefe
      </h2>
      {hold && <p>Los pendientes están detenidos. Revisa el estado antes de continuar.</p>}
      {inputs.map((input) => (
        <article key={input.id} aria-label="Mensaje pendiente">
          {editing === input.id ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void action('conversations/queue/update', {
                  id: conversationId,
                  inputId: input.id,
                  revision: input.revision,
                  message: draft,
                }).then((ok) => {
                  if (ok) setEditing(null);
                });
              }}
            >
              <textarea
                aria-label="Editar mensaje pendiente"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={12000}
                disabled={busy}
              />
              <div className="chat-actions">
                <Button
                  type="submit"
                  disabled={busy || !draft.trim() || input.status === 'dispatching'}
                >
                  Guardar cambios
                </Button>
                <Button type="button" onClick={() => setEditing(null)}>
                  Cancelar edición
                </Button>
              </div>
            </form>
          ) : (
            <pre>{input.content}</pre>
          )}
          <ArtifactGallery artifacts={input.attachments} label="Imágenes del mensaje pendiente" />
          {input.status === 'dispatching' && <p role="status">Enviando…</p>}
          {input.reason && (
            <p>
              {input.reason === 'delivery_unknown'
                ? 'No se pudo confirmar la entrega. Revisa el resultado y retira este pendiente antes de enviar otra vez.'
                : input.reason === 'queue_dispatch_failed'
                  ? 'El mensaje no pudo iniciarse. Puedes revisarlo y editarlo.'
                  : 'Este mensaje necesita revisión antes de continuar.'}
            </p>
          )}
          {editing !== input.id && input.status !== 'dispatching' && (
            <div className="chat-actions">
              <Button
                disabled={busy}
                onClick={() => {
                  setEditing(input.id);
                  setDraft(input.content);
                }}
              >
                Editar
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void action('conversations/queue/remove', {
                    id: conversationId,
                    inputId: input.id,
                    revision: input.revision,
                  })
                }
              >
                Retirar
              </Button>
              <Button
                disabled={busy || !canSteer || !working || input.status === 'needs_review'}
                title={
                  !canSteer
                    ? 'Este motor no permite incorporar indicaciones durante el trabajo.'
                    : 'Incorporar esta indicación al objetivo actual'
                }
                aria-label="Aplicar ahora el mensaje pendiente"
                onClick={() =>
                  void action('conversations/apply-now', {
                    id: conversationId,
                    inputId: input.id,
                    revision: input.revision,
                  })
                }
              >
                ↑ Aplicar ahora
              </Button>
            </div>
          )}
        </article>
      ))}
      {hold && (
        <Button
          disabled={busy || working || inputs.some((input) => input.status !== 'queued')}
          onClick={() => void action('conversations/queue/continue', { id: conversationId })}
        >
          Continuar pendientes
        </Button>
      )}
    </section>
  );
}
