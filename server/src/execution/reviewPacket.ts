import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  copyFileSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import type { TaskContext, TeamTask } from '../../../core/src/team.js';
import { captureFiles, type FileRevision, gitFileNames, revisionFile } from './revisionStore.js';
export type { FileRevision } from './revisionStore.js';
import { ExecutionBlocked } from './types.js';

const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
export function captureRevision(project: string): FileRevision {
  const root = realpathSync(project);
  let names: string[];
  try {
    names = gitFileNames(root).filter(
      (name) =>
        name &&
        !name
          .split('/')
          .some(
            (part, i, parts) =>
              ['dist', 'out', '.vscode-test'].includes(part) ||
              (part === 'generated_images' && parts[i - 1] === '.codex'),
          ),
    );
  } catch {
    throw new ExecutionBlocked(
      'review_git_required',
      'La revisión por cambios necesita un repositorio Git verificable.',
    );
  }
  return captureFiles(root, names);
}

export interface ReviewPacket {
  version: 1;
  base: string;
  candidate: string;
  mode: 'focused' | 'deep';
  acceptance: string[];
  checks: NonNullable<TeamTask['localChecks']>;
  files: Array<{ path: string; lines: number }>;
  diff: string;
  diffArtifact?: { path: string; bytes: number };
}

function saveRevisionFile(revision: FileRevision, name: string, destination: string): number {
  if (revision.format === 'sha256-v1') {
    const source = revisionFile(revision, name);
    if (source) copyFileSync(source, destination);
    else writeFileSync(destination, '', { mode: 0o600 });
  } else
    writeFileSync(destination, Buffer.from(revision.files[name] ?? '', 'base64'), { mode: 0o600 });
  const fd = openSync(destination, 'r'),
    buffer = Buffer.allocUnsafe(64 * 1024);
  let lines = 1,
    count: number;
  try {
    while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0)
      for (let i = 0; i < count; i++) if (buffer[i] === 10) lines++;
  } finally {
    closeSync(fd);
  }
  return lines;
}

export function buildReviewPacket(
  base: FileRevision,
  candidate: FileRevision,
  context: TaskContext | undefined,
  checks: NonNullable<TeamTask['localChecks']>,
  mode: 'focused' | 'deep',
  privateDirectory: string,
): ReviewPacket {
  if (
    !base?.files ||
    !candidate?.files ||
    hash(JSON.stringify(base.files)) !== base.digest ||
    hash(JSON.stringify(candidate.files)) !== candidate.digest
  )
    throw new ExecutionBlocked(
      'review_revision_invalid',
      'La captura de revisión no coincide con su huella.',
    );
  if (!context?.acceptance.length)
    throw new ExecutionBlocked(
      'review_acceptance_missing',
      'La revisión necesita criterios de aceptación explícitos.',
    );
  mkdirSync(privateDirectory, { recursive: true, mode: 0o700 });
  const files: ReviewPacket['files'] = [];
  let diff = '';
  const fullDiff = join(privateDirectory, 'complete.diff');
  writeFileSync(fullDiff, '', { mode: 0o600 });
  const inlineSize = mode === 'deep' ? 60000 : 30000;
  let externalDiff = false;
  const changed = [...new Set([...Object.keys(base.files), ...Object.keys(candidate.files)])]
    .sort()
    .filter((name) => {
      const fingerprint = (revision: FileRevision) =>
        revision.files[name] === undefined
          ? undefined
          : revision.format === 'sha256-v1'
            ? revision.files[name]
            : hash(Buffer.from(revision.files[name], 'base64'));
      return fingerprint(base) !== fingerprint(candidate);
    });
  for (const [index, name] of changed.entries()) {
    const before = join(privateDirectory, `before-${index}`),
      after = join(privateDirectory, `after-${index}`);
    saveRevisionFile(base, name, before);
    const lines = saveRevisionFile(candidate, name, after);
    const perFileDiff = join(privateDirectory, `diff-${index}`),
      diffFd = openSync(perFileDiff, 'w', 0o600);
    let result;
    try {
      result = spawnSync(
        'git',
        ['diff', '--no-index', '--no-ext-diff', '--no-textconv', '--binary', '--', before, after],
        { encoding: 'utf8', windowsHide: true, stdio: ['ignore', diffFd, 'pipe'] },
      );
    } finally {
      closeSync(diffFd);
    }
    if (result.error || ![0, 1].includes(result.status ?? -1))
      throw new ExecutionBlocked(
        'review_diff_failed',
        'No se pudo construir el diff independiente.',
      );
    const header = `\nArchivo ${JSON.stringify(name)}:\n`;
    appendFileSync(fullDiff, header);
    const fd = openSync(perFileDiff, 'r'),
      buffer = Buffer.allocUnsafe(64 * 1024);
    try {
      let count: number;
      while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0)
        appendFileSync(fullDiff, buffer.subarray(0, count));
    } finally {
      closeSync(fd);
    }
    if (!externalDiff && diff.length + header.length + statSync(perFileDiff).size <= inlineSize)
      diff +=
        header +
        readFileSync(perFileDiff, 'utf8')
          .replaceAll(before.replaceAll('\\', '/'), `a/${name}`)
          .replaceAll(after.replaceAll('\\', '/'), `b/${name}`);
    else externalDiff = true;
    files.push({ path: name, lines });
  }
  if (externalDiff)
    diff =
      'El diff completo se conserva en diffArtifact.path. Lee ese archivo por bloques y contrasta todos los cambios antes de declarar la revisión completada. No asumas una revisión completa a partir de este índice.';
  return {
    version: 1,
    base: base.digest,
    candidate: candidate.digest,
    mode,
    acceptance: context.acceptance,
    checks,
    files,
    diff,
    ...(externalDiff ? { diffArtifact: { path: fullDiff, bytes: statSync(fullDiff).size } } : {}),
  };
}

export interface ReviewFinding {
  file: string;
  line: number;
  severity: 'low' | 'medium' | 'high';
  criterion: string;
  evidence: string;
}
/** Findings must be grounded; checking references is not proof of their semantic truth. */
export function parseReviewFindings(output: string, packet: ReviewPacket): ReviewFinding[] {
  const line = output.split(/\r?\n/).find((s) => s.startsWith('OFFICE_REVIEW '));
  try {
    if (!line) throw new Error();
    const result = JSON.parse(line.slice('OFFICE_REVIEW '.length));
    if (!Array.isArray(result.findings) || result.findings.length > 30) throw new Error();
    return result.findings.map((finding: ReviewFinding) => {
      const file = packet.files.find((f) => f.path === finding.file);
      if (
        !file ||
        !Number.isInteger(finding.line) ||
        finding.line < 1 ||
        finding.line > file.lines ||
        !['low', 'medium', 'high'].includes(finding.severity) ||
        !packet.acceptance.includes(finding.criterion) ||
        typeof finding.evidence !== 'string' ||
        finding.evidence.trim().length < 10 ||
        finding.evidence.length > 2000
      )
        throw new Error();
      return finding;
    });
  } catch {
    throw new ExecutionBlocked(
      'review_evidence_invalid',
      'La revisión debe incluir hallazgos con archivo, línea, criterio y evidencia, o una lista vacía explícita.',
    );
  }
}
