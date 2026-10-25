import { useState } from 'react';

import type { OfficeAuthentication as Authentication } from '../../../core/src/officeTools.js';
import { Button } from './ui/Button.js';

function authenticationLink(entry: Authentication): string | null {
  if (entry.status !== 'awaiting_user' || entry.expiresAt <= Date.now() || !entry.authorizationUrl)
    return null;
  try {
    const url = new URL(entry.authorizationUrl);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash
      ? url.href
      : null;
  } catch {
    return null;
  }
}
const labels: Record<Authentication['status'], string> = {
  awaiting_user: 'Esperando inicio de sesión',
  verifying: 'Comprobando autorización',
  authenticated: 'Inicio de sesión confirmado',
  failed: 'No se pudo confirmar',
  cancelled: 'Autorización cancelada',
  expired: 'Autorización caducada',
};
export function OfficeAuthentication({
  entries,
  busy,
  action,
}: {
  entries: Authentication[];
  busy: boolean;
  action: (path: string, body?: unknown) => Promise<boolean>;
}) {
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState<string | null>(null);
  if (!entries.length) return null;
  return (
    <section
      className="chat-tool-approvals"
      aria-label="Inicio de sesión de herramientas"
      aria-live="polite"
    >
      {entries.map((entry, index) => {
        const link = authenticationLink(entry),
          active = ['awaiting_user', 'verifying'].includes(entry.status);
        const content = (
          <article key={entry.id}>
            <strong>
              {entry.service} ·{' '}
              {entry.kind === 'application' && entry.status === 'authenticated'
                ? 'Conexión confirmada por Codex'
                : entry.kind === 'application' && entry.status === 'failed'
                  ? 'Herramientas no disponibles en Codex'
                  : labels[entry.status]}
            </strong>
            <p>{entry.reason}</p>
            {link && (
              <p>
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                >
                  {entry.kind === 'application' ? 'Conectar en' : 'Iniciar sesión en'}{' '}
                  {new URL(link).hostname}
                </a>
              </p>
            )}
            {active && (
              <>
                <p>
                  {entry.kind === 'application'
                    ? 'Completa la conexión en la página oficial y vuelve para comprobarla. La oficina continuará cuando Codex confirme herramientas permitidas.'
                    : 'Introduce tus credenciales únicamente en la página del proveedor. La oficina continuará cuando Codex confirme el resultado.'}
                </p>
                {entry.kind === 'application' && entry.status === 'awaiting_user' && (
                  <Button
                    disabled={busy || !!cancelling}
                    onClick={() => {
                      setCancelling(entry.id);
                      setError('');
                      void action(`authentication/${encodeURIComponent(entry.id)}/check`, {})
                        .then((ok) => {
                          if (!ok) setError('No se pudo comprobar la conexión.');
                        })
                        .catch(() => setError('No se pudo comprobar la conexión.'))
                        .finally(() => setCancelling(null));
                    }}
                  >
                    Ya he conectado, comprobar
                  </Button>
                )}
                <Button
                  disabled={busy || !!cancelling}
                  onClick={() => {
                    setCancelling(entry.id);
                    setError('');
                    void action(`authentication/${encodeURIComponent(entry.id)}/cancel`, {})
                      .then((ok) => {
                        if (!ok) setError('No se pudo cancelar. Comprueba el estado actual.');
                      })
                      .catch(() => setError('No se pudo cancelar. Comprueba el estado actual.'))
                      .finally(() => setCancelling(null));
                  }}
                >
                  Cancelar inicio de sesión
                </Button>
              </>
            )}
          </article>
        );
        const previousAttempt =
          ['expired', 'cancelled', 'failed'].includes(entry.status) &&
          entries
            .slice(index + 1)
            .some((next) => next.service === entry.service && next.kind === entry.kind);
        return previousAttempt ? (
          <details key={entry.id}>
            <summary>{entry.service} · Intento anterior</summary>
            {content}
          </details>
        ) : (
          content
        );
      })}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
