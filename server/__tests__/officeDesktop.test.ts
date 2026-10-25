import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const helper = resolve(
  process.cwd(),
  process.cwd().endsWith('server')
    ? '../dist/native/office-desktop.exe'
    : 'dist/native/office-desktop.exe',
);
const execute = promisify(execFile);
describe.skipIf(process.platform !== 'win32' || !existsSync(helper))(
  'Windows helper (read-only real checks)',
  () => {
    it('lists windows through the GUI subsystem without a console window', async () => {
      const { stdout } = await execute(helper, [JSON.stringify({ action: 'windows' })], {
        windowsHide: true,
      });
      const response = JSON.parse(stdout) as {
        windows: Array<{ handle: string; processId: number }>;
      };
      expect(Array.isArray(response.windows)).toBe(true);
      expect(
        response.windows.every(
          (window) => typeof window.handle === 'string' && typeof window.processId === 'number',
        ),
      ).toBe(true);
    });
    it('rejects a vanished target before generating input', async () => {
      const { stdout } = await execute(
        helper,
        [JSON.stringify({ action: 'click', handle: '0', processId: 0, x: 0, y: 0 })],
        { windowsHide: true },
      );
      expect(JSON.parse(stdout).error).toContain('ventana objetivo');
    });
  },
);
