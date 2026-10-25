import type { OfficeArtifact } from '../../../core/src/artifacts.js';

export function ArtifactGallery({
  artifacts = [],
  label = 'Imágenes de la conversación',
}: {
  artifacts?: OfficeArtifact[];
  label?: string;
}) {
  if (!artifacts.length) return null;
  return (
    <div className="chat-artifact-gallery" aria-label={label}>
      {artifacts.map((artifact) => {
        const url = `/api/team/artifacts/${encodeURIComponent(artifact.id)}`;
        return (
          <figure key={artifact.id}>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Abrir imagen ${artifact.name}`}
            >
              <img src={url} alt={artifact.name} loading="lazy" />
            </a>
            <figcaption>
              {artifact.name}{' '}
              <a href={`${url}?download=1`} download={artifact.name}>
                Descargar
              </a>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
