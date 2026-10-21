import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadTools, root, sourceFingerprint } from './optimization-tools.mjs';

const { pixelOfficeChecks } = await loadTools();
const checks = pixelOfficeChecks(root);
if (!checks) throw new Error('Ejecuta npm run verify:local desde Pixel Office.');
const reportFile = join(root, 'reports/contexto/validacion-local.json');
const report = existsSync(reportFile)
  ? JSON.parse(readFileSync(reportFile, 'utf8'))
  : { inferenceCalls: 0, attempts: [] };
const controller = new AbortController();
const stop = () => controller.abort();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
const attempt = {
  startedAt: new Date().toISOString(),
  sourceFingerprint: sourceFingerprint(),
  results: [],
  passed: false,
};
report.attempts.push(attempt);
mkdirSync(join(root, 'reports/contexto'), { recursive: true });
try {
  for (const id of ['check-types', 'lint', 'test', 'context-study', 'package']) {
    const result = (await checks.run([id], root, controller.signal))[0];
    attempt.results.push(result);
    writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
    console.log(`${id}: ${result.passed ? 'OK' : 'FALLO'} (${result.durationMs} ms)`);
  }
  attempt.sourceUnchanged = attempt.sourceFingerprint === sourceFingerprint();
  attempt.passed =
    attempt.sourceUnchanged &&
    attempt.results.length === 5 &&
    attempt.results.every((item) => item.passed);
  if (!attempt.passed) process.exitCode = 1;
} finally {
  attempt.finishedAt = new Date().toISOString();
  writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
}
