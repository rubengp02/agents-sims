import { useRef } from 'react';

import { MAX_IMAGES_PER_MESSAGE, type OfficeArtifact } from '../../../core/src/artifacts.js';
import { Button } from './ui/Button.js';

export function ImageAttachments({
  artifacts,
  disabled,
  busy,
  error,
  onFiles,
  onRemove,
}: {
  artifacts: OfficeArtifact[];
  disabled: boolean;
  busy: boolean;
  error: string;
  onFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <section
      className="chat-image-attachments"
      aria-label="Adjuntar imágenes"
      onDragOver={(event) => {
        if (!disabled) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!disabled) onFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        hidden
        aria-label="Elegir imágenes"
        disabled={disabled || artifacts.length >= MAX_IMAGES_PER_MESSAGE}
        onChange={(event) => {
          onFiles(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
      />
      <Button
        type="button"
        disabled={disabled || artifacts.length >= MAX_IMAGES_PER_MESSAGE}
        onClick={() => input.current?.click()}
      >
        {busy ? 'Guardando imágenes…' : 'Adjuntar imágenes'}
      </Button>
      <span className="chat-attachment-help">
        También puedes pegar o arrastrar imágenes. PNG, JPEG o WebP; hasta 10 imágenes de 20 MB.
      </span>
      {artifacts.length > 0 && (
        <ul className="chat-attachment-list">
          {artifacts.map((artifact) => (
            <li key={artifact.id}>
              <img
                src={`/api/team/artifacts/${encodeURIComponent(artifact.id)}`}
                alt={artifact.name}
              />
              <span>{artifact.name}</span>
              <Button
                type="button"
                disabled={disabled}
                aria-label={`Quitar imagen ${artifact.name}`}
                onClick={() => onRemove(artifact.id)}
              >
                Quitar
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="chat-error">
          {error}
        </p>
      )}
    </section>
  );
}
