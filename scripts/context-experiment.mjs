// Pure experiment preparation. This module cannot launch a provider or authorize a turn.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fixtureFiles } from './benchmark/cases.mjs';

export const digest = (value) => createHash('sha256').update(value).digest('hex');
export const pilotPacket = (item) => ({
  objective: item.objective,
  files: item.files,
  decisions: ['Contrato completo en TASK.md; no modificar instrucciones ni pruebas.'],
  acceptance: item.contract.split('\n').filter(Boolean),
  checks: ['public', 'acceptance'],
});

/** Only this known fixture may use a file reference in place of inline acceptance. */
export function verifyCanonicalFiles(item, files) {
  const expected = fixtureFiles(item);
  for (const file of ['AGENTS.md', 'TASK.md', 'package.json', 'contract.test.mjs'])
    assert.equal(files[file], expected[file], `Archivo protegido distinto: ${file}`);
  assert.ok(files['TASK.md'].includes(item.contract));
  return Object.fromEntries(Object.entries(expected).map(([file, bytes]) => [file, digest(bytes)]));
}

export function contextVariants(item, tools) {
  const packet = pilotPacket(item);
  const files = fixtureFiles(item);
  const hashes = verifyCanonicalFiles(item, files);
  const standard = tools.prepareTaskContext('developer', packet.objective, packet);
  const compact = tools.prepareTaskContext('developer', packet.objective, packet, [], {
    variant: 'minimal-v1',
  });
  const canonical = tools.prepareTaskContext(
    'developer',
    `Lee AGENTS.md y TASK.md completos antes de editar. TASK.md contiene el objetivo y el contrato íntegro, incluidos los criterios de aceptación; cumple todos ellos. Solo puedes modificar ${item.files.join(', ')}. Conserva instrucciones, pruebas y dependencias. La aplicación ejecutará public y acceptance; investiga con pruebas adicionales si hacen falta para resolver un defecto.`,
    undefined,
    [],
    { variant: 'minimal-v1' },
  );
  return { packet, files, hashes, variants: { standard, compact, canonical } };
}

export function comparisonPlan(item, tools) {
  const prepared = contextVariants(item, tools);
  const arm = (method, variant) => ({
    method,
    variant,
    engine: 'codex-cli',
    model: 'gpt-6.1-sol',
    effort: 'low',
    sessionMode: 'new',
    allowWrites: true,
    role: 'developer',
    fixtureHash: digest(JSON.stringify(prepared.hashes)),
    submittedPromptHash: digest(tools.CODEX_TASK_PREFIX + prepared.variants[variant].prompt),
    acceptanceHash: digest(JSON.stringify(prepared.packet.acceptance)),
    checks: prepared.packet.checks,
  });
  return {
    protocol: 'context-controlled-offline-v1',
    authorizedRealRuns: 0,
    executableRealRunner: false,
    status: 'offline-preparation-only',
    limits: { realRuns: 0, realTokens: 0, retries: 0 },
    arms: ['standard', 'compact', 'canonical'].flatMap((variant) =>
      ['direct', 'office'].map((method) => arm(method, variant)),
    ),
    invariants: [
      'same Codex CLI binary and configuration',
      'same model and effort',
      'same complete contract, protected file hashes and allowed edits',
      'same submitted prompt for direct and office within a variant',
      'same subscription verification, permissions and checks',
      'fresh separate workspaces and sessions; no concurrent benchmark runs',
      'local initialization and public tests, independent 36-check acceptance and scope check for every arm',
    ],
    futureAuthorization:
      'Exact aggregate run, token and time bounds must be approved before implementing or starting a real runner. Previous ledgers remain closed.',
    design:
      'Interleave balanced order across repeated pairs, record order and all failures. Report medians and individual runs, never only the best. Cache is observed, not assumed equal. Limit hits and unknown counters are censored failures, never excluded to claim savings.',
    gates:
      'No promotion until acceptance, protected files, local checks, subscription and limits all pass; then repeat to demonstrate fewer total tokens without a material latency regression. Zero observed defects is not proof of exhaustive quality.',
    engineExperiment:
      'AO remains optional. Compare AO against CLI separately after aligning flags, permission profile and submitted prefix; do not mix transport with the primary context contrast.',
    lunaExperiment:
      'Separate Sol/low vs Luna/low after current subscription catalog validation. Keep engine, context, task, session mode and acceptance fixed; include failures and repairs in total cost. No automatic promotion.',
    sessionExperiment:
      'Separate two-step new/new vs new/resume with identical second-step goal and starting revision. Include both steps and cumulative-counter deltas, cache, stale-context defects and time. Explicit session ownership; reviewers never resume the author.',
  };
}
