import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

import type { TaskContext, TeamTask } from '../../../core/src/team.js';
import { ExecutionBlocked } from './types.js';

const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
export interface FileRevision {
  digest: string;
  files: Record<string, string>;
}
export function captureRevision(project: string): FileRevision {
  const root = realpathSync(project);
  let names: string[];
  try {
    names = execFileSync(
      'git',
      ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { encoding: 'utf8', windowsHide: true, maxBuffer: 2_000_000 },
    )
      .split('\0')
      .filter(Boolean);
  } catch {
    throw new ExecutionBlocked(
      'review_git_required',
      'La revisión por cambios necesita un repositorio Git verificable.',
    );
  }
  if (names.length > 10000)
    throw new ExecutionBlocked(
      'review_scope_large',
      'El repositorio requiere una revisión de alcance antes de capturar cambios.',
    );
  const files: Record<string, string> = Object.create(null);
  let size = 0;
  for (const name of [...new Set(names)].sort()) {
    const file = join(root, name);
    let stat;
    try {
      stat = lstatSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw new ExecutionBlocked(
        'review_file_unreadable',
        'Un archivo no se pudo inspeccionar; no se omite de la revisión.',
      );
    } // tracked deletion
    if (stat.isSymbolicLink())
      throw new ExecutionBlocked(
        'review_symlink',
        'Revisa los enlaces antes de capturar el alcance.',
      );
    if (!stat.isFile()) continue;
    const resolved = realpathSync(file),
      rel = relative(root, resolved);
    if (!rel || rel.startsWith('..') || isAbsolute(rel))
      throw new ExecutionBlocked('review_path', 'Archivo fuera del alcance de revisión.');
    size += stat.size;
    if (size > 32_000_000)
      throw new ExecutionBlocked(
        'review_scope_large',
        'La captura excede el alcance local permitido.',
      );
    files[name] = readFileSync(file).toString('base64');
  }
  return { digest: hash(JSON.stringify(files)), files };
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
  const changed = [...new Set([...Object.keys(base.files), ...Object.keys(candidate.files)])]
    .sort()
    .filter((name) => base.files[name] !== candidate.files[name]);
  for (const [index, name] of changed.entries()) {
    const before = join(privateDirectory, `before-${index}`),
      after = join(privateDirectory, `after-${index}`);
    const bytes = Buffer.from(candidate.files[name] ?? '', 'base64');
    writeFileSync(before, Buffer.from(base.files[name] ?? '', 'base64'), { mode: 0o600 });
    writeFileSync(after, bytes, { mode: 0o600 });
    const result = spawnSync(
      'git',
      ['diff', '--no-index', '--no-ext-diff', '--no-textconv', '--binary', '--', before, after],
      { encoding: 'utf8', windowsHide: true, maxBuffer: 1000000 },
    );
    if (result.error || ![0, 1].includes(result.status ?? -1))
      throw new ExecutionBlocked(
        'review_diff_failed',
        'No se pudo construir el diff independiente.',
      );
    diff +=
      `\nArchivo ${JSON.stringify(name)}:\n` +
      result.stdout
        .replaceAll(before.replaceAll('\\', '/'), `a/${name}`)
        .replaceAll(after.replaceAll('\\', '/'), `b/${name}`);
    files.push({ path: name, lines: Math.max(1, bytes.toString('utf8').split(/\r?\n/).length) });
  }
  if (diff.length > (mode === 'deep' ? 60000 : 30000))
    throw new ExecutionBlocked(
      'review_packet_too_large',
      'El diff completo requiere dividir la revisión o revisar su alcance; no se ha truncado.',
    );
  return {
    version: 1,
    base: base.digest,
    candidate: candidate.digest,
    mode,
    acceptance: context.acceptance,
    checks,
    files,
    diff,
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
