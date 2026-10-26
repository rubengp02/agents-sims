import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { TeamAvailability } from '../../core/src/team.js';
import { ProviderStatus } from '../src/components/ProviderStatus.js';

const base: TeamAvailability = {
  provider: 'antigravity',
  enabled: true,
  available: false,
  reasonCode: 'antigravity_execution_unverified',
  message: 'Ejecución bloqueada: cuota incluida y permisos sin verificar.',
  models: [],
};
const render = (provider: TeamAvailability) =>
  renderToStaticMarkup(createElement(ProviderStatus, { provider }));

describe('provider inspection is not execution authorization', () => {
  it('explains the block and shows the actual catalog separately', () => {
    const html = render({
      ...base,
      inspection: {
        checkedAt: 1_700_000_000_000,
        cliVersion: '1.1.13',
        models: [{ id: 'native-model', label: 'Modelo de ejemplo' }],
        checks: [
          { id: 'quota', state: 'unverified', message: 'Cuota desconocida.' },
          { id: 'images', state: 'unsupported', message: 'Imágenes pendientes.' },
        ],
      },
    });
    expect(html).toContain('Ejecución bloqueada');
    expect(html).toContain('no están habilitados para ejecutar encargos');
    expect(html).toContain('Modelo de ejemplo');
    expect(html).toContain('native-model');
    expect(html).toContain('Sin verificar');
    expect(html).toContain('Pendiente de integración');
    expect(html).toContain('Última comprobación');
    expect(html).not.toContain('Suscripción verificada');
  });

  it('shows unknown catalog without manufacturing defaults and escapes remote labels', () => {
    const inspection = {
      checkedAt: 1,
      cliVersion: 'fixture',
      models: [] as Array<{ id: string; label: string }>,
      checks: [],
    };
    expect(render({ ...base, inspection })).toContain('Catálogo sin verificar');
    inspection.models.push({ id: 'id', label: '<script>remote</script>' });
    const html = render({ ...base, inspection });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('keeps existing providers compatible without inspection metadata', () => {
    expect(render({ ...base, provider: 'codex', message: 'Comprobado.' })).toContain('Codex');
    expect(render(base)).not.toContain('<details>');
  });
});
