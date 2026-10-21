import fs from 'node:fs';
import path from 'node:path';
import { loadTools, root, sourceFingerprint } from './optimization-tools.mjs';

const { LocalChecks, pixelOfficeChecks } = await loadTools();
const runName = process.argv[2];
if (runName !== undefined && !/^[a-z][a-z0-9-]{0,63}$/.test(runName))
  throw new Error('Nombre de validación inválido.');
const standard = pixelOfficeChecks(root);
if (!standard) throw new Error('Falta el registro local de comprobaciones npm.');
const extra = new LocalChecks(
  {
    policies: {
      executable: process.execPath,
      args: [
        '--test',
        '--test-concurrency=1',
        'scripts/context-study.test.mjs',
        'scripts/benchmark.test.mjs',
        'scripts/benchmark-v2.test.mjs',
        'scripts/pilot-policy.test.mjs',
        ...(runName ? ['scripts/chief-pilot.test.mjs'] : []),
      ],
      timeoutMs: 60000,
    },
    simulation: {
      executable: process.execPath,
      args: ['scripts/adaptive-evaluation.mjs', ...(runName ? [runName] : [])],
      timeoutMs: 120000,
    },
    native: {
      executable: process.execPath,
      args: ['scripts/test-orchestrator-runtime.mjs'],
      timeoutMs: 60000,
    },
    chief: {
      executable: process.execPath,
      args: ['scripts/chief-decision-validation.mjs'],
      timeoutMs: 30000,
    },
  },
  path.join(root, '.local-office/adaptive-validation'),
);
const report = {
  sourceFingerprint: sourceFingerprint(),
  startedAt: new Date().toISOString(),
  inferenceCalls: 0,
  results: [],
  passed: false,
};
const file = path.join(
  root,
  'reports/optimizacion-adaptativa',
  ...(runName ? [runName] : []),
  'VALIDACION_LOCAL.json',
);
fs.mkdirSync(path.dirname(file), { recursive: true });
const save = () => fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
for (const [runner, id] of [
  [standard, 'check-types'],
  [standard, 'lint'],
  [standard, 'test'],
  [extra, 'policies'],
  ...(runName ? [[extra, 'chief']] : []),
  [extra, 'simulation'],
  [extra, 'native'],
  [standard, 'package'],
]) {
  const result = (await runner.run([id], root, new AbortController().signal))[0];
  report.results.push(result);
  save();
  console.log(`${id}: ${result.passed ? 'OK' : 'FALLO'} (${result.durationMs} ms)`);
  if (!result.passed) {
    process.exitCode = 1;
    break;
  }
}
report.sourceUnchanged = report.sourceFingerprint === sourceFingerprint();
report.finishedAt = new Date().toISOString();
report.passed =
  report.results.length === (runName ? 8 : 7) &&
  report.results.every((r) => r.passed) &&
  report.sourceUnchanged;
save();
