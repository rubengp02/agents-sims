import type { DeliveryEvidence as Evidence } from '../../../core/src/deliveryEvidence.js';

export function DeliveryEvidence({ evidence }: { evidence?: Evidence }) {
  if (!evidence) return null;
  return (
    <details className="chat-delivery-evidence" aria-label="Ficha final de evidencias">
      <summary>Ver evidencias de la entrega</summary>
      <p>
        Datos registrados por la oficina para la revisión {evidence.objectiveRevision + 1} del
        objetivo.
      </p>
      <p>
        {evidence.execution === 'official-cli'
          ? 'Ejecución mediante el CLI oficial.'
          : evidence.execution === 'simulated'
            ? 'Comprobación con ejecutor simulado.'
            : 'Procedencia de la ejecución sin acreditar.'}
      </p>
      <h3>Archivos</h3>
      {evidence.changes.state === 'compared' ? (
        <>
          <p>{evidence.changes.files.length} archivos con cambios detectados entre capturas.</p>
          <ul>
            {evidence.changes.files.map((file) => (
              <li key={file}>
                <code>{file}</code>
              </li>
            ))}
          </ul>
          <details>
            <summary>Huellas de la comparación</summary>
            <p>
              Inicio: <code>{evidence.changes.base}</code>
            </p>
            <p>
              Entrega: <code>{evidence.changes.candidate}</code>
            </p>
          </details>
        </>
      ) : (
        <p>No hay comparación de archivos registrada.</p>
      )}
      <h3>Pruebas locales registradas</h3>
      {!evidence.checks.length ? (
        <p>No se registraron pruebas locales.</p>
      ) : (
        <ul>
          {evidence.checks.map((check, index) => (
            <li key={`${check.id}-${index}`}>
              {check.passed ? '✓ Aprobada' : '✕ Fallida'} · {check.id} · salida{' '}
              {check.exitCode ?? 'desconocida'} · {check.durationMs} ms
            </li>
          ))}
        </ul>
      )}
      <h3>Revisión y artefactos</h3>
      <p>
        {evidence.review.state === 'tester'
          ? 'El servidor verificó una entrega independiente del Tester vigente antes del cierre.'
          : 'Respuesta directa sin revisión del Tester.'}
      </p>
      <p>
        {evidence.artifactIds.length} artefactos guardados. Sus imágenes y descargas están
        disponibles en esta conversación.
      </p>
      <h3>Limitaciones</h3>
      <ul>
        {evidence.limitations.map((limitation) => (
          <li key={limitation}>{limitation}</li>
        ))}
      </ul>
    </details>
  );
}
