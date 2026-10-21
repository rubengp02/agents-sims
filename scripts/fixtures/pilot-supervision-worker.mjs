// OS lifecycle fixture: only local Node processes. Never imports a model executor.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { alive, identityOf, readJson, writeJson, stopOwned } from '../pilot-supervision.mjs';

const spec = readJson(process.argv[2]);
assert(['complete', 'controller-loss', 'hang', 'cycle'].includes(spec.fixture));
const dir = path.join(spec.privateDir, 'supervision');
const ledgerFile = path.join(spec.privateDir, 'ledger.json');
const reportFile = path.join(spec.reports, 'RESULTADO.json');
writeJson(
  ledgerFile,
  { startedAt: Date.now(), attempts: 1, tokens: 0, closed: false, paused: false },
  true,
);
writeJson(reportFile, {
  mode: 'offline-fixture',
  runs: [],
  arms: [],
  status: 'running',
  inferenceObserved: false,
});
if (spec.fixture === 'cycle') {
  const receipts = [];
  for (let arm = 0; arm < 4; arm++) {
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    const worker = identityOf(child.pid);
    writeJson(ledgerFile, {
      startedAt: spec.startedAt,
      attempts: arm + 1,
      tokens: arm * 2,
      closed: false,
      paused: false,
    });
    const phase = {
      nonce: spec.nonce,
      phase: 'model',
      heartbeatAt: Date.now(),
      armStartedAt: Date.now(),
      modelStartedAt: Date.now(),
      worker,
      record: null,
    };
    writeJson(path.join(dir, 'controller.json'), phase);
    await new Promise((r) => setTimeout(r, 250));
    phase.record = { status: 'completed', tokens: 2, simulated: true };
    writeJson(path.join(dir, 'controller.json'), phase);
    await stopOwned(worker);
    phase.phase = 'checks';
    phase.worker = null;
    phase.modelStartedAt = null;
    phase.heartbeatAt = Date.now();
    writeJson(path.join(dir, 'controller.json'), phase);
    receipts.push({ status: 'completed', tokens: 2, simulated: true });
    writeJson(reportFile, {
      mode: 'offline-fixture',
      runs: receipts,
      arms: receipts,
      status: 'running',
      inferenceObserved: false,
    });
  }
  writeJson(reportFile, {
    mode: 'offline-fixture',
    runs: receipts,
    arms: receipts,
    status: 'completed-fixture',
    inferenceObserved: false,
  });
  writeJson(ledgerFile, {
    startedAt: spec.startedAt,
    attempts: 4,
    tokens: 8,
    closed: true,
    paused: false,
  });
  process.exit(0);
}
const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
  windowsHide: true,
  stdio: 'ignore',
});
const worker = identityOf(child.pid);
const state = {
  nonce: spec.nonce,
  heartbeatAt: Date.now(),
  phase: 'model',
  armStartedAt: Date.now(),
  modelStartedAt: Date.now(),
  worker,
  record: null,
};
writeJson(path.join(dir, 'controller.json'), state);
const timer = setInterval(() => {
  state.heartbeatAt = Date.now();
  writeJson(path.join(dir, 'controller.json'), state);
}, 200);
if (spec.fixture === 'controller-loss') process.exit(7);
if (spec.fixture === 'complete') {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  state.record = { status: 'completed', tokens: 0, simulated: true };
  writeJson(path.join(dir, 'controller.json'), state);
  await stopOwned(worker);
  assert(!alive(worker.pid));
  clearInterval(timer);
  state.worker = null;
  state.phase = 'finished';
  writeJson(path.join(dir, 'controller.json'), state);
  writeJson(reportFile, {
    mode: 'offline-fixture',
    status: 'completed-fixture',
    inferenceObserved: false,
  });
  writeJson(ledgerFile, {
    startedAt: spec.startedAt,
    attempts: 1,
    tokens: 0,
    closed: true,
    paused: false,
  });
}
