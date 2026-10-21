import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import type { TeamRole } from '../../../core/src/team.js';
import { ExecutionBlocked } from './types.js';

export interface UsageKey {
  engine: string;
  provider: string;
  model: string;
  effort: string;
  role: TeamRole;
  workload: string;
}
export interface UsageSample extends UsageKey {
  id: string;
  at: number;
  contextCharacters: number;
  input: number | null;
  output: number | null;
  cached: number | null;
  durationMs: number;
  status: string;
  accepted: boolean | null;
  censored: boolean;
  estimate: number | null;
  sessionMode: 'new' | 'resume';
  policyVersion?: string;
  reasonCode?: string | null;
  checksPassed?: number;
  checksTotal?: number;
  defects?: number | null;
  repair?: boolean | null;
  selectionSource?: 'manual' | 'chief' | 'local';
  subscriptionVerified?: boolean;
}

const count = (n: unknown) => Number.isSafeInteger(n) && Number(n) >= 0;
export function validateSample(value: UsageSample): UsageSample {
  const strings = [
    'id',
    'engine',
    'provider',
    'model',
    'effort',
    'role',
    'workload',
    'status',
  ] as const;
  if (
    !value ||
    strings.some(
      (key) => typeof value[key] !== 'string' || !value[key] || value[key].length > 160,
    ) ||
    !['chief', 'architect', 'developer', 'tester', 'designer'].includes(value.role) ||
    ![value.at, value.contextCharacters, value.durationMs].every(count) ||
    ![value.input, value.output, value.cached, value.estimate].every(
      (n) => n === null || count(n),
    ) ||
    (value.cached !== null && (value.input === null || value.cached > value.input)) ||
    ![true, false, null].includes(value.accepted) ||
    typeof value.censored !== 'boolean' ||
    !['new', 'resume'].includes(value.sessionMode)
  )
    throw new ExecutionBlocked(
      'usage_history_invalid',
      'El historial de consumo necesita revisión.',
    );
  if (
    [value.checksPassed, value.checksTotal, value.defects].some(
      (v) => v !== undefined && v !== null && !count(v),
    ) ||
    (value.checksPassed !== undefined &&
      (value.checksTotal === undefined || value.checksPassed > value.checksTotal)) ||
    (value.repair !== undefined && value.repair !== null && typeof value.repair !== 'boolean') ||
    (value.subscriptionVerified !== undefined && typeof value.subscriptionVerified !== 'boolean') ||
    (value.selectionSource !== undefined &&
      !['manual', 'chief', 'local'].includes(value.selectionSource)) ||
    [value.policyVersion, value.reasonCode].some(
      (v) =>
        v !== undefined && v !== null && (typeof v !== 'string' || !/^[a-z0-9_-]{1,100}$/i.test(v)),
    )
  )
    throw new ExecutionBlocked(
      'usage_history_invalid',
      'Los indicadores de calidad necesitan revisión.',
    );
  // Explicit projection: no prompts, paths, commands, credentials or model prose.
  return Object.fromEntries(
    [
      ...strings,
      'at',
      'contextCharacters',
      'input',
      'output',
      'cached',
      'durationMs',
      'accepted',
      'censored',
      'estimate',
      'sessionMode',
      ...(
        [
          'policyVersion',
          'reasonCode',
          'checksPassed',
          'checksTotal',
          'defects',
          'repair',
          'selectionSource',
          'subscriptionVerified',
        ] as const
      ).filter((key) => value[key] !== undefined),
    ].map((key) => [key, value[key as keyof UsageSample]]),
  ) as unknown as UsageSample;
}

/** One coordinator owns this file; checkpoint policy prevents automatic restart. */
export class UsageHistory {
  private samples: UsageSample[] = [];
  private invalid = false;
  constructor(private readonly file?: string) {
    if (file && existsSync(file)) {
      try {
        const raw = JSON.parse(readFileSync(file, 'utf8'));
        if (raw.version !== 1 || !Array.isArray(raw.samples)) throw new Error();
        for (const sample of raw.samples) this.add(sample, false);
      } catch {
        this.samples = [];
        this.invalid = true;
      }
    }
  }
  list(): UsageSample[] {
    if (this.invalid)
      throw new ExecutionBlocked(
        'usage_history_invalid',
        'Conserva el historial: requiere revisión antes de ejecutar.',
      );
    return structuredClone(this.samples);
  }
  isOutside(project: string): boolean {
    if (!this.file) return true;
    const rel = relative(project, resolve(this.file));
    return rel.startsWith('..') || isAbsolute(rel);
  }
  add(raw: UsageSample, persist = true): void {
    if (this.invalid)
      throw new ExecutionBlocked(
        'usage_history_invalid',
        'El historial corrupto no se sobrescribe.',
      );
    const value = validateSample(raw);
    const prior = this.samples.find((s) => s.id === value.id);
    if (prior) {
      if (JSON.stringify(prior) !== JSON.stringify(value))
        throw new ExecutionBlocked(
          'usage_history_conflict',
          'Un recibo existente no se puede sustituir.',
        );
      return;
    }
    this.samples.push(value);
    if (persist && this.file) {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      writeFileSync(this.file + '.tmp', JSON.stringify({ version: 1, samples: this.samples }), {
        mode: 0o600,
      });
      renameSync(this.file + '.tmp', this.file);
    }
  }
}
