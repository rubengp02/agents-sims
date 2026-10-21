// Bounded OS-process regression study. No model or provider is imported.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const count = Number(process.argv[2] ?? 5);
if (!Number.isInteger(count) || count < 1 || count > 10)
  throw new Error('Repetitions must be 1..10');
const startedAt = Date.now();
const directory = path.resolve('.local-office', 'supervision-study', randomUUID());
fs.mkdirSync(directory, { recursive: true });
const report = {
  version: 1,
  platform: process.platform,
  node: process.version,
  inferenceCalls: 0,
  repetitions: count,
  attempts: [],
  passed: false,
};
for (let index = 0; index < count; index++) {
  if (Date.now() - startedAt > 12 * 60_000) break;
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', 'scripts/pilot-supervision.test.mjs'],
    { encoding: 'utf8', timeout: 120_000, maxBuffer: 4_000_000, windowsHide: true },
  );
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  fs.writeFileSync(path.join(directory, `${index + 1}.log`), output, { mode: 0o600 });
  const failures = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        /^not ok \d+ - [a-zA-Z0-9 ,.:()/_-]+$/.test(line) ||
        /^(?:expected|actual): (?:true|false|null|\d+)$/.test(line),
    );
  const passedTests = Number(/^# pass (\d+)$/m.exec(output)?.[1] ?? 0);
  const failedTests = Number(/^# fail (\d+)$/m.exec(output)?.[1] ?? 0);
  const attempt = {
    index: index + 1,
    passed: result.status === 0 && passedTests >= 13,
    exitCode: result.status,
    signal: result.signal,
    passedTests,
    failedTests,
    failures,
  };
  report.attempts.push(attempt);
  console.log(JSON.stringify(attempt));
  // Stop on failure: retained processes and journals need diagnosis first.
  if (!attempt.passed) break;
}
report.durationMs = Date.now() - startedAt;
report.passed = report.attempts.length === count && report.attempts.every((a) => a.passed);
fs.mkdirSync('reports/supervision-study', { recursive: true });
fs.writeFileSync(
  `reports/supervision-study/${process.platform}.json`,
  JSON.stringify(report, null, 2) + '\n',
);
if (!report.passed) process.exitCode = 1;
