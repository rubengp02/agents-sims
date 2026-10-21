import fs from 'node:fs';
import path from 'node:path';
import { loadTools, root, sourceFingerprint } from './optimization-tools.mjs';

const { LocalChecks, pixelOfficeChecks } = await loadTools();
const logRoot = path.join(root, '.local-office/agent-orchestrator/validation');
fs.mkdirSync(logRoot, { recursive: true });
const standard = pixelOfficeChecks(root);
if (!standard) throw new Error('No se encuentra el ejecutor npm para las comprobaciones locales.');
const extra = new LocalChecks(
  {
    study: {
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
    native: {
      executable: process.execPath,
      args: ['scripts/test-orchestrator-runtime.mjs'],
      timeoutMs: 60000,
    },
  },
  logRoot,
);
const report = {
  startedAt: new Date().toISOString(),
  sourceFingerprint: sourceFingerprint(),
  inferenceCalls: 0,
  results: [],
  passed: false,
};
const controller = new AbortController();
const save = () =>
  fs.writeFileSync(
    path.join(root, 'reports/agent-orchestrator/VALIDACION_LOCAL.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
for (const [runner, id] of [
  [standard, 'check-types'],
  [standard, 'lint'],
  [standard, 'test'],
  [extra, 'study'],
  [extra, 'native'],
  [standard, 'package'],
]) {
  const result = (await runner.run([id], root, controller.signal))[0];
  report.results.push(result);
  save();
  console.log(`${id}: ${result.passed ? 'OK' : 'FALLO'} (${result.durationMs} ms)`);
  if (!result.passed) {
    process.exitCode = 1;
    break;
  }
}
report.finishedAt = new Date().toISOString();
report.sourceUnchanged = report.sourceFingerprint === sourceFingerprint();
report.passed =
  report.results.length === 6 && report.results.every((r) => r.passed) && report.sourceUnchanged;
save();
