import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { ExecutionBlocked } from './types.js';

let currentSelection: Promise<string | null> | undefined;

/** One native window at a time, including requests from multiple browser tabs. */
export function pickProjectFolder(): Promise<string | null> {
  if (process.platform !== 'win32')
    return Promise.reject(
      new ExecutionBlocked(
        'folder_picker_unavailable',
        'El selector de Windows no está disponible en este sistema. Puedes pegar la ruta manualmente.',
      ),
    );
  if (currentSelection) return currentSelection;
  const helper = [
    join(__dirname, 'native', 'office-folder-picker.exe'),
    join(__dirname, '..', '..', '..', 'dist', 'native', 'office-folder-picker.exe'),
  ].find(existsSync);
  if (!helper)
    return Promise.reject(
      new ExecutionBlocked(
        'folder_picker_unavailable',
        'Falta compilar el selector de Windows. Puedes pegar la ruta manualmente.',
      ),
    );
  currentSelection = new Promise<string | null>((resolve, reject) => {
    execFile(
      helper,
      [],
      // A GUI subsystem executable opens the dialog without creating a console.
      { windowsHide: false, timeout: 300_000, maxBuffer: 32_768, encoding: 'utf8' },
      (error, output) => {
        if (error)
          return reject(
            new ExecutionBlocked(
              'folder_picker_failed',
              'No se pudo completar la selección de Windows o se agotó el tiempo de espera. Puedes volver a intentarlo o pegar la ruta.',
            ),
          );
        const encoded = output.trim();
        if (!encoded) return resolve(null);
        const selected = Buffer.from(encoded, 'base64').toString('utf8');
        if (!/^(?:[A-Za-z]:\\|\\\\)/.test(selected) || selected.includes('\0'))
          return reject(
            new ExecutionBlocked(
              'folder_picker_invalid',
              'Windows no devolvió una carpeta válida. Vuelve a intentarlo.',
            ),
          );
        resolve(selected);
      },
    );
  }).finally(() => {
    currentSelection = undefined;
  });
  return currentSelection;
}
