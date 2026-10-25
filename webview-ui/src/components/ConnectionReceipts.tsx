import { useState } from 'react';

import type {
  OfficeConnectionOperation,
  OfficeConnectionOperationLog,
} from '../../../core/src/officeTools.js';
import { Button } from './ui/Button.js';

const states: Record<OfficeConnectionOperation['status'], string> = {
  dispatching: 'Esperando resultado',
  completed: 'Completada',
  failed: 'Respondió con error',
  review_required: 'Resultado incierto',
  not_sent: 'No enviada',
};
export function ConnectionOperationRecords({ log }: { log: OfficeConnectionOperationLog }) {
  return (
    <>
      <p>
        Registro iniciado: {new Date(log.recordingStartedAt).toLocaleString('es-ES')}.{' '}
        {log.historicalCoverage}
      </p>
      {!log.operations.length && <p>No hay recibos de esta conexión en el registro consultado.</p>}
      {log.operations.map((operation) => (
        <details key={operation.id}>
          <summary>
            {operation.tool} · {states[operation.status]}
          </summary>
          <p>
            Recibo: <code>{operation.id}</code>
          </p>
          <p>Último registro: {new Date(operation.updatedAt).toLocaleString('es-ES')}</p>
          {operation.approval ? (
            <p>
              Aprobación vinculada: <code>{operation.approval.id}</code>
            </p>
          ) : (
            <p>No consta una aprobación vinculada en este recibo.</p>
          )}
          {operation.taskId && (
            <p>
              Encargo: <code>{operation.taskId}</code>
            </p>
          )}
          <p>
            Huella de argumentos: <code>{operation.argumentsHash}</code>
          </p>
          <p>
            Huella del esquema: <code>{operation.toolDefinitionHash}</code>
          </p>
          {operation.resultHash && (
            <p>
              Huella del resultado: <code>{operation.resultHash}</code>
            </p>
          )}
          {operation.review && (
            <p>
              Revisión humana registrada; no determina si la operación se realizó. El recibo
              original se conserva.
            </p>
          )}
          <p>
            Las huellas identifican los datos; no contienen el texto de la solicitud ni su
            respuesta. Consultar este recibo no repite la operación.
          </p>
        </details>
      ))}
    </>
  );
}
export function ConnectionReceipts({
  connectionId,
  busy,
}: {
  connectionId: string;
  busy: boolean;
}) {
  const [log, setLog] = useState<OfficeConnectionOperationLog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function load() {
    if (loading || busy) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(
        `/api/team/connections/${encodeURIComponent(connectionId)}/operations`,
        { cache: 'no-store' },
      );
      if (!response.ok) throw Error('receipt query failed');
      const data = (await response.json()) as OfficeConnectionOperationLog;
      if (!Array.isArray(data.operations) || !Number.isFinite(data.recordingStartedAt))
        throw Error('invalid receipts');
      setLog(data);
    } catch {
      setError('No se pudieron consultar los recibos. No se ha repetido ninguna operación.');
    } finally {
      setLoading(false);
    }
  }
  return (
    <details>
      <summary>Recibos de operaciones</summary>
      <Button disabled={busy || loading} onClick={() => void load()}>
        {loading ? 'Consultando…' : 'Consultar recibos'}
      </Button>
      {error && <p role="alert">{error}</p>}
      {log && <ConnectionOperationRecords log={log} />}
    </details>
  );
}
