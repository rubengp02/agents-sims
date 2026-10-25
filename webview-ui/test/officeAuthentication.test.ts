import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { OfficeAuthentication as Authentication } from '../../core/src/officeTools.js';
import { OfficeAuthentication } from '../src/components/OfficeAuthentication.js';

const base: Authentication = {
  id: 'auth',
  taskId: 'task',
  service: 'GitHub',
  status: 'awaiting_user',
  reason: 'Completa la autorización oficial.',
  expiresAt: Date.now() + 60000,
  authorizationUrl: 'https://github.com/login/oauth/authorize?state=transient',
};
const render = (entry: Authentication) =>
  renderToStaticMarkup(
    createElement(OfficeAuthentication, {
      entries: [entry],
      busy: false,
      action: async () => true,
    }),
  );
describe('official authentication in conversation', () => {
  it('does not offer another login when hosted tools remain unavailable', () => {
    const html = render({
      ...base,
      kind: 'application',
      status: 'failed',
      reason: 'No necesitas repetir el inicio de sesión.',
    });
    expect(html).toContain('Herramientas no disponibles en Codex');
    expect(html).not.toContain('Ya he conectado, comprobar');
    expect(html).not.toContain('href=');
  });
  it('offers an explicit official-state check for hosted application connections', () => {
    const html = render({
      ...base,
      kind: 'application',
      authorizationUrl: 'https://chatgpt.com/apps/github/app-fixture',
    });
    expect(html).toContain('Ya he conectado, comprobar');
    expect(html).toContain('Conectar en');
    expect(html).not.toContain('<input');
    expect(render({ ...base, kind: 'application', status: 'authenticated' })).toContain(
      'Conexión confirmada por Codex',
    );
    expect(render({ ...base, kind: 'application', status: 'cancelled' })).not.toContain(
      'Ya he conectado, comprobar',
    );
  });
  it('shows the provider link, destination, cancellation and no credential fields', () => {
    const html = render(base);
    expect(html).toContain('Iniciar sesión en github.com');
    expect(html).toContain('Cancelar inicio de sesión');
    expect(html).toContain('noopener noreferrer');
    expect(html).toContain('no-referrer');
    expect(html).not.toContain('<input');
  });
  it.each(['authenticated', 'failed', 'cancelled', 'expired', 'verifying'] as const)(
    'hides stale authorization links when %s',
    (status) => {
      expect(render({ ...base, status })).not.toContain('href=');
    },
  );
  it('does not open invalid or expired links', () => {
    expect(render({ ...base, authorizationUrl: 'javascript:alert(1)' })).not.toContain('href=');
    expect(render({ ...base, expiresAt: 1 })).not.toContain('href=');
  });
});
