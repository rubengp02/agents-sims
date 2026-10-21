export const PILOT_LIMITS = Object.freeze({
  maxRuns: 2,
  maxMs: 240000,
  perRunMs: 90000,
  maxTokens: 60000,
  reservePerRun: 30000,
});

export function pilotGate(ledger, now = Date.now()) {
  if (ledger.paused) return 'paused';
  if (ledger.attempts >= PILOT_LIMITS.maxRuns) return 'run_budget';
  if (now - ledger.startedAt >= PILOT_LIMITS.maxMs) return 'time_budget';
  if (!Number.isSafeInteger(ledger.tokens) || ledger.tokens < 0) return 'usage_unknown';
  if (ledger.tokens + PILOT_LIMITS.reservePerRun > PILOT_LIMITS.maxTokens) return 'token_budget';
  return null;
}

export const ANALYSIS_TASK = `Analiza clamp(value,min,max). Contrato: números finitos, min<=max; limitar value al intervalo cerrado. Código actual: export function clamp(value,min,max) { return Math.min(min, Math.max(max,value)); }
Selecciona el parche correcto: A=Math.min(min,Math.max(max,value)); B=Math.max(min,Math.min(max,value)); C=Math.max(max,Math.min(min,value)). Calcula los resultados del contrato para [value,min,max]: [-3,0,10], [5,0,10], [18,0,10], [-9,-2,4], [1,-2,4], [9,-2,4].
Responde JSON {"defectCode":"BOUND_ORDER|NONE","patch":"A|B|C","results":[seis números]} y después la declaración OFFICE_RESULT. No uses herramientas: el código completo ya está incluido. No modifiques archivos.`;
export const ANALYSIS_CONTEXT = Object.freeze({
  objective:
    'Analizar un defecto acotado en clamp y elegir una reparación que respete el contrato.',
  files: ['clamp.mjs'],
  decisions: ['Números finitos; min<=max.', 'Solo lectura, sin herramientas ni delegación.'],
  acceptance: [
    'Detectar el defecto real.',
    'Elegir el parche correcto.',
    'Seis resultados correctos y JSON válido.',
    'OFFICE_RESULT completed y ningún cambio de archivo.',
  ],
  checks: [],
});
export function acceptAnalysis(output, unchanged = true) {
  const tests = [];
  let answer = null;
  try {
    answer = JSON.parse(output.split(/\s*OFFICE_RESULT\s*/)[0].trim());
  } catch {
    /* failed acceptance */
  }
  tests.push({ id: 'json', passed: answer !== null });
  tests.push({ id: 'defect', passed: answer?.defectCode === 'BOUND_ORDER' });
  tests.push({ id: 'patch', passed: answer?.patch === 'B' });
  tests.push({
    id: 'boundary-results',
    passed: JSON.stringify(answer?.results) === '[0,5,10,-2,1,4]',
  });
  tests.push({
    id: 'outcome',
    passed: /OFFICE_RESULT\s*\{\s*"status"\s*:\s*"completed"\s*\}\s*$/.test(output),
  });
  tests.push({ id: 'unchanged', passed: unchanged });
  return {
    tests,
    passed: tests.every((test) => test.passed),
    defects: tests.filter((test) => !test.passed).length,
  };
}
export function compareMeasured(a, b) {
  if (
    !a?.quality?.passed ||
    !b?.quality?.passed ||
    a.status !== 'completed' ||
    b.status !== 'completed'
  )
    return { accepted: false, reason: 'quality_or_execution_failed' };
  if (
    [a.inputTokens, a.outputTokens, b.inputTokens, b.outputTokens].some(
      (value) => !Number.isSafeInteger(value) || value < 0,
    )
  )
    return { accepted: false, reason: 'usage_unknown' };
  if (
    ['requestedModel', 'effort', 'cliVersion', 'initialFilesHash'].some(
      (key) => typeof a[key] !== 'string' || a[key] !== b[key],
    ) ||
    a.sessionMode !== 'new' ||
    b.sessionMode !== 'new' ||
    !a.sessionHash ||
    !b.sessionHash ||
    a.sessionHash === b.sessionHash
  )
    return { accepted: false, reason: 'controls_mismatch' };
  const tokensA = a.inputTokens + a.outputTokens,
    tokensB = b.inputTokens + b.outputTokens;
  const dominates =
    tokensB <= tokensA &&
    b.durationMs <= a.durationMs &&
    (tokensB < tokensA || b.durationMs < a.durationMs);
  return {
    accepted: dominates,
    reason: dominates ? 'single_pair_candidate_only' : 'no_pareto_improvement',
    tokenDifference: tokensB - tokensA,
    durationDifferenceMs: b.durationMs - a.durationMs,
    stableImprovementProven: false,
  };
}
