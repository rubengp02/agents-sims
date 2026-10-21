import { randomUUID } from 'node:crypto';
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
import { type OwnedWorkspace, verifiedWorkspace } from './workflowWorkspace.js';

const leaseOwner = randomUUID();
const activeWriters = new Map<string, string>();

/** Cross-process slots shared by the office and the standalone executor. Stale locks block. */
export function acquireCodexLease(
  stateDir: string,
  runId: string,
  parallelReadOnly: boolean,
  workspace?: OwnedWorkspace,
): () => void {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const gatePath = join(stateDir, 'executor-gate.lock');
  const exclusivePath = join(stateDir, 'executor.lock');
  const slots = [0, 1].map((index) => join(stateDir, `executor-read-${index}.lock`));
  const writers = [0, 1].map((index) => join(stateDir, `executor-write-${index}.lock`));
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
    if (workspace) {
      verifiedWorkspace(workspace);
      if (parallelReadOnly || slots.some((file) => existsSync(file))) throw busy();
      for (const file of writers.filter((file) => existsSync(file))) {
        const other = JSON.parse(readFileSync(file, 'utf8'));
        if (
          other.mode !== 'isolated-write' ||
          other.workflowId !== workspace.workflowId ||
          other.project !== workspace.project ||
          other.workspaceId === workspace.id ||
          other.pid !== process.pid ||
          other.owner !== leaseOwner ||
          activeWriters.get(file) !== other.runId
        )
          throw busy();
      }
      target = writers.find((file) => !existsSync(file));
    } else if (writers.some((file) => existsSync(file))) throw busy();
    else if (parallelReadOnly) target = slots.find((file) => !existsSync(file));
    else if (!slots.some((file) => existsSync(file))) target = exclusivePath;
    if (!target) throw busy();
    lock = openSync(target, 'wx', 0o600);
    writeFileSync(
      lock,
      JSON.stringify({
        pid: process.pid,
        owner: leaseOwner,
        runId,
        mode: workspace ? 'isolated-write' : parallelReadOnly ? 'read-only' : 'exclusive',
        ...(workspace
          ? {
              workflowId: workspace.workflowId,
              workspaceId: workspace.id,
              project: workspace.project,
            }
          : {}),
      }),
    );
    if (workspace) activeWriters.set(target, runId);
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
    activeWriters.delete(ownedPath);
    // Never remove a replacement or foreign lock after an abnormal external change.
    try {
      const record = JSON.parse(readFileSync(ownedPath, 'utf8'));
      if (record.runId === runId && record.owner === leaseOwner) unlinkSync(ownedPath);
    } catch {
      /* absence/tampering never authorizes another removal */
    }
  };
}
