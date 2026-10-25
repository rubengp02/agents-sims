export type ExecutionEvidenceKind = 'official-cli' | 'simulated' | 'unknown';

/** Server-created facts, separate from the Chief's prose. No absolute paths. */
export interface DeliveryEvidence {
  version: 1;
  objectiveRevision: number;
  createdAt: number;
  execution: ExecutionEvidenceKind;
  changes: {
    state: 'compared' | 'not_captured';
    files: string[];
    base: string | null;
    candidate: string | null;
  };
  checks: Array<{ id: string; exitCode: number | null; durationMs: number; passed: boolean }>;
  review: { state: 'tester' | 'direct'; taskId: string | null; candidate: string | null };
  artifactIds: string[];
  limitations: string[];
}

const natural = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const keys = (value: object, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const fingerprint = (value: unknown) =>
  value === null || (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value));
const relativeFile = (value: unknown) =>
  typeof value === 'string' &&
  value.length > 0 &&
  !/^[\\/]|^[A-Za-z]:|[\u0000-\u001f]/.test(value) &&
  !value.split(/[\\/]/).some((part) => part === '..');

export function validDeliveryEvidence(value: unknown): value is DeliveryEvidence {
  if (!value || typeof value !== 'object') return false;
  const e = value as DeliveryEvidence;
  return (
    e.version === 1 &&
    keys(e, [
      'version',
      'objectiveRevision',
      'createdAt',
      'execution',
      'changes',
      'checks',
      'review',
      'artifactIds',
      'limitations',
    ]) &&
    natural(e.objectiveRevision) &&
    natural(e.createdAt) &&
    ['official-cli', 'simulated', 'unknown'].includes(e.execution) &&
    !!e.changes &&
    keys(e.changes, ['state', 'files', 'base', 'candidate']) &&
    ['compared', 'not_captured'].includes(e.changes.state) &&
    Array.isArray(e.changes.files) &&
    e.changes.files.every(relativeFile) &&
    fingerprint(e.changes.base) &&
    fingerprint(e.changes.candidate) &&
    (e.changes.state !== 'compared' || (e.changes.base !== null && e.changes.candidate !== null)) &&
    (e.changes.state !== 'not_captured' ||
      (!e.changes.files.length && e.changes.base === null && e.changes.candidate === null)) &&
    Array.isArray(e.checks) &&
    e.checks.every(
      (check) =>
        check &&
        keys(check, ['id', 'exitCode', 'durationMs', 'passed']) &&
        typeof check.id === 'string' &&
        /^[\w-]{1,100}$/.test(check.id) &&
        natural(check.durationMs) &&
        (check.exitCode === null || Number.isInteger(check.exitCode)) &&
        typeof check.passed === 'boolean' &&
        (!check.passed || check.exitCode === 0),
    ) &&
    !!e.review &&
    keys(e.review, ['state', 'taskId', 'candidate']) &&
    ['tester', 'direct'].includes(e.review.state) &&
    (e.review.taskId === null ||
      (typeof e.review.taskId === 'string' && /^[\w-]{1,100}$/.test(e.review.taskId))) &&
    (e.review.state !== 'tester' || e.review.taskId !== null) &&
    (e.review.state !== 'direct' || (e.review.taskId === null && e.review.candidate === null)) &&
    fingerprint(e.review.candidate) &&
    Array.isArray(e.artifactIds) &&
    e.artifactIds.every((id) => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id)) &&
    Array.isArray(e.limitations) &&
    e.limitations.every((text) => typeof text === 'string' && text.length <= 1000)
  );
}
