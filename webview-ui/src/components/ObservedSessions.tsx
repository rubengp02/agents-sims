import { useEffect, useRef } from 'react';

import type { OfficePresenceSnapshot } from '../../../core/src/officePresence.js';
import { Button } from './ui/Button.js';

export function ObservedSessions({
  presence,
  error,
  onClose,
}: {
  presence: OfficePresenceSnapshot | null;
  error: string;
  onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <section
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Otras sesiones de Codex"
        className="pixel-panel bg-bg text-text p-12"
        style={{ width: 'min(560px, 95vw)', maxHeight: '80vh', overflowY: 'auto' }}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
          if (event.key === 'Tab') {
            event.preventDefault();
            panel.current?.querySelector('button')?.focus();
          }
        }}
      >
        <h2>Otras sesiones de Codex</h2>
        <p>
          Son sesiones detectadas fuera del equipo del Jefe. No son empleados de tus encargos y no
          ocupan puestos en la oficina.
        </p>
        {error && <p role="alert">{error}</p>}
        {!presence ? (
          <p>Cargando sesiones…</p>
        ) : !presence.sessions.length ? (
          <p>No hay otras sesiones detectadas.</p>
        ) : (
          <ul>
            {presence.sessions.map((session) => (
              <li key={session.id} className="my-8">
                <strong>
                  {session.name} · {session.project}
                </strong>
                <div>{session.status}</div>
              </li>
            ))}
          </ul>
        )}
        <Button onClick={onClose}>Volver a la oficina</Button>
      </section>
    </div>
  );
}
