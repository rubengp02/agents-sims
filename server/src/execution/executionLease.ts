import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { ExecutionBlocked } from './types.js';

/** Cross-process slots shared by the office and the standalone executor. Stale locks block. */
export function acquireCodexLease(
  stateDir: string,
  runId: string,
  parallelReadOnly: boolean,
): () => void {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const gatePath = join(stateDir, 'executor-gate.lock');
  const exclusivePath = join(stateDir, 'executor.lock');
  const slots = [0, 1].map((index) => join(stateDir, `executor-read-${index}.lock`));
  const busy = () =>
    new ExecutionBlocked(
      'executor_busy',
      'Ya hay una ejecución incompatible, dos lectores activos o un cierre pendiente de revisar. No se ha iniciado otra.',
    );
  let gate: number;
  try {
    gate = openSync(gatePath, 'wx', 0o600);
  } catch {
    throw busy();
  }
  let lock: number | undefined;
  let target: string | undefined;
  try {
    if (existsSync(exclusivePath)) throw busy();
    if (parallelReadOnly) target = slots.find((file) => !existsSync(file));
    else if (!slots.some((file) => existsSync(file))) target = exclusivePath;
    if (!target) throw busy();
    lock = openSync(target, 'wx', 0o600);
    writeFileSync(
      lock,
      JSON.stringify({
        pid: process.pid,
        runId,
        mode: parallelReadOnly ? 'read-only' : 'exclusive',
      }),
    );
  } catch (error) {
    if (lock !== undefined) {
      closeSync(lock);
      if (target) unlinkSync(target);
    }
    throw error instanceof ExecutionBlocked ? error : busy();
  } finally {
    closeSync(gate);
    unlinkSync(gatePath);
  }
  const ownedPath = target;
  const ownedLock = lock;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    closeSync(ownedLock);
    // Never remove a replacement or foreign lock after an abnormal external change.
    try {
      if (JSON.parse(readFileSync(ownedPath, 'utf8')).runId === runId) unlinkSync(ownedPath);
    } catch {
      /* absence/tampering never authorizes another removal */
    }
  };
}
