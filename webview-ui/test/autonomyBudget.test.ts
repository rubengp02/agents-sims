import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { IncludedQuotaView, ObjectiveBudgetView } from '../../core/src/objectiveBudget.js';
import { AutonomyBudget } from '../src/components/AutonomyBudget.js';

const budget: ObjectiveBudgetView = {
  mode: 'codex',
  pauseReason: null,
  usage: {
    attempts: 3,
    activeAttempts: 0,
    unknownAttempts: 0,
    knownTokens: 330,
    knownDurationMs: 1000,
    historicalUnknown: false,
    complete: true,
  },
};
const quota: IncludedQuotaView = {
  provider: 'codex',
  checkedAt: 1_790_000_000_000,
  verified: true,
  reservePercent: 10,
  reasonCode: null,
  windows: [{ id: 'codex:primary', usedPercent: 25, resetsAt: 1_790_100_000 }],
};
const html = (props: Parameters<typeof AutonomyBudget>[0]) =>
  renderToStaticMarkup(createElement(AutonomyBudget, props));

describe('understandable autonomy budget', () => {
  it('separates objective tokens and shared subscription quota without a time cutoff', () => {
    const result = html({ budget, quota });
    expect(result).toContain('330 tokens registrados');
    expect(result).toContain('25% usado');
    expect(result).toContain('Hasta el margen de seguridad en esa lectura: 65%');
    expect(result).toContain('sin un corte fijo por minutos');
    expect(result).toContain('margen del 10%');
    expect(result).toContain('no se convierten en un porcentaje');
    expect(result).not.toContain('<form');
    expect(result).not.toContain('<details open');
  });
  it('keeps interrupted lower bounds and stale quota explicitly incomplete', () => {
    const result = html({
      budget: {
        ...budget,
        pauseReason: 'usage_unknown',
        usage: {
          ...budget.usage,
          attempts: 4,
          unknownAttempts: 1,
          historicalUnknown: true,
          complete: false,
        },
      },
      quota: { ...quota, verified: false, reasonCode: 'quota_unknown' },
    });
    expect(result).toContain('≥ 330');
    expect(result).toContain('1 intento sin recibo completo');
    expect(result).toContain('no confirma la cuota actual');
    expect(result).toContain('no está verificada');
    expect(result).toContain('No se ha convertido en consumo cero');
    expect(result).toContain('Motivo de pausa');
  });
  it('does not invent a free legacy conversation or an automatic manual budget', () => {
    expect(html({})).toContain('No hay un desglose verificable');
    expect(html({})).not.toContain('0 tokens registrados');
    expect(html({ budget: { ...budget, mode: 'manual' } })).toContain(
      'límites manuales compartidos',
    );
  });
});
