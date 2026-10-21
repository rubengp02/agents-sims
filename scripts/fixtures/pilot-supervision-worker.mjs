// OS lifecycle fixture: only local Node processes. Never imports a model executor.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { alive, identityOf, readJson, writeJson, stopOwned } from '../pilot-supervision.mjs';

const spec = readJson(process.argv[2]);
assert(['complete', 'controller-loss', 'hang'].includes(spec.fixture));
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
