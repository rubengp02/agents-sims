import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readdirSync, readFileSync, lstatSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureFiles } from './cases.mjs';
import { hash } from './protocol.mjs';

export function materialize(project, item, reference = false) {
  mkdirSync(project, { recursive: false });
  for (const [name, content] of Object.entries(fixtureFiles(item, reference)))
    writeFileSync(join(project, name), content);
}
export function snapshot(project) {
  const files = {};
  function visit(relative = '') {
    for (const name of readdirSync(join(project, relative)).sort()) {
      const file = join(relative, name),
        stat = lstatSync(join(project, file));
      if (stat.isSymbolicLink()) throw new Error('Symbolic link in benchmark workspace');
      if (stat.isDirectory()) visit(file);
      else
        files[file.replaceAll('\\', '/')] = hash(
          readFileSync(join(project, file)).toString('base64'),
        );
    }
  }
  visit();
  return files;
}
export function inspectChanges(before, after, allowed) {
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (file) => before[file] !== after[file],
  );
  return {
    changed,
    unexpected: changed.filter((file) => !allowed.includes(file)),
    passed:
      changed.every((file) => allowed.includes(file)) &&
      allowed.every((file) => Object.hasOwn(after, file)),
  };
}
function localEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|TMPDIR|COMSPEC|PATHEXT|LANG|LC_ALL)$/i.test(key),
    ),
  );
}
export async function runCommand(executable, args, project, timeoutMs, signal, stopProcess) {
  const start = Date.now();
  let output = '',
    overflow = false,
    timedOut = false;
  const child = spawn(executable, args, {
    cwd: project,
    env: localEnvironment(),
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stop = () => {
    void stopProcess(child);
  };
  const collect = (chunk) => {
    output += chunk.toString();
    if (output.length > 100000) {
      output = output.slice(0, 100000);
      overflow = true;
      stop();
    }
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', () => {});
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  const timer = setTimeout(() => {
    timedOut = true;
    stop();
  }, timeoutMs);
  const exitCode = await new Promise((resolve) => {
    child.once('error', () => resolve(null));
    child.once('close', resolve);
  });
  clearTimeout(timer);
  signal?.removeEventListener('abort', stop);
  if (timedOut || signal?.aborted || overflow) await stopProcess(child);
  return {
    exitCode,
    passed: exitCode === 0 && !timedOut && !signal?.aborted && !overflow,
    durationMs: Date.now() - start,
    output,
    timedOut,
    overflow,
  };
}
export async function acceptance(item, project, stopProcess, signal) {
  const result = await runCommand(
    process.execPath,
    [join(dirname(fileURLToPath(import.meta.url)), 'acceptance-worker.mjs'), item.id, project],
    project,
    5000,
    signal,
    stopProcess,
  );
  let quality;
  try {
    quality = JSON.parse(result.output.trim().split(/\r?\n/).at(-1));
  } catch {
    quality = { passed: false, tests: [], failedChecks: ['oracle_unavailable'] };
  }
  if (
    quality.caseId !== item.id ||
    !Array.isArray(quality.tests) ||
    !quality.tests.length ||
    !Array.isArray(quality.failedChecks) ||
    quality.tests.some((test) => typeof test.id !== 'string' || typeof test.passed !== 'boolean')
  )
    quality = { passed: false, tests: [], failedChecks: ['oracle_invalid'] };
  return {
    ...quality,
    passed:
      result.passed &&
      quality.passed === true &&
      quality.tests.every((test) => test.passed) &&
      quality.failedChecks.length === 0,
    durationMs: result.durationMs,
  };
}
