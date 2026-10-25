import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { TeamTask } from '../../core/src/team.js';
import { OfficeQuestion } from '../src/components/OfficeQuestion.js';
describe('chief question card', () => {
  it.each(['approval', 'text'] as const)(
    'shows the actual question with the appropriate answer controls (%s)',
    (responseType) => {
      const task = {
        humanRequest: { id: 'question', question: '¿Quieres **azul** o verde?', responseType },
      } as TeamTask;
      const html = renderToStaticMarkup(
        createElement(OfficeQuestion, { task, busy: false, action: async () => true }),
      );
      expect(html).toContain('<strong>azul</strong>');
      if (responseType === 'approval') {
        expect(html).toContain('Aprobar y continuar');
        expect(html).toContain('Denegar');
      } else {
        expect(html).toContain('<textarea');
        expect(html).toContain('Responder y continuar');
      }
    },
  );
});
