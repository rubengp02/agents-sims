// Local process supervision only. No provider, account or credential operations.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { root } from './optimization-tools.mjs';

const script = fileURLToPath(import.meta.url);
const powershell = path.join(
  process.env.SYSTEMROOT ?? 'C:\\Windows',
  'System32/WindowsPowerShell/v1.0/powershell.exe',
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
export function writeJson(file, value, exclusive = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bytes = JSON.stringify(value, null, 2) + '\n';
  if (exclusive) fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
  else {
    const temp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(temp, bytes, { mode: 0o600 });
    fs.renameSync(temp, file);
  }
}
export function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}
export function identityOf(pid = process.pid) {
  assert(Number.isSafeInteger(pid) && pid > 0);
  if (!alive(pid)) return null;
  const started =
    process.platform === 'win32'
      ? execFileSync(
          powershell,
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`,
          ],
          {
            encoding: 'utf8',
            windowsHide: true,
            timeout: 5000,
            stdio: ['ignore', 'pipe', 'ignore'],
          },
        ).trim()
      : execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {
          encoding: 'utf8',
          timeout: 3000,
        }).trim();
  assert(started);
  return { pid, started };
}
export async function stopOwned(identity) {
  if (!identity || !alive(identity.pid)) return 'absent';
  let current;
  try {
    current = identityOf(identity.pid);
  } catch {
    return 'identity-unverifiable';
  }
  if (!current || current.started !== identity.started) return 'identity-mismatch';
  try {
    if (process.platform === 'win32')
      execFileSync(
        path.join(process.env.SYSTEMROOT ?? 'C:\\Windows', 'System32/taskkill.exe'),
        ['/pid', String(identity.pid), '/t', '/f'],
        { windowsHide: true, stdio: 'ignore', timeout: 8000 },
      );
    else process.kill(identity.pid, 'SIGKILL');
  } catch {
    if (alive(identity.pid)) return 'stop-unverified';
  }
  for (let i = 0; i < 20 && alive(identity.pid); i++) await sleep(50);
  return alive(identity.pid) ? 'stop-unverified' : 'stopped';
}

/** The Windows launch deliberately has no dependency on a terminal session ID. */
export function launchHidden(args, outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  if (process.platform === 'win32') {
    const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
    const argumentText = args.map((a) => '"' + a.replaceAll('"', '\\"') + '"').join(' ');
    // Redirecting PS 5.1 child pipes keeps the launching channel alive. The
    // supervisor writes its own structured journals instead of inheriting pipes.
    const command = `Start-Process -FilePath ${quote(process.execPath)} -ArgumentList ${quote(argumentText)} -WorkingDirectory ${quote(root)} -WindowStyle Hidden -PassThru | Select-Object -ExpandProperty Id`;
    const pid = Number(
      execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 10000,
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim(),
    );
    return identityOf(pid);
  }
  const fd = fs.openSync(outFile, 'a', 0o600);
  const child = spawn(process.execPath, args, {
    cwd: root,
    detached: true,
    stdio: ['ignore', fd, fd],
  });
  child.unref();
  fs.closeSync(fd);
  return identityOf(child.pid);
}
const files = (privateDir) => ({
  dir: path.join(privateDir, 'supervision'),
  spec: path.join(privateDir, 'supervision/spec.json'),
  owner: path.join(privateDir, 'supervision/owner.json'),
  guard: path.join(privateDir, 'supervision/guard.json'),
  lease: path.join(privateDir, 'supervision/controller.json'),
});

export function launchSupervised({ privateDir, reports, attempt, fixture = null }) {
  const f = files(privateDir),
    plan = readJson(path.join(reports, 'PLAN.json'));
  assert(plan);
  assert(!fs.existsSync(path.join(privateDir, 'ledger.json')));
  assert(!fs.existsSync(f.spec), 'El lanzamiento existente nunca se reinicia.');
  const spec = {
    privateDir,
    reports,
    attempt,
    fixture,
    nonce: randomUUID(),
    startedAt: Date.now(),
    limits: plan.limits,
    heartbeatMs: 1000,
    staleMs: 12000,
    bootMs: 15000,
  };
  writeJson(f.spec, spec, true);
  const supervisor = launchHidden(
    [script, 'supervise', f.spec],
    path.join(f.dir, 'supervisor.log'),
  );
  writeJson(path.join(f.dir, 'launch.json'), { supervisor, startedAt: spec.startedAt }, true);
  return supervisor;
}

/** Only the winner of this recovery lock may close an interrupted attempt. */
async function recover(spec, reason) {
  const f = files(spec.privateDir);
  if (readJson(path.join(spec.privateDir, 'ledger.json'))?.closed) return;
  try {
    writeJson(path.join(f.dir, 'recovery.lock'), { reason, at: Date.now() }, true);
  } catch (error) {
    if (error.code === 'EEXIST') return;
    throw error;
  }
  const owner = readJson(f.owner),
    lease = readJson(f.lease);
  if (owner) assert(owner.nonce === spec.nonce);
  const controllerStop = owner ? await stopOwned(owner.controller) : 'identity-unavailable';
  const workerStop = await stopOwned(lease?.nonce === spec.nonce ? lease.worker : null);
  const file = path.join(spec.privateDir, 'ledger.json');
  const ledger = readJson(file) ?? { startedAt: spec.startedAt, attempts: 0, tokens: 0 };
  const reportFile = path.join(spec.reports, 'RESULTADO.json');
  const report = readJson(reportFile) ?? {
    runs: [],
    arms: [],
    mode: spec.fixture ? 'offline-fixture' : 'real-pilot',
    limits: spec.limits,
  };
  if (fs.existsSync(reportFile))
    fs.copyFileSync(
      reportFile,
      path.join(f.dir, 'report-before-recovery.json'),
      fs.constants.COPYFILE_EXCL,
    );
  const partial = ledger.tokens;
  ledger.closed = true;
  ledger.paused = true;
  ledger.reason = reason;
  if (ledger.attempts > report.runs.length || lease?.phase === 'model') ledger.tokens = null;
  report.status = 'paused';
  report.reason = reason;
  report.observedTokens = ledger.tokens;
  report.inferenceObserved = spec.fixture ? false : ledger.attempts ? null : false;
  report.recovery = {
    reason,
    controllerStop,
    workerStop,
    cleanupVerified: [controllerStop, workerStop].every((v) => ['stopped', 'absent'].includes(v)),
    partialObservedTokens: partial,
    activeReceipt: lease?.record ?? null,
    at: new Date().toISOString(),
    noAutomaticRetry: true,
  };
  writeJson(reportFile, report);
  writeJson(file, ledger);
  writeJson(path.join(spec.reports, 'RECUPERACION.json'), report.recovery);
}

/** Reconcile after both monitors/terminal disappear; never dispatches or retries. */
export async function reconcileSupervision(privateDir) {
  const f = files(privateDir),
    spec = readJson(f.spec);
  assert(spec);
  const ledger = readJson(path.join(privateDir, 'ledger.json'));
  if (!ledger?.closed) {
    const owner = readJson(f.owner),
      guard = readJson(f.guard),
      now = Date.now();
    let reason;
    if (now - spec.startedAt >= spec.limits.totalMs) reason = 'total_time_budget';
    else if (owner && !alive(owner.supervisor.pid)) reason = 'supervisor_lost';
    else if (owner?.controller && !alive(owner.controller.pid))
      reason = 'execution_controller_lost';
    else if (guard && !alive(guard.identity.pid)) reason = 'guardian_lost';
    else if (!owner && now - spec.startedAt > spec.bootMs) reason = 'supervision_start_failed';
    else if (owner && now - owner.heartbeatAt > spec.staleMs) reason = 'supervisor_heartbeat_lost';
    if (reason) await recover(spec, reason);
  }
  return {
    ledger: readJson(path.join(privateDir, 'ledger.json')),
    report: readJson(path.join(spec.reports, 'RESULTADO.json')),
  };
}

async function supervise(specFile) {
  const spec = readJson(specFile),
    f = files(spec.privateDir);
  const owner = {
    nonce: spec.nonce,
    supervisor: identityOf(),
    controller: null,
    heartbeatAt: Date.now(),
  };
  writeJson(f.owner, owner, true);
  let recovering = false,
    recoveryPromise;
  const heartbeat = setInterval(() => {
    owner.heartbeatAt = Date.now();
    writeJson(f.owner, owner);
    const guard = readJson(f.guard);
    if (
      !recovering &&
      guard &&
      (!alive(guard.identity.pid) || Date.now() - guard.heartbeatAt > spec.staleMs)
    ) {
      recovering = true;
      recoveryPromise = recover(spec, 'guardian_lost');
    }
  }, spec.heartbeatMs);
  let child;
  try {
    launchHidden([script, 'watch', specFile], path.join(f.dir, 'watchdog.log'));
    const bootEnd = Date.now() + spec.bootMs;
    while (readJson(f.guard)?.nonce !== spec.nonce) {
      assert(Date.now() < bootEnd, 'El vigilante no confirmó arranque.');
      await sleep(50);
    }
    const args = spec.fixture
      ? [path.join(root, 'scripts/fixtures/pilot-supervision-worker.mjs'), specFile]
      : [path.join(root, 'scripts/context-pilot.mjs'), 'execute-supervised', spec.attempt];
    child = spawn(process.execPath, args, { cwd: root, windowsHide: true, stdio: 'ignore' });
    const exit = new Promise((resolve) => {
      child.once('close', resolve);
      child.once('error', () => resolve(null));
    });
    owner.controller = identityOf(child.pid);
    owner.heartbeatAt = Date.now();
    writeJson(f.owner, owner);
    await exit;
    await recoveryPromise;
    if (!readJson(path.join(spec.privateDir, 'ledger.json'))?.closed)
      await recover(spec, 'execution_controller_lost');
  } catch {
    await recover(spec, 'supervisor_failed');
  } finally {
    clearInterval(heartbeat);
  }
}

async function watch(specFile) {
  const spec = readJson(specFile),
    f = files(spec.privateDir);
  const guard = { nonce: spec.nonce, identity: identityOf(), heartbeatAt: Date.now() };
  writeJson(f.guard, guard, true);
  while (true) {
    guard.heartbeatAt = Date.now();
    writeJson(f.guard, guard);
    const owner = readJson(f.owner),
      lease = readJson(f.lease),
      ledger = readJson(path.join(spec.privateDir, 'ledger.json'));
    if (ledger?.closed) {
      await stopOwned(lease?.nonce === spec.nonce ? lease.worker : null);
      return;
    }
    const now = Date.now();
    let reason;
    if (!owner || owner.nonce !== spec.nonce) reason = 'supervision_ownership_lost';
    else if (!alive(owner.supervisor.pid) || now - owner.heartbeatAt > spec.staleMs)
      reason = 'supervisor_lost';
    else if (now - spec.startedAt >= spec.limits.totalMs) reason = 'total_time_budget';
    else if (owner.controller && !alive(owner.controller.pid)) reason = 'execution_controller_lost';
    else if (
      now - spec.startedAt > spec.bootMs &&
      (!lease || now - lease.heartbeatAt > spec.staleMs)
    )
      reason = 'controller_heartbeat_lost';
    else if (lease?.phase === 'model' && now - lease.modelStartedAt >= spec.limits.perRunMs)
      reason = 'model_time_budget';
    else if (lease?.armStartedAt && now - lease.armStartedAt >= spec.limits.perArmMs)
      reason = 'arm_time_budget';
    if (reason) {
      await recover(spec, reason);
      return;
    }
    await sleep(Math.min(spec.heartbeatMs, 1000));
  }
}

/** Safe diagnostic codes only: never persist an exception message or file path. */
export function supervisionValidator(spec, read = readJson, isAlive = alive, now = Date.now) {
  const f = files(spec.privateDir);
  return () => {
    for (const [component, file, identityKey] of [
      ['guardian', f.guard, 'identity'],
      ['supervisor', f.owner, 'supervisor'],
    ]) {
      let state;
      try {
        state = read(file);
      } catch (error) {
        const detail = ['EACCES', 'EPERM', 'EBUSY', 'EIO', 'ENOENT'].includes(error.code)
          ? error.code
          : error instanceof SyntaxError
            ? 'invalid_json'
            : 'unclassified';
        throw Object.assign(new Error('Supervision state cannot be read.'), {
          code: 'supervision_read_failed',
          component,
          detail,
        });
      }
      let detail;
      if (!state) detail = 'missing';
      else if (state.nonce !== spec.nonce) detail = 'ownership';
      else if (!isAlive(state[identityKey]?.pid)) detail = 'process_absent';
      else if (!Number.isFinite(state.heartbeatAt)) detail = 'invalid_heartbeat';
      else if (now() - state.heartbeatAt >= spec.staleMs) detail = 'heartbeat_expired';
      if (detail)
        throw Object.assign(new Error('Supervision validation failed.'), {
          code: 'supervision_invalid',
          component,
          detail,
        });
    }
  };
}

export function saveSupervisionIncident(privateDir, error, stage) {
  const allowed = [
    'missing',
    'ownership',
    'process_absent',
    'invalid_heartbeat',
    'heartbeat_expired',
    'EACCES',
    'EPERM',
    'EBUSY',
    'EIO',
    'ENOENT',
    'invalid_json',
  ];
  const incident = {
    at: new Date().toISOString(),
    stage: stage === 'validation' ? 'validation' : 'heartbeat_write',
    code: ['supervision_read_failed', 'supervision_invalid'].includes(error.code)
      ? error.code
      : 'supervision_state_write_failed',
    component: ['guardian', 'supervisor'].includes(error.component)
      ? error.component
      : 'controller',
    detail: allowed.includes(error.detail ?? error.code)
      ? (error.detail ?? error.code)
      : 'unclassified',
    noAutomaticRetry: true,
  };
  writeJson(path.join(privateDir, 'supervision/INCIDENCIA.json'), incident, true);
  return incident;
}

/** The controller cannot dispatch until an independent guardian is alive. */
export async function attachSupervision(privateDir) {
  const f = files(privateDir),
    spec = readJson(f.spec);
  assert(spec && !spec.fixture);
  const own = identityOf(),
    until = Date.now() + spec.bootMs;
  while (readJson(f.owner)?.controller?.pid !== process.pid) {
    assert(Date.now() < until);
    await sleep(50);
  }
  const owner = readJson(f.owner);
  assert.equal(owner.controller.started, own.started);
  const state = {
    nonce: spec.nonce,
    heartbeatAt: Date.now(),
    phase: 'startup',
    armStartedAt: null,
    modelStartedAt: null,
    worker: null,
    record: null,
  };
  const persist = () => {
    state.heartbeatAt = Date.now();
    writeJson(f.lease, state);
  };
  const validate = supervisionValidator(spec);
  validate();
  persist();
  let lostCallback = () => {},
    lost = false;
  const heartbeat = setInterval(() => {
    let stage = 'validation';
    try {
      validate();
      stage = 'heartbeat_write';
      persist();
    } catch (error) {
      if (!lost) {
        lost = true;
        try {
          saveSupervisionIncident(privateDir, error, stage);
        } catch {
          // A failed diagnostic write never prevents the mandatory pause.
        }
        lostCallback();
      }
    }
  }, spec.heartbeatMs);
  return {
    startedAt: spec.startedAt,
    validate,
    onLost(callback) {
      lostCallback = callback;
    },
    arm() {
      validate();
      state.phase = 'arm';
      state.armStartedAt = Date.now();
      state.modelStartedAt = null;
      state.worker = null;
      state.record = null;
      persist();
    },
    model() {
      validate();
      state.phase = 'model';
      state.modelStartedAt = Date.now();
      persist();
    },
    launched(child) {
      try {
        state.worker = identityOf(child.pid);
        assert(state.worker);
        persist();
      } catch (error) {
        if (child.pid) {
          try {
            execFileSync(
              path.join(process.env.SYSTEMROOT ?? 'C:\\Windows', 'System32/taskkill.exe'),
              ['/pid', String(child.pid), '/t', '/f'],
              { stdio: 'ignore', windowsHide: true, timeout: 5000 },
            );
          } catch {}
        }
        throw error;
      }
    },
    record(r) {
      state.record = {
        status: r.status,
        input: r.inputTokens,
        output: r.outputTokens,
        cached: r.cachedInputTokens ?? null,
        subscriptionVerified: !!r.subscriptionCheckedAt,
        metrics: r.metrics ?? null,
      };
      persist();
    },
    endModel() {
      assert(!state.worker || !alive(state.worker.pid), 'El proceso del turno sigue activo.');
      state.phase = 'checks';
      state.modelStartedAt = null;
      state.worker = null;
      persist();
    },
    endArm() {
      state.phase = 'between-arms';
      state.armStartedAt = null;
      persist();
    },
    close() {
      clearInterval(heartbeat);
    },
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  assert.equal(process.argv.length, 4);
  if (process.argv[2] === 'supervise') await supervise(process.argv[3]);
  else if (process.argv[2] === 'watch') await watch(process.argv[3]);
  else throw new Error('Modo de supervisión desconocido.');
}
