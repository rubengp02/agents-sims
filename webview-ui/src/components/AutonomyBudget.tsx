import {
  CODEX_QUOTA_RESERVE_PERCENT,
  type IncludedQuotaView,
  type ObjectiveBudgetView,
} from '../../../core/src/objectiveBudget.js';
import { reasons } from './conversationState.js';

const number = (value: number) => value.toLocaleString('es-ES');
function timestamp(value: number | null, seconds = false) {
  if (value === null || !Number.isFinite(value)) return 'Sin fecha verificable';
  const date = new Date(seconds ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? 'Sin fecha verificable' : date.toLocaleString('es-ES');
}

/** Reads server evidence only. Expanding this panel never starts or resumes work. */
export function AutonomyBudget({
  budget,
  quota,
}: {
  budget?: ObjectiveBudgetView;
  quota?: IncludedQuotaView;
}) {
  const usage = budget?.usage;
  return (
    <details className="chat-autonomy-budget" aria-label="Presupuesto de autonomía">
      <summary>
        Autonomía
        {usage && (
          <>
            {' '}
            · {usage.attempts} {usage.attempts === 1 ? 'intento' : 'intentos'} ·{' '}
            {usage.knownTokens > 0 ? (
              <>
                {usage.complete ? '' : '≥ '}
                {number(usage.knownTokens)} tokens registrados
              </>
            ) : usage.complete ? (
              'Sin consumo registrado'
            ) : (
              'Consumo incompleto'
            )}
          </>
        )}
      </summary>
      <div>
        <p>
          {!budget
            ? 'El modo del presupuesto se mostrará cuando prepares un encargo.'
            : budget.mode === 'manual'
              ? 'Este encargo usa los límites manuales compartidos de la cola.'
              : 'La oficina trabaja hasta terminar el objetivo o encontrar un bloqueo, sin un corte fijo por minutos.'}
        </p>
        {!usage ? (
          <p>No hay un desglose verificable del consumo de este encargo.</p>
        ) : (
          <>
            <p>
              {number(usage.knownTokens)} tokens registrados en {usage.attempts}{' '}
              {usage.attempts === 1 ? 'intento' : 'intentos'} de este objetivo, incluidos el Jefe y
              sus empleados.
            </p>
            {usage.activeAttempts > 0 && (
              <p>
                {usage.activeAttempts} {usage.activeAttempts === 1 ? 'intento' : 'intentos'} en
                curso: su consumo final aún no está confirmado.
              </p>
            )}
            {usage.unknownAttempts > 0 && (
              <p>
                {usage.unknownAttempts} {usage.unknownAttempts === 1 ? 'intento' : 'intentos'} sin
                recibo completo. El total puede ser mayor; los datos conocidos se conservan.
              </p>
            )}
            {usage.historicalUnknown && (
              <p>
                Hay trabajo anterior sin desglose por objetivo. No se ha convertido en consumo cero.
              </p>
            )}
            <p>
              Tiempo de ejecución con recibos completos:{' '}
              {number(Math.round(usage.knownDurationMs / 1000))} segundos acumulados.
            </p>
          </>
        )}
        {budget?.pauseReason && (
          <p>
            Motivo de pausa:{' '}
            {reasons[budget.pauseReason] ??
              'El encargo requiere revisión. Consulta el estado y su pregunta en la conversación.'}
          </p>
        )}
        <p>
          La cuota incluida se comprueba antes de cada nueva ejecución. Se conserva un margen del{' '}
          {quota?.reservePercent ?? CODEX_QUOTA_RESERVE_PERCENT}%. Una ejecución en curso aún puede
          consumir cuota.
        </p>
        {!quota?.verified && (
          <p>La cuota actual no está verificada. La oficina debe comprobarla antes de ejecutar.</p>
        )}
        {!!quota?.windows.length && (
          <>
            <p>
              {quota.verified
                ? 'Última comprobación'
                : 'Última lectura anterior, no confirma la cuota actual'}
              : {timestamp(quota.checkedAt)}.
            </p>
            <ul>
              {quota.windows.map((window, index) => (
                <li key={window.id}>
                  Ventana {index + 1}: {number(window.usedPercent)}% usado; renovación indicada:{' '}
                  {timestamp(window.resetsAt, true)}. Hasta el margen de seguridad en esa lectura:{' '}
                  {number(Math.max(0, 100 - window.usedPercent - quota.reservePercent))}%.
                </li>
              ))}
            </ul>
          </>
        )}
        <p>
          La cuota es compartida con tus otras sesiones de Codex. Los tokens registrados aquí no se
          convierten en un porcentaje de esa cuota. Continuar conserva los recibos anteriores,
          incluidos los incompletos.
        </p>
      </div>
    </details>
  );
}
