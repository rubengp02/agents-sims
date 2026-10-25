import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { TeamSnapshot } from '../../core/src/team.js';
import { OfficeToolsPanel } from '../src/components/OfficeToolsPanel.js';
describe('connection access controls', () => {
  it('makes the scope of local disable explicit without claiming provider revocation', () => {
    const snapshot = {
      connections: [
        {
          id: 'fixture',
          name: 'Servicio fixture',
          url: 'https://example.com/mcp',
          enabled: true,
          state: 'unverified',
          reason: 'Sin comprobar',
          uncertain: { tool: 'fixture_operation', at: '2026-10-23T00:00:00Z' },
        },
      ],
    } as TeamSnapshot;
    const html = renderToStaticMarkup(
      createElement(OfficeToolsPanel, { snapshot, busy: false, action: async () => true }),
    );
    expect(html).toContain('Desactivar acceso de la oficina');
    expect(html).toContain('ajustes oficiales del proveedor');
    expect(html).toContain('Servicio fixture');
    expect(html).toContain('He comprobado el resultado en el proveedor');
    expect(html).toContain('no repite la anterior');
  });
  it('keeps disabled connection information without offering an active access action', () => {
    const snapshot = {
      connections: [
        {
          id: 'fixture',
          name: 'Servicio fixture',
          url: 'https://example.com/mcp',
          enabled: false,
          state: 'blocked',
          reason: 'Acceso desactivado',
        },
      ],
    } as TeamSnapshot;
    const html = renderToStaticMarkup(
      createElement(OfficeToolsPanel, { snapshot, busy: false, action: async () => true }),
    );
    expect(html).toContain('Acceso desactivado');
    expect(html).not.toContain('>Desactivar acceso de la oficina<');
  });
});
