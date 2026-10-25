import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { DeliveryEvidence as Evidence } from '../../core/src/deliveryEvidence.js';
import { DeliveryEvidence } from '../src/components/DeliveryEvidence.js';

const evidence: Evidence = {
  version: 1,
  objectiveRevision: 0,
  createdAt: 1,
  execution: 'simulated',
  changes: {
    state: 'compared',
    files: ['app.ts'],
    base: 'a'.repeat(64),
    candidate: 'b'.repeat(64),
  },
  checks: [{ id: 'test', exitCode: 0, durationMs: 20, passed: true }],
  review: { state: 'tester', taskId: 'review', candidate: 'b'.repeat(64) },
  artifactIds: [],
  limitations: ['No acredita aceptación humana.'],
};
describe('final evidence beside Chief summary', () => {
  it('distinguishes simulation, mechanical checks, changes and review in a folded card', () => {
    const html = renderToStaticMarkup(createElement(DeliveryEvidence, { evidence }));
    expect(html).toContain('Ficha final de evidencias');
    expect(html).toContain('ejecutor simulado');
    expect(html).toContain('app.ts');
    expect(html).toContain('✓ Aprobada');
    expect(html).toContain('Tester vigente');
    expect(html).toContain('No acredita aceptación humana.');
    expect(html).not.toContain('<details open');
  });
  it('keeps legacy replies readable without fabricating an evidence card', () => {
    expect(renderToStaticMarkup(createElement(DeliveryEvidence, {}))).toBe('');
  });
});
