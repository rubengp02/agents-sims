import { describe, expect, it } from 'vitest';

import { ObjectiveUsageLedger } from '../src/execution/objectiveUsage.js';

describe('per-objective consumption evidence', () => {
  it('counts Chief and worker attempts once, without mixing other objectives or discounting input', () => {
    const ledger = new ObjectiveUsageLedger();
    ledger.begin('chief', 'objective', 'chief-task', 100);
    ledger.begin('worker', 'objective', 'worker-task', 110);
    ledger.begin('other', 'another-objective', 'other-task', 100);
    ledger.settle('chief', { inputTokens: 200, outputTokens: 20, updatedAt: 150 });
    ledger.settle('worker', { inputTokens: 100, outputTokens: 10, updatedAt: 140 });
    expect(ledger.summary('objective')).toMatchObject({
      attempts: 2,
      knownTokens: 330,
      knownDurationMs: 80,
      complete: true,
    });
    expect(() => ledger.settle('chief')).toThrow('ya terminó');
    expect(ledger.summary('objective').knownTokens).toBe(330);
  });

  it('preserves unknown receipts and interrupted attempts through restart and later work', () => {
    const first = new ObjectiveUsageLedger();
    first.begin('missing', 'objective', 'task', 100);
    first.settle('missing');
    first.begin('interrupted', 'objective', 'task', 110);
    const resumed = new ObjectiveUsageLedger();
    expect(resumed.restore(first.checkpoint())).toEqual(['task']);
    expect(resumed.summary('objective')).toMatchObject({
      attempts: 2,
      activeAttempts: 0,
      unknownAttempts: 2,
      complete: false,
    });
    resumed.begin('new', 'objective', 'task', 200);
    resumed.settle('new', { inputTokens: 10, outputTokens: 5, updatedAt: 210 });
    expect(resumed.summary('objective')).toMatchObject({
      attempts: 3,
      knownTokens: 15,
      unknownAttempts: 2,
      complete: false,
    });
  });

  it('retains reported lower bounds after disconnect and never accepts a smaller final counter as complete', () => {
    const ledger = new ObjectiveUsageLedger();
    ledger.begin('interrupted', 'objective', 'task', 100);
    ledger.observe('interrupted', {
      inputTokens: null,
      outputTokens: null,
      updatedAt: 120,
      observedUsage: { inputTokens: 50, outputTokens: 10 },
    });
    const restored = new ObjectiveUsageLedger();
    restored.restore(ledger.checkpoint());
    expect(restored.summary('objective')).toMatchObject({
      knownTokens: 60,
      unknownAttempts: 1,
      complete: false,
    });
    ledger.settle('interrupted', { inputTokens: 30, outputTokens: 5, updatedAt: 130 });
    expect(ledger.summary('objective')).toMatchObject({
      knownTokens: 60,
      unknownAttempts: 1,
      complete: false,
    });
  });

  it('keeps legacy uncertainty without inventing a per-objective turn count', () => {
    const ledger = new ObjectiveUsageLedger();
    ledger.markHistoricalUnknown('objective');
    const restored = new ObjectiveUsageLedger();
    restored.restore(ledger.checkpoint());
    expect(restored.summary('objective')).toMatchObject({
      attempts: 0,
      historicalUnknown: true,
      complete: false,
    });
  });

  it('rejects duplicated or corrupt restored evidence without erasing existing consumption', () => {
    const ledger = new ObjectiveUsageLedger();
    ledger.begin('known', 'objective', 'task', 100);
    ledger.settle('known', { inputTokens: 10, outputTokens: 5, updatedAt: 120 });
    const saved = ledger.checkpoint();
    expect(() =>
      ledger.restore({ ...saved, attempts: [...saved.attempts, ...saved.attempts] }),
    ).toThrow();
    expect(() =>
      ledger.restore({ ...saved, attempts: [{ ...saved.attempts[0], inputTokens: -1 }] }),
    ).toThrow();
    expect(ledger.summary('objective').knownTokens).toBe(15);
  });
});
