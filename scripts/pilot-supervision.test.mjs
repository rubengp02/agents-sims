import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import test from 'node:test';
import {
  alive,
  identityOf,
  launchSupervised,
  readJson,
  stopOwned,
  writeJson,
  reconcileSupervision,
  supervisionValidator,
  saveSupervisionIncident,
} from './pilot-supervision.mjs';
import { root } from './optimization-tools.mjs';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function fixture(deadline = false) {
  const dir = path.join(root, '.local-office', 'sv-' + randomUUID().slice(0, 8));
  const privateDir = path.join(dir, 'private'),
    reports = path.join(dir, 'reports');
  writeJson(path.join(reports, 'PLAN.json'), {
    limits: { totalMs: 30000, perArmMs: 18000, perRunMs: deadline ? 3000 : 15000 },
    arms: [{}],
  });
  return { privateDir, reports };
}
async function until(read, predicate, timeout = 25000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = read();
    if (predicate(value)) return value;
    await sleep(100);
  }
  throw new Error('Fixture did not reach the expected state.');
}
const ledger = (h) => readJson(path.join(h.privateDir, 'ledger.json'));
const report = (h) => readJson(path.join(h.reports, 'RESULTADO.json'));
const owner = (h) => readJson(path.join(h.privateDir, 'supervision/owner.json'));
const guard = (h) => readJson(path.join(h.privateDir, 'supervision/guard.json'));
const lease = (h) => readJson(path.join(h.privateDir, 'supervision/controller.json'));

test('supervision validates both monitors and identifies stale, lost and unreadable state', () => {
  const spec = { privateDir: 'fixture', nonce: 'test-only', staleMs: 12000 };
  const fresh = {
    nonce: spec.nonce,
    identity: { pid: 1 },
    supervisor: { pid: 2 },
    heartbeatAt: 1000,
  };
  assert.doesNotThrow(
    supervisionValidator(
      spec,
      () => fresh,
      () => true,
      () => 2000,
    ),
  );
  for (const [value, aliveValue, time, detail] of [
    [null, true, 2000, 'missing'],
    [{ ...fresh, nonce: 'wrong' }, true, 2000, 'ownership'],
    [fresh, false, 2000, 'process_absent'],
    [{ ...fresh, heartbeatAt: null }, true, 2000, 'invalid_heartbeat'],
    [fresh, true, 13000, 'heartbeat_expired'],
  ]) {
    assert.throws(
      supervisionValidator(
        spec,
        () => value,
        () => aliveValue,
        () => time,
      ),
      { code: 'supervision_invalid', component: 'guardian', detail },
    );
  }
  let reads = 0;
  assert.throws(
    supervisionValidator(
      spec,
      () => {
        if (++reads === 1) return fresh;
        throw Object.assign(new Error('private path or provider data'), { code: 'EPERM' });
      },
      () => true,
      () => 2000,
    ),
    { code: 'supervision_read_failed', component: 'supervisor', detail: 'EPERM' },
  );
});

test('first incident persists safe evidence without raw errors and never reopens an attempt', () => {
  const h = fixture();
  const error = Object.assign(new Error('secret raw error'), {
    code: 'supervision_read_failed',
    component: 'guardian',
    detail: 'EPERM',
  });
  const first = saveSupervisionIncident(h.privateDir, error, 'validation');
  assert.equal(first.detail, 'EPERM');
  assert.equal(first.noAutomaticRetry, true);
  assert(!JSON.stringify(first).includes('secret'));
  assert.throws(() => saveSupervisionIncident(h.privateDir, error, 'validation'), {
    code: 'EEXIST',
  });
  assert.deepEqual(readJson(path.join(h.privateDir, 'supervision/INCIDENCIA.json')), first);
  assert.equal(ledger(h), null);
});

test('hidden supervisor survives an exited launcher and completes without terminal tracking', async () => {
  const h = fixture();
  const identity = JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.join(root, 'scripts/fixtures/pilot-supervision-launch.mjs'),
        h.privateDir,
        h.reports,
        'complete',
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 12000 },
    ),
  );
  assert(identity.pid > 0);
  const end = await until(
    () => ledger(h),
    (l) => l?.closed,
  );
  assert.equal(end.paused, false);
  assert.equal(report(h).mode, 'offline-fixture');
  assert.equal(report(h).inferenceObserved, false);
  await until(
    () => alive(identity.pid),
    (p) => !p,
  );
});
test('lost controller closes unknown usage and reaps its orphan worker without retrying', async () => {
  const h = fixture();
  launchSupervised({ ...h, fixture: 'controller-loss' });
  const end = await until(
    () => ledger(h),
    (l) => l?.closed,
  );
  assert.equal(end.paused, true);
  assert.equal(end.tokens, null);
  assert.equal(end.attempts, 1);
  assert.equal(report(h).reason, 'execution_controller_lost');
  assert(report(h).recovery.cleanupVerified);
  assert(!alive(lease(h).worker.pid));
  assert.throws(() => launchSupervised({ ...h, fixture: 'complete' }));
});
test('independent watchdog recovers when the supervisor itself dies', async () => {
  const h = fixture();
  const identity = launchSupervised({ ...h, fixture: 'hang' });
  await until(
    () => lease(h),
    (s) => s?.worker,
  );
  await stopOwned(identity);
  const end = await until(
    () => ledger(h),
    (l) => l?.closed,
  );
  assert.equal(end.paused, true);
  assert.equal(report(h).reason, 'supervisor_lost');
  assert(!alive(lease(h).worker.pid));
});
test('supervisor stops the controller if the independent guardian is lost', async () => {
  const h = fixture();
  launchSupervised({ ...h, fixture: 'hang' });
  await until(
    () => lease(h),
    (s) => s?.worker,
  );
  await stopOwned(guard(h).identity);
  const end = await until(
    () => ledger(h),
    (l) => l?.closed,
  );
  assert.equal(end.paused, true);
  assert.equal(report(h).reason, 'guardian_lost');
  assert(!alive(lease(h).worker.pid));
  assert(!alive(owner(h).controller.pid));
});
test('watchdog enforces the model deadline independently of the controller timer', async () => {
  const h = fixture(true);
  launchSupervised({ ...h, fixture: 'hang' });
  const end = await until(
    () => ledger(h),
    (l) => l?.closed,
  );
  assert.equal(end.paused, true);
  assert.equal(report(h).reason, 'model_time_budget');
  assert.equal(end.tokens, null);
  assert(!alive(lease(h).worker.pid));
});
test('a reused PID identity is never terminated', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
    windowsHide: true,
    stdio: 'ignore',
  });
  const identity = identityOf(child.pid);
  try {
    assert.equal(await stopOwned({ ...identity, started: 'different-birth' }), 'identity-mismatch');
    assert(alive(child.pid));
  } finally {
    await stopOwned(identity);
  }
});
test('reconciliation after loss of both monitors closes unknown usage and never restarts', async () => {
  const h = fixture(),
    dir = path.join(h.privateDir, 'supervision');
  const worker = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
    windowsHide: true,
    stdio: 'ignore',
  });
  const workerIdentity = identityOf(worker.pid);
  const dead = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
    windowsHide: true,
    stdio: 'ignore',
  });
  const deadIdentity = identityOf(dead.pid);
  await stopOwned(deadIdentity);
  writeJson(path.join(dir, 'spec.json'), {
    ...h,
    nonce: 'fixture',
    startedAt: Date.now(),
    limits: { totalMs: 30000 },
    bootMs: 15000,
    staleMs: 12000,
  });
  writeJson(path.join(dir, 'owner.json'), {
    nonce: 'fixture',
    supervisor: deadIdentity,
    controller: deadIdentity,
    heartbeatAt: Date.now(),
  });
  writeJson(path.join(dir, 'controller.json'), {
    nonce: 'fixture',
    phase: 'model',
    worker: workerIdentity,
  });
  writeJson(path.join(h.privateDir, 'ledger.json'), {
    startedAt: Date.now(),
    attempts: 1,
    tokens: 0,
    closed: false,
  });
  writeJson(path.join(h.reports, 'RESULTADO.json'), {
    mode: 'offline-fixture',
    runs: [],
    arms: [],
  });
  const r = await reconcileSupervision(h.privateDir);
  assert.equal(r.ledger.closed, true);
  assert.equal(r.ledger.tokens, null);
  assert.equal(r.ledger.attempts, 1);
  assert(!alive(worker.pid));
  const again = await reconcileSupervision(h.privateDir);
  assert.deepEqual(again.ledger, r.ledger);
});
