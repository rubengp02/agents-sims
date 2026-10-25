import assert from 'node:assert/strict';
import test from 'node:test';

import { iterativeSummary } from './benchmark/iterativeSummary.mjs';
const plan = { model: 'fixture', effort: 'medium', maxTurnsPerMethod: 6 };
const trial = (method) => ({
  method,
  initialFilesHash: 'same',
  usageKnown: true,
  runs: [
    { status: 'completed', model: 'fixture', effort: 'medium', inputTokens: 90, outputTokens: 10 },
  ],
  tokens: 100,
  totalMs: 1000,
  taskStatus: 'completed',
  status: 'accepted',
});
test('compares complete equal-control attempts including a measured quality failure', () => {
  const trials = [trial('direct'), trial('office')];
  trials[1].status = 'failed';
  const result = iterativeSummary(trials, plan);
  assert.equal(result.status, 'completed');
  assert.equal(result.comparison.officeAccepted, false);
  assert.equal(result.comparison.tokenRatioOfficeToDirect, 1);
  assert.equal(result.generalImprovementProven, false);
});
for (const change of [
  (t) => (t.usageKnown = false),
  (t) => (t.runs[0].inputTokens = null),
  (t) => (t.runs[0].status = 'cancelled'),
  (t) => (t.runs = []),
  (t) => (t.tokens = 0),
  (t) => (t.initialFilesHash = 'other'),
  (t) => (t.runs[0].model = 'other'),
])
  test(
    'withholds comparisons for incomplete or mismatched measurements ' + change.toString(),
    () => {
      const trials = [trial('direct'), trial('office')];
      change(trials[1]);
      const result = iterativeSummary(trials, plan);
      assert.equal(result.status, 'incomplete');
      assert.equal(result.comparison, null);
    },
  );
test('a known receipt does not complete an unfinished office objective', () => {
  const trials = [trial('direct'), trial('office')];
  trials[1].taskStatus = 'paused';
  assert.equal(iterativeSummary(trials, plan).comparison, null);
});
