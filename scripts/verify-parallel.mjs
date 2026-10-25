import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { root, sourceFingerprint } from './optimization-tools.mjs';
import { identityOf, stopOwned } from './pilot-supervision.mjs';
import { futureProtocols } from './parallel-protocol.mjs';
import { validationDiagnostics } from './validation-diagnostics.mjs';

const id = randomUUID().slice(0, 8),
  privateDir = path.join(root, '.local-office', 'parallel-validation', id);
const publicDir = path.join(root, 'reports/oficina-paralela');
fs.mkdirSync(privateDir, { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });
const report = {
  version: 1,
  mode: 'local-only',
  inferenceCalls: 0,
  startedAt: new Date().toISOString(),
  sourceFingerprint: sourceFingerprint(),
  checks: [],
  passed: false,
};
const file = path.join(publicDir, 'VALIDACION-' + id + '.json');
const save = () => fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(
  path.join(publicDir, 'PROTOCOLOS-' + id + '.json'),
  JSON.stringify(
    futureProtocols.map((p) => ({ ...p, sourceFingerprint: report.sourceFingerprint })),
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
const jobs = [
  ['package', 'npm', ['run', 'package']],
  ['application', 'npm', ['test']],
  [
    'policies',
    process.execPath,
    [
      '--test',
      '--test-concurrency=1',
      'scripts/context-study.test.mjs',
      'scripts/benchmark.test.mjs',
      'scripts/benchmark-v2.test.mjs',
      'scripts/pilot-policy.test.mjs',
      'scripts/chief-pilot.test.mjs',
      'scripts/parallel-evaluation.test.mjs',
      'scripts/parallel-real-pilot.test.mjs',
      'scripts/validation-diagnostics.test.mjs',
    ],
  ],
  ['supervision', process.execPath, ['--test', 'scripts/pilot-supervision.test.mjs']],
  ['native-ao', 'npm', ['run', 'engine:test']],
  ['matrix', process.execPath, ['scripts/parallel-evaluation.mjs']],
  ['standalone', 'npm', ['run', 'test:standalone']],
];
const npmCli =
  process.env.npm_execpath ??
  path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
if (!fs.existsSync(npmCli)) throw new Error('No se encuentra el CLI local de npm.');
for (const [name, exe, args] of jobs) {
  const at = Date.now(),
    out = fs.openSync(path.join(privateDir, name + '.log'), 'wx', 0o600);
  const child = spawn(
    exe === 'npm' ? process.execPath : exe,
    exe === 'npm' ? [npmCli, ...args] : args,
    {
      cwd: root,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', out, out],
    },
  );
  let timedOut = false,
    identity;
  try {
    identity = identityOf(child.pid);
  } catch {
    /* A timeout will require human cleanup if identity is unavailable. */
  }
  const timer = setTimeout(() => {
    timedOut = true;
    if (identity) void stopOwned(identity);
  }, 180000);
  const result = await new Promise((resolve) => {
    child.once('error', () => resolve(null));
    child.once('close', resolve);
  });
  clearTimeout(timer);
  fs.closeSync(out);
  report.checks.push({
    id: name,
    passed: result === 0 && !timedOut,
    exitCode: result,
    timedOut,
    durationMs: Date.now() - at,
  });
  save();
  console.log(`${name}: ${result === 0 && !timedOut ? 'OK' : 'FALLO'} (${Date.now() - at} ms)`);
  if (result !== 0 || timedOut) {
    // Publish only TAP failure names and scalar assertions, never raw private
    // logs, provider output, stack traces, file paths or arbitrary messages.
    const diagnostics = validationDiagnostics(
      fs.readFileSync(path.join(privateDir, name + '.log'), 'utf8'),
    );
    console.log(JSON.stringify({ check: name, diagnostics }));
    process.exitCode = 1;
    break;
  }
}
report.sourceUnchanged = report.sourceFingerprint === sourceFingerprint();
report.finishedAt = new Date().toISOString();
report.passed =
  report.checks.length === jobs.length &&
  report.checks.every((c) => c.passed) &&
  report.sourceUnchanged;
if (!report.passed) process.exitCode = 1;
save();
console.log(
  JSON.stringify({ report: path.basename(file), passed: report.passed, inferenceCalls: 0 }),
);
