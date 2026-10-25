import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { OfficePresence } from '../../core/src/officePresence.js';
import { EmployeeSignal } from '../src/office/components/EmployeeSignal.js';

const employee: OfficePresence = {
  id: 1,
  name: 'Programador',
  project: 'Proyecto',
  provider: 'codex',
  status: 'Trabajando',
  signal: { label: 'Editando', active: true, tone: 'active', conversationId: 'chat' },
};
describe('discreet employee signals', () => {
  it('labels the action and offers an accessible route to the conversation', () => {
    const html = renderToStaticMarkup(
      createElement(EmployeeSignal, { employee, onOpenConversation: () => {} }),
    );
    expect(html).toContain('Programador: Editando. Abrir conversación y evidencias');
    expect(html).toContain('data-active="true"');
  });
  it('disconnection suppresses stale activity and disables navigation', () => {
    const html = renderToStaticMarkup(
      createElement(EmployeeSignal, { employee, disconnected: true, onOpenConversation: () => {} }),
    );
    expect(html).toContain('Sin conexión');
    expect(html).not.toContain('Editando');
    expect(html).toContain('data-active="false"');
    expect(html).toContain('disabled');
  });
});
