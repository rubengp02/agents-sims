import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { OfficeOperationReview } from '../../core/src/officeTools.js';
import { OperationReviewList } from '../src/components/OfficeOperationReviews.js';

const receipt: OfficeOperationReview = {
  id: 'opaque',
  receiptId: 'original-receipt',
  kind: 'integration',
  action: 'fixture.read',
  destination: 'Servicio fixture',
  occurredAt: null,
  reference: 'arguments-digest',
  status: 'pending',
  originalStatus: 'review_required',
};
describe('human review controls', () => {
  it('shows recorded diagnostics and distinguishes older receipts with no accredited cause', () => {
    const html = renderToStaticMarkup(
      createElement(OperationReviewList, {
        operations: [
          receipt,
          {
            ...receipt,
            id: 'new',
            diagnostic: 'Se perdió la conexión con Codex.',
            failureStage: 'verification',
          },
        ],
        running: false,
        busy: false,
        onReview: () => {},
      }),
    );
    expect(html).toContain('La causa del resultado incierto no consta acreditada');
    expect(html).toContain('Se perdió la conexión con Codex.');
    expect(html).toContain('respuesta recibida, sin verificación final');
    expect(html).toContain('Si todavía no lo sabes, déjala pendiente');
  });
  it('provides access to the recorded original conversation without inventing one for old receipts', () => {
    const html = renderToStaticMarkup(
      createElement(OperationReviewList, {
        operations: [
          { ...receipt, conversationId: 'original-chat', description: 'Consulta de prueba' },
        ],
        running: false,
        busy: false,
        onReview: () => {},
        onOpenConversation: () => {},
      }),
    );
    expect(html).toContain('Ver conversación original');
    expect(html).toContain('Consulta de prueba');
    expect(html).not.toContain('no consta en este recibo');
  });
  it('asks for an actual outcome and explains the missing evidence and absence of automatic resumption', () => {
    const html = renderToStaticMarkup(
      createElement(OperationReviewList, {
        operations: [receipt],
        running: false,
        busy: false,
        onReview: () => {},
      }),
    );
    expect(html).toContain('¿Has comprobado si esta operación llegó a realizarse?');
    expect(html).toContain('Sí, he comprobado que se realizó');
    expect(html).toContain('He comprobado que no se realizó');
    expect(html).toContain('Si todavía no lo sabes, déjala pendiente');
    expect(html).toContain('no reanuda la oficina');
    expect(html).toContain('no su contenido completo');
    expect(html).toContain('original-receipt');
  });
  it('disables decisions while work is active and labels a review as a human statement', () => {
    const active = renderToStaticMarkup(
      createElement(OperationReviewList, {
        operations: [{ ...receipt, originalStatus: 'dispatching' }],
        running: true,
        busy: false,
        onReview: () => {},
      }),
    );
    expect(active.match(/disabled=/g)).toHaveLength(2);
    const closed = renderToStaticMarkup(
      createElement(OperationReviewList, {
        operations: [receipt],
        running: true,
        busy: false,
        onReview: () => {},
      }),
    );
    expect(closed).not.toContain('disabled=');
    const reviewed = renderToStaticMarkup(
      createElement(OperationReviewList, {
        operations: [
          {
            ...receipt,
            status: 'reviewed',
            review: { outcome: 'completed', reviewedAt: new Date().toISOString() },
          },
        ],
        running: false,
        busy: false,
        onReview: () => {},
      }),
    );
    expect(reviewed).toContain('Revisada por ti: se realizó');
    expect(reviewed).not.toContain('<button');
  });
});
