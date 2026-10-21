// All registered checks are local. No real-provider mode or authorization writer.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadTools, root, sourceFingerprint } from './optimization-tools.mjs';
import { digest } from './context-experiment.mjs';

const name = process.argv[2] ?? 'validacion-1';
assert.match(name, /^[a-z][a-z0-9-]{0,63}$/);
const destination = path.join(root, 'reports/optimizacion-contexto', name + '.json');
assert(!fs.existsSync(destination), 'Este informe ya existe; elige otro nombre para conservarlo.');
const oldReports = execFileSync('git', ['ls-files', 'reports'], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
})
  .trim()
  .split(/\r?\n/)
  .filter(Boolean);
const hashes = () =>
  Object.fromEntries(oldReports.map((f) => [f, digest(fs.readFileSync(path.join(root, f)))]));
const previous = hashes();
const tools = await loadTools();
const standard = tools.pixelOfficeChecks(root);
assert(standard);
const extra = new tools.LocalChecks(
  {
    policies: {
      executable: process.execPath,
      args: [
        '--test',
        '--test-concurrency=1',
        'scripts/context-experiment.test.mjs',
        'scripts/context-study.test.mjs',
        'scripts/benchmark.test.mjs',
        'scripts/benchmark-v2.test.mjs',
        'scripts/pilot-policy.test.mjs',
        'scripts/chief-pilot.test.mjs',
      ],
      timeoutMs: 60000,
    },
    native: {
      executable: process.execPath,
      args: ['scripts/test-orchestrator-runtime.mjs'],
      timeoutMs: 60000,
    },
    context: {
      executable: process.execPath,
      args: ['scripts/context-audit.mjs', name + '-comparacion'],
      timeoutMs: 30000,
    },
  },
  path.join(root, '.local-office/context-validation', name),
);
const report = {
  sourceFingerprint: sourceFingerprint(),
  inferenceCalls: 0,
  results: [],
  passed: false,
};
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, JSON.stringify(report), { flag: 'wx' });
const save = () => fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
try {
  for (const [runner, id] of [
    [standard, 'check-types'],
    [standard, 'lint'],
    [standard, 'test'],
    [extra, 'policies'],
    [extra, 'native'],
    [extra, 'context'],
    [standard, 'package'],
  ]) {
    const r = (await runner.run([id], root, new AbortController().signal))[0];
    report.results.push(r);
    save();
    console.log(`${id}: ${r.passed ? 'OK' : 'FALLO'} (${r.durationMs} ms)`);
    if (!r.passed) break;
  }
} finally {
  report.sourceUnchanged = sourceFingerprint() === report.sourceFingerprint;
  report.historicalReportsUnchanged = JSON.stringify(previous) === JSON.stringify(hashes());
  report.historicalReportCount = oldReports.length;
  report.passed =
    report.results.length === 7 &&
    report.results.every((r) => r.passed) &&
    report.sourceUnchanged &&
    report.historicalReportsUnchanged;
  save();
  if (!report.passed) process.exitCode = 1;
}
