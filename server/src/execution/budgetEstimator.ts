import type { UsageKey, UsageSample } from './usageHistory.js';

export interface BudgetEstimate {
  tokens: number | null;
  durationMs: number | null;
  samples: number;
  confidence: 'unknown' | 'low' | 'measured' | 'human';
  reason: string;
}
export const ESTIMATOR_VERSION = 'historical-upper-bound-v1';

/** No cached-token discount. Failed/censored turns are not zero-cost examples. */
export function estimateTurn(
  history: UsageSample[],
  key: UsageKey,
  contextCharacters: number,
): BudgetEstimate {
  const matches = history.filter((s) =>
    Object.entries(key).every(([k, v]) => s[k as keyof UsageKey] === v),
  );
  const known = matches.filter((s) => !s.censored && s.input !== null && s.output !== null);
  const unknown = (reason: string): BudgetEstimate => ({
    tokens: null,
    durationMs: null,
    samples: known.length,
    confidence: 'unknown',
    reason,
  });
  if (!known.length)
    return unknown('No hay turnos completos comparables; revisión humana requerida.');
  if (matches.some((s) => s.censored || s.input === null || s.output === null))
    return unknown('Hay consumo incompleto o censurado en esta clase; revisar la cota.');
  if (contextCharacters > Math.max(...known.map((s) => s.contextCharacters)))
    return unknown('El contexto supera los ejemplos medidos; revisar la estimación.');
  // A maximum with margin is deliberately not labelled a statistical percentile.
  return {
    tokens: Math.ceil(Math.max(...known.map((s) => s.input! + s.output!)) * 1.5),
    durationMs: Math.ceil(Math.max(...known.map((s) => s.durationMs)) * 1.5),
    samples: known.length,
    confidence: known.length < 5 ? 'low' : 'measured',
    reason:
      'Máximo comparable × 1,5; pocas muestras requieren revisión humana. No es un tope del proveedor.',
  };
}
