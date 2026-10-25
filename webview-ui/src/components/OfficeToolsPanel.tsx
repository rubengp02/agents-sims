import { useState } from 'react';

import type {
  OfficeCapabilityState,
  OfficeToolApproval,
  OfficeToolApprovalValues,
} from '../../../core/src/officeTools.js';
import type { TeamSnapshot } from '../../../core/src/team.js';
import { ConnectionReceipts } from './ConnectionReceipts.js';
import { OfficeOperationReviews } from './OfficeOperationReviews.js';
import { Button } from './ui/Button.js';

type Action = (path: string, body?: unknown) => Promise<boolean>;
const states: Record<OfficeCapabilityState, string> = {
  unverified: 'Sin comprobar',
  available: 'Lista',
  needs_connection: 'Requiere conexión',
  incompatible: 'No compatible',
  blocked: 'Bloqueada',
};
export function OfficeToolsPanel({
  snapshot,
  busy,
  action,
}: {
  snapshot: TeamSnapshot;
  busy: boolean;
  action: Action;
}) {
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState('');
  return (
    <section
      id="chat-office-tools"
      className="chat-tools-panel"
      aria-label="Herramientas y conexiones"
    >
      <div className="chat-actions">
        <h2>Herramientas y conexiones</h2>
        <Button disabled={busy} onClick={() => void action('tools/check')}>
          Comprobar herramientas
        </Button>
      </div>
      <p>
        Estas capacidades muestran su última comprobación. Las conexiones pendientes necesitan
        configurarse antes de usarlas.
      </p>
      {!!snapshot.connections?.length && (
        <section aria-label="Conexiones administradas">
          <h3>Conexiones administradas</h3>
          {snapshot.connections.map((connection) => (
            <article key={connection.id}>
              <strong>{connection.name}</strong>
              <p>{connection.url}</p>
              <p>
                {connection.engine === 'codex'
                  ? 'Conexión e inicio de sesión administrados por Codex.'
                  : 'Conexión HTTP directa.'}
              </p>
              <p>{connection.reason}</p>
              <ConnectionReceipts connectionId={connection.id} busy={busy} />
              {connection.uncertain && (
                <>
                  <p>
                    Resultado pendiente de comprobar: {connection.uncertain.tool}. Comprueba en el
                    proveedor si se realizó. Confirmarlo permite nuevas solicitudes; no repite la
                    anterior.
                  </p>
                  <Button
                    disabled={busy || !!removing}
                    onClick={() => {
                      setRemoving(connection.id);
                      setError('');
                      void action(`connections/${encodeURIComponent(connection.id)}/review`, {
                        reviewed: true,
                      })
                        .then((ok) => {
                          if (!ok) setError('No se pudo registrar la revisión.');
                        })
                        .catch(() => setError('No se pudo registrar la revisión.'))
                        .finally(() => setRemoving(null));
                    }}
                  >
                    He comprobado el resultado en el proveedor
                  </Button>
                </>
              )}
              {connection.enabled && (
                <>
                  <p>
                    Desactivar impide el acceso desde la oficina. Para revocar permisos de cuenta,
                    utiliza los ajustes oficiales del proveedor.
                  </p>
                  <Button
                    disabled={busy || !!removing}
                    onClick={() => {
                      setRemoving(connection.id);
                      setError('');
                      void action(`connections/${encodeURIComponent(connection.id)}/disable`, {})
                        .then((ok) => {
                          if (!ok) setError('No se pudo desactivar la conexión. Revisa su estado.');
                        })
                        .catch(() => setError('No se pudo desactivar la conexión.'))
                        .finally(() => setRemoving(null));
                    }}
                  >
                    Desactivar acceso de la oficina
                  </Button>
                </>
              )}
            </article>
          ))}
          {error && <p role="alert">{error}</p>}
        </section>
      )}
      <OfficeOperationReviews busy={busy} running={snapshot.running} action={action} />
      {!snapshot.toolCapabilities?.length ? (
        <p>Las herramientas todavía no se han comprobado.</p>
      ) : (
        <ul className="chat-capability-list">
          {snapshot.toolCapabilities.map((capability) => (
            <li key={capability.id}>
              <strong>{capability.name}</strong>{' '}
              <span className={`chat-capability-state chat-capability-${capability.state}`}>
                {states[capability.state]}
              </span>
              <p>{capability.reason}</p>
              {capability.lastCheckedAt && (
                <small>
                  Última comprobación: {new Date(capability.lastCheckedAt).toLocaleString('es-ES')}
                </small>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function OfficeToolApprovals({
  approvals,
  busy,
  action,
}: {
  approvals: OfficeToolApproval[];
  busy: boolean;
  action: Action;
}) {
  const [resolving, setResolving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [responses, setResponses] = useState<Record<string, OfficeToolApprovalValues>>({});
  function incomplete(approval: OfficeToolApproval): boolean {
    const values = responses[approval.id] ?? {};
    return (approval.fields ?? []).some(
      (field) =>
        field.required &&
        (!Object.hasOwn(values, field.name) ||
          (typeof values[field.name] === 'string' && !(values[field.name] as string).trim())),
    );
  }
  function change(
    approval: OfficeToolApproval,
    name: string,
    value: string | number | boolean | undefined,
  ) {
    setResponses((previous) => {
      const values = { ...previous[approval.id] };
      if (value === undefined) delete values[name];
      else values[name] = value;
      return { ...previous, [approval.id]: values };
    });
  }
  if (!approvals.length) return null;
  async function resolve(approval: OfficeToolApproval, approved: boolean) {
    if (resolving || busy || (approved && incomplete(approval))) return;
    setResolving(approval.id);
    setError('');
    try {
      const ok = await action(`tool-approvals/${encodeURIComponent(approval.id)}`, {
        approved,
        ...(approved && approval.fields ? { values: responses[approval.id] ?? {} } : {}),
      });
      if (!ok) setError('No se pudo registrar tu decisión. La acción sigue sin autorización.');
    } finally {
      setResolving(null);
    }
  }
  return (
    <section
      className="chat-tool-approvals"
      aria-label="Acciones que necesitan confirmación"
      aria-live="polite"
    >
      <h2>Esperando tu confirmación</h2>
      <p>Revisa la acción externa. Tu decisión se aplica únicamente a esta operación.</p>
      {approvals.map((approval) => (
        <article key={approval.id}>
          <strong>{approval.tool}</strong>
          <p>Destino: {approval.destination}</p>
          <pre>{approval.content}</pre>
          {approval.fields?.map((field) => {
            const value = responses[approval.id]?.[field.name];
            return (
              <label className="chat-approval-field" key={field.name}>
                {field.label}
                {field.required ? ' (obligatorio)' : ' (opcional)'}
                {field.options || field.type === 'boolean' ? (
                  <select
                    aria-label={field.label}
                    aria-required={field.required}
                    value={value === undefined ? '' : String(value)}
                    disabled={busy || !!resolving}
                    onChange={(event) =>
                      change(
                        approval,
                        field.name,
                        event.target.value === ''
                          ? undefined
                          : field.type === 'boolean'
                            ? event.target.value === 'true'
                            : event.target.value,
                      )
                    }
                  >
                    <option value="">Elige una opción</option>
                    {field.type === 'boolean' ? (
                      <>
                        <option value="true">Sí</option>
                        <option value="false">No</option>
                      </>
                    ) : (
                      field.options!.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))
                    )}
                  </select>
                ) : (
                  <input
                    type={field.type === 'number' ? 'number' : 'text'}
                    step={field.type === 'number' ? 'any' : undefined}
                    aria-label={field.label}
                    aria-required={field.required}
                    value={value === undefined ? '' : String(value)}
                    maxLength={field.type === 'string' ? 4000 : undefined}
                    disabled={busy || !!resolving}
                    onChange={(event) =>
                      change(
                        approval,
                        field.name,
                        event.target.value === ''
                          ? undefined
                          : field.type === 'number'
                            ? Number(event.target.value)
                            : event.target.value,
                      )
                    }
                  />
                )}
              </label>
            );
          })}
          <div className="chat-actions">
            <Button
              type="button"
              variant="accent"
              disabled={busy || !!resolving || incomplete(approval)}
              onClick={() => void resolve(approval, true)}
            >
              Confirmar esta acción
            </Button>
            <Button
              type="button"
              disabled={busy || !!resolving}
              onClick={() => void resolve(approval, false)}
            >
              Rechazar
            </Button>
          </div>
        </article>
      ))}
      {error && (
        <p role="alert" className="chat-error">
          {error}
        </p>
      )}
    </section>
  );
}
