import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

import { LAYOUT_FILE_DIR } from './constants.js';

/** Preview state is injected only by the server-owned preview process manager. */
export function officeStateDirectory(defaultDirectory = LAYOUT_FILE_DIR): string {
  if (process.env.PIXEL_OFFICE_PREVIEW === '1') {
    const isolated = process.env.PIXEL_OFFICE_STATE_DIR;
    if (!isolated || !isAbsolute(isolated))
      throw new Error('La vista previa necesita una carpeta privada de estado.');
    return resolve(isolated);
  }
  return join(homedir(), defaultDirectory);
}
