import type { ObjectiveUsageSummary } from '../../../core/src/objectiveBudget.js';

interface UsageAttempt {
  id: string;
  objectiveId: string;
  taskId: string;
  startedAt: number;
  updatedAt: number;
  state: 'active' | 'settled' | 'unknown';
  inputTokens: number | null;
  outputTokens: number | null;
}
export interface ObjectiveUsageCheckpoint {
  version: 1;
  attempts: UsageAttempt[];
  historicalUnknown: string[];
}
interface UsageObservation {
  inputTokens: number | null;
  outputTokens: number | null;
  updatedAt: number;
  observedUsage?: { inputTokens: number; outputTokens: number };
}
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const id = (value: unknown): value is string =>
  typeof value === 'string' && /^[\w-]{1,100}$/.test(value);

/** A dispatch is recorded before launch. Missing receipts never become free work. */
export class ObjectiveUsageLedger {
  private attempts = new Map<string, UsageAttempt>();
  private historicalUnknown = new Set<string>();

  begin(attemptId: string, objectiveId: string, taskId: string, startedAt: number): void {
    if (!id(attemptId) || !id(objectiveId) || !id(taskId) || !count(startedAt))
      throw new Error('Identidad de consumo inválida.');
    if (this.attempts.has(attemptId)) throw new Error('El intento de consumo ya existe.');
    this.attempts.set(attemptId, {
      id: attemptId,
      objectiveId,
      taskId,
      startedAt,
      updatedAt: startedAt,
      state: 'active',
      inputTokens: null,
      outputTokens: null,
    });
  }

  observe(attemptId: string, receipt: UsageObservation): void {
    const attempt = this.attempts.get(attemptId);
    if (!attempt || attempt.state !== 'active')
      throw new Error('El intento de consumo no está activo.');
    for (const key of ['inputTokens', 'outputTokens'] as const) {
      const value = count(receipt[key]) ? receipt[key] : receipt.observedUsage?.[key];
      if (count(value)) attempt[key] = Math.max(attempt[key] ?? 0, value);
    }
    if (count(receipt.updatedAt))
      attempt.updatedAt = Math.max(attempt.updatedAt, receipt.updatedAt);
  }

  settle(attemptId: string, receipt?: UsageObservation): void {
    const attempt = this.attempts.get(attemptId);
    if (!attempt) throw new Error('El intento de consumo no existe.');
    if (attempt.state !== 'active') throw new Error('El intento de consumo ya terminó.');
    if (receipt) this.observe(attemptId, receipt);
    const known =
      !!receipt &&
      count(receipt.inputTokens) &&
      count(receipt.outputTokens) &&
      count(receipt.updatedAt) &&
      receipt.updatedAt >= attempt.startedAt &&
      receipt.inputTokens >= (attempt.inputTokens ?? 0) &&
      receipt.outputTokens >= (attempt.outputTokens ?? 0) &&
      Number.isSafeInteger(receipt.inputTokens + receipt.outputTokens);
    attempt.state = known ? 'settled' : 'unknown';
    if (known) {
      attempt.inputTokens = receipt!.inputTokens;
      attempt.outputTokens = receipt!.outputTokens;
      attempt.updatedAt = receipt!.updatedAt;
    }
  }

  markHistoricalUnknown(objectiveId: string): void {
    if (!id(objectiveId)) throw new Error('Identidad de objetivo inválida.');
    this.historicalUnknown.add(objectiveId);
  }

  summary(objectiveId: string): ObjectiveUsageSummary {
    const result: ObjectiveUsageSummary = {
      attempts: 0,
      activeAttempts: 0,
      unknownAttempts: 0,
      knownTokens: 0,
      knownDurationMs: 0,
      historicalUnknown: this.historicalUnknown.has(objectiveId),
      complete: true,
    };
    for (const attempt of this.attempts.values()) {
      if (attempt.objectiveId !== objectiveId) continue;
      result.attempts++;
      if (attempt.state === 'active') result.activeAttempts++;
      else if (attempt.state === 'unknown') result.unknownAttempts++;
      else result.knownDurationMs += attempt.updatedAt - attempt.startedAt;
      result.knownTokens += (attempt.inputTokens ?? 0) + (attempt.outputTokens ?? 0);
      if (!count(result.knownTokens) || !count(result.knownDurationMs))
        throw new Error('El consumo acumulado no se puede representar de forma exacta.');
    }
    result.complete =
      !result.activeAttempts && !result.unknownAttempts && !result.historicalUnknown;
    return result;
  }

  checkpoint(): ObjectiveUsageCheckpoint {
    return structuredClone({
      version: 1,
      attempts: [...this.attempts.values()],
      historicalUnknown: [...this.historicalUnknown],
    });
  }

  restore(value: unknown): string[] {
    const data = value as ObjectiveUsageCheckpoint | null;
    if (
      !data ||
      data.version !== 1 ||
      !Array.isArray(data.attempts) ||
      !Array.isArray(data.historicalUnknown) ||
      !data.historicalUnknown.every(id)
    )
      throw new Error('Registro de consumo inválido.');
    const restored = new Map<string, UsageAttempt>();
    for (const raw of data.attempts) {
      if (
        !raw ||
        !id(raw.id) ||
        !id(raw.objectiveId) ||
        !id(raw.taskId) ||
        !count(raw.startedAt) ||
        !count(raw.updatedAt) ||
        raw.updatedAt < raw.startedAt ||
        !['active', 'settled', 'unknown'].includes(raw.state) ||
        restored.has(raw.id) ||
        (raw.state === 'settled'
          ? !count(raw.inputTokens) ||
            !count(raw.outputTokens) ||
            !Number.isSafeInteger(raw.inputTokens + raw.outputTokens)
          : (raw.inputTokens !== null && !count(raw.inputTokens)) ||
            (raw.outputTokens !== null && !count(raw.outputTokens)))
      )
        throw new Error('Intento de consumo inválido.');
      restored.set(raw.id, {
        id: raw.id,
        objectiveId: raw.objectiveId,
        taskId: raw.taskId,
        startedAt: raw.startedAt,
        updatedAt: raw.updatedAt,
        inputTokens: raw.inputTokens,
        outputTokens: raw.outputTokens,
        state: raw.state === 'active' ? 'unknown' : raw.state,
      });
    }
    // Validate aggregate arithmetic before replacing the existing evidence.
    const candidate = new ObjectiveUsageLedger();
    candidate.attempts = restored;
    candidate.historicalUnknown = new Set(data.historicalUnknown);
    for (const objective of new Set([...restored.values()].map((attempt) => attempt.objectiveId)))
      candidate.summary(objective);
    this.attempts = candidate.attempts;
    this.historicalUnknown = candidate.historicalUnknown;
    return data.attempts
      .filter((attempt) => attempt.state === 'active')
      .map((attempt) => attempt.taskId);
  }
}
