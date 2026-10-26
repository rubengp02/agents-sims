import type { TeamAvailability } from '../../../core/src/team.js';

/** Catalog evidence stays separate from permission to execute. */
export function ProviderStatus({ provider }: { provider: TeamAvailability }) {
  const inspection = provider.inspection;
  return (
    <div>
      <p>
        <strong>
          {provider.provider === 'codex'
            ? 'Codex'
            : provider.provider === 'antigravity'
              ? 'Antigravity'
              : 'Claude'}
          :{' '}
        </strong>
        {provider.message}
      </p>
      {inspection && (
        <details>
          <summary>Qué se ha comprobado · CLI {inspection.cliVersion}</summary>
          {inspection.includedUsage?.verified && (
            <ul>
              {inspection.includedUsage.windows.map((window) => (
                <li key={window.id}>
                  {window.id
                    .replace(':Weekly Limit Remaining', ' · semanal')
                    .replace(':Five Hour Limit Remaining', ' · cinco horas')}
                  : {100 - window.usedPercent}% disponible. Renovación:{' '}
                  {new Date(window.resetsAt * 1000).toLocaleString()}.
                </li>
              ))}
            </ul>
          )}
          <p>
            {provider.available
              ? 'Catálogo disponible. Cada ejecución vuelve a comprobar cuota y permisos.'
              : 'Catálogo comunicado por el CLI. Estos modelos no están habilitados para ejecutar encargos.'}
          </p>
          {inspection.models.length > 0 ? (
            <ul>
              {inspection.models.map((model) => (
                <li key={model.id}>
                  {model.label} · <code>{model.id}</code>
                </li>
              ))}
            </ul>
          ) : (
            <p>Catálogo sin verificar.</p>
          )}
          <ul>
            {inspection.checks.map((check) => (
              <li key={check.id}>
                {check.state === 'verified'
                  ? 'Comprobado'
                  : check.state === 'unsupported'
                    ? 'Pendiente de integración'
                    : 'Sin verificar'}
                : {check.message}
              </li>
            ))}
          </ul>
          <p>Última comprobación: {new Date(inspection.checkedAt).toLocaleString()}</p>
        </details>
      )}
    </div>
  );
}
