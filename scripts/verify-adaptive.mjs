import fs from 'node:fs';
import path from 'node:path';
import { loadTools, root, sourceFingerprint } from './optimization-tools.mjs';

const { LocalChecks, pixelOfficeChecks } = await loadTools();
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
      ],
      timeoutMs: 60000,
    },
    simulation: {
      executable: process.execPath,
      args: ['scripts/adaptive-evaluation.mjs'],
      timeoutMs: 120000,
    },
    native: {
      executable: process.execPath,
      args: ['scripts/test-orchestrator-runtime.mjs'],
      timeoutMs: 60000,
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
const file = path.join(root, 'reports/optimizacion-adaptativa/VALIDACION_LOCAL.json');
const save = () => fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
for (const [runner, id] of [
  [standard, 'check-types'],
  [standard, 'lint'],
  [standard, 'test'],
  [extra, 'policies'],
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
  report.results.length === 7 && report.results.every((r) => r.passed) && report.sourceUnchanged;
save();
