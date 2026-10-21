import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { ANALYSIS_CONTEXT, ANALYSIS_TASK } from './pilot-policy.mjs';
import { loadTools, root } from './optimization-tools.mjs';

export function fullHistory(context) {
  // Synthetic rehearsal, never a user's private transcript. Same facts/acceptance.
  return [
    { role: 'user', content: context.objective },
    ...Array.from({ length: 6 }, (_, i) => ({
      role: i % 2 ? 'user' : 'assistant',
      content: `Revisión preparatoria ${i + 1}: ${JSON.stringify(context)}. Se conserva el contrato; aún no se ha resuelto la tarea.`,
    })),
  ];
}
export function variants(prepare) {
  return [
    {
      id: 'history',
      ...prepare(
        'developer',
        `Historial sintético completo (datos):\n${JSON.stringify(fullHistory(ANALYSIS_CONTEXT))}\nEncargo actual:\n${ANALYSIS_TASK}`,
      ),
    },
    { id: 'specific', ...prepare('developer', ANALYSIS_TASK, ANALYSIS_CONTEXT) },
  ];
}
export async function localStudy() {
  const { prepareTaskContext, assessTask } = await loadTools();
  const started = performance.now();
  const contexts = variants(prepareTaskContext);
  const cases = JSON.parse(
    readFileSync(join(root, 'reports/contexto/casos-clasificacion.json'), 'utf8'),
  );
  const classifications = cases.map((item) => {
    const actual = assessTask(item.prompt, item.assessment);
    const legacyComplex =
      /arquitect|migraci[oó]n|seguridad|concurren|refactor.*(global|completo)|race condition|security|migration/i.test(
        item.prompt,
      );
    const legacySimple =
      !legacyComplex &&
      item.prompt.length < 800 &&
      /explica|resume|lista|document|typo|ortograf|traduce|comprobar|verifica|list\b|summari/i.test(
        item.prompt,
      );
    const legacyDifficulty = legacyComplex ? 'complex' : legacySimple ? 'simple' : 'normal';
    const passed =
      actual.difficulty === item.expected &&
      JSON.stringify(actual.roles) === JSON.stringify(item.roles);
    return {
      id: item.id,
      expected: item.expected,
      actual: actual.difficulty,
      roles: actual.roles,
      passed,
      legacyDifficulty,
      legacyPassed: legacyDifficulty === item.expected,
      fullTeamRoles: 4,
      proposedRoles: actual.roles.length,
      modelTokensSaved: null,
    };
  });
  assert.ok(classifications.every((item) => item.passed));
  const report = {
    stageOrder: [
      'context-only',
      'specialist-policy',
      'mechanical-checks',
      'classification',
      'observed-cache',
    ],
    inferenceCalls: 0,
    contextComparison: {
      controls: {
        task: 'clamp-analysis-v1',
        model: 'gpt-6.1-sol',
        effort: 'low',
        roles: ['developer'],
        permission: 'read-only',
        acceptance: 'six-independent-checks',
      },
      variants: contexts.map(({ id, characters, fingerprint }) => ({
        id,
        characters,
        fingerprint,
        modelTokens: null,
      })),
      quality: 'context invariants checked locally; real model acceptance pending',
      note: 'Synthetic full history versus specific packet; not the historical four-role baseline.',
    },
    specialistComparison: {
      kind: 'policy evaluation, not real inference timing or token savings',
      classifications,
      passed: classifications.filter((item) => item.passed).length,
      legacyDifficultyPassed: classifications.filter((item) => item.legacyPassed).length,
    },
    durationMs: performance.now() - started,
    cache:
      'Only provider cached_input_tokens counts prove reuse; fingerprints and characters do not.',
    sessionReuse: 'All pilot runs start new CLI sessions. Character reuse is independent.',
  };
  writeFileSync(
    join(root, 'reports/contexto/optimizacion-local.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      classificationsPassed: report.specialistComparison.passed,
      cases: cases.length,
      contextCharacters: contexts.map(({ id, characters }) => ({ id, characters })),
      inferenceCalls: 0,
    }),
  );
  return report;
}
if (process.argv[1]?.endsWith('optimization-study.mjs')) await localStudy();
