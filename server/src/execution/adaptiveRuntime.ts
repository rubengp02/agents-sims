import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

import type { TeamTask } from '../../../core/src/team.js';
import { type BudgetEstimate, estimateTurn } from './budgetEstimator.js';
import {
  buildReviewPacket,
  captureRevision,
  type FileRevision,
  type ReviewPacket,
} from './reviewPacket.js';
import type { RunRecord } from './types.js';
import { ExecutionBlocked } from './types.js';
import { UsageHistory, type UsageKey } from './usageHistory.js';

export function workloadClass(
  task: Pick<TeamTask, 'role' | 'assessment' | 'reviewMode' | 'executionSessionKey'>,
): string {
  const a = task.assessment;
  return [
    a?.scope ?? 'unknown',
    a?.risk ?? 'unknown',
    a?.uncertainty ?? 'unknown',
    a?.tests ?? 'unknown',
    task.role === 'tester' ? (task.reviewMode ?? 'focused') : 'none',
    task.executionSessionKey ? 'resume' : 'new',
  ].join('|');
}

export class AdaptiveRuntime {
  constructor(
    readonly history: UsageHistory,
    private readonly artifactsDirectory?: string,
    private readonly approvedLightProfiles: ReadonlySet<string> = new Set(),
  ) {}
  private artifact(taskId: string): string {
    if (!this.artifactsDirectory || !/^[\w-]{1,100}$/.test(taskId))
      throw new ExecutionBlocked(
        'artifact_store_required',
        'Falta un almacén local para los artefactos de revisión.',
      );
    return join(this.artifactsDirectory, taskId);
  }
  capture(task: TeamTask): void {
    const dir = this.artifact(task.id);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, 'base.json');
    if (!existsSync(file))
      writeFileSync(file, JSON.stringify(captureRevision(task.executionProject ?? task.project)), {
        mode: 0o600,
        flag: 'wx',
      });
  }
  review(task: TeamTask, developer: TeamTask): ReviewPacket {
    const dir = this.artifact(developer.id);
    let base: FileRevision;
    try {
      base = JSON.parse(readFileSync(join(dir, 'base.json'), 'utf8'));
    } catch {
      throw new ExecutionBlocked(
        'review_base_missing',
        'No existe una base de cambios verificable del Programador.',
      );
    }
    const candidate = captureRevision(developer.executionProject ?? developer.project);
    if (!developer.checkedRevision || developer.checkedRevision !== candidate.digest)
      throw new ExecutionBlocked(
        'review_checks_stale',
        'Las comprobaciones no corresponden a la revisión actual.',
      );
    return buildReviewPacket(
      base,
      candidate,
      task.context ?? developer.context,
      developer.localChecks ?? [],
      task.reviewMode === 'deep' ? 'deep' : 'focused',
      join(dir, 'diff'),
    );
  }
  key(task: TeamTask, engine: string): UsageKey {
    return {
      engine,
      provider: task.choice!.provider,
      model: task.choice!.model,
      effort: task.choice!.effort,
      role: task.role,
      workload: workloadClass(
        engine === 'agent-orchestrator' ? task : { ...task, executionSessionKey: undefined },
      ),
    };
  }
  estimate(task: TeamTask, engine: string, characters: number): BudgetEstimate {
    const rel = this.artifactsDirectory
      ? relative(task.project, resolve(this.artifactsDirectory))
      : null;
    if (
      !this.history.isOutside(task.project) ||
      (rel !== null && !rel.startsWith('..') && !isAbsolute(rel))
    )
      throw new ExecutionBlocked(
        'adaptive_evidence_writable',
        'La evidencia de control debe quedar fuera de la carpeta editable del agente.',
      );
    const key = this.key(task, engine);
    const review = task.budgetReview;
    if (
      review &&
      review.choiceKey === JSON.stringify(key) &&
      review.maxContextCharacters >= characters
    )
      return {
        tokens: review.tokens,
        durationMs: review.durationMs,
        samples: 0,
        confidence: 'human',
        reason: 'Cota revisada explícitamente por la persona para esta asignación.',
      };
    return estimateTurn(this.history.list(), key, characters);
  }
  allowsLightCode(task: TeamTask, engine: string): boolean {
    const key = this.key(task, engine);
    // Observations alone do not establish comparative quality/consumption. Promotion
    // is a separate reviewed local decision; the default production set is empty.
    return (
      this.approvedLightProfiles.has(JSON.stringify(key)) &&
      this.history
        .list()
        .filter(
          (s) =>
            Object.entries(key).every(([k, v]) => s[k as keyof UsageKey] === v) &&
            s.accepted === true &&
            !s.censored,
        ).length >= 5
    );
  }
  record(
    task: TeamTask,
    engine: string,
    result: RunRecord,
    characters: number,
    estimate: number | null,
  ): void {
    this.history.add({
      ...this.key(task, engine),
      id: result.id,
      at: result.updatedAt,
      contextCharacters: characters,
      input: result.inputTokens,
      output: result.outputTokens,
      cached: result.cachedInputTokens ?? null,
      durationMs: Math.max(0, result.updatedAt - result.startedAt),
      status: result.status,
      accepted:
        task.role === 'chief'
          ? null
          : task.status === 'completed' &&
            !!task.localChecks?.length &&
            task.localChecks.every((c) => c.passed),
      censored: result.status !== 'completed',
      estimate,
      sessionMode: result.sessionMode ?? 'new',
      policyVersion: 'adaptive-v1',
      reasonCode: task.reasonCode ?? result.reasonCode,
      checksPassed: task.localChecks?.filter((c) => c.passed).length ?? 0,
      checksTotal: task.localChecks?.length ?? 0,
      defects: task.reviewFindings ? task.reviewFindings.length : null,
      repair: null, // A continued session alone does not prove a repair.
      selectionSource: task.override ? 'manual' : task.proposedChoice ? 'chief' : 'local',
      subscriptionVerified: !!result.subscriptionCheckedAt,
    });
  }
}
