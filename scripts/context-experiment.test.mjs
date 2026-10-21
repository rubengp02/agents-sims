import assert from 'node:assert/strict';
import test from 'node:test';
import { cases } from './orchestrator-pilot.mjs';
import { loadTools } from './optimization-tools.mjs';
import { comparisonPlan, contextVariants, verifyCanonicalFiles } from './context-experiment.mjs';

const tools = await loadTools();
const item = cases.find((c) => c.id === 'medium');

test('canonical variant keeps the full original fixture and acceptance outside the prompt', () => {
  const p = contextVariants(item, tools);
  assert(p.files['TASK.md'].includes(item.contract));
  assert.deepEqual(p.packet.acceptance, item.contract.split('\n').filter(Boolean));
  assert.deepEqual(p.packet.checks, ['public', 'acceptance']);
  assert(p.variants.canonical.prompt.includes('Lee AGENTS.md y TASK.md completos antes de editar'));
  assert(p.variants.canonical.prompt.includes('No delegues ni uses otros proveedores'));
  assert(p.variants.canonical.prompt.includes('OFFICE_RESULT'));
  assert(p.variants.canonical.characters < p.variants.standard.characters);
});
test('references cannot silently lose contract, instructions or public tests', () => {
  const p = contextVariants(item, tools);
  for (const file of ['TASK.md', 'AGENTS.md', 'contract.test.mjs', 'package.json']) {
    assert.throws(() => verifyCanonicalFiles(item, { ...p.files, [file]: 'changed' }));
    const missing = { ...p.files };
    delete missing[file];
    assert.throws(() => verifyCanonicalFiles(item, missing));
  }
});
test('paired design fixes submitted prompts, engine, model, reasoning and acceptance', () => {
  const p = comparisonPlan(item, tools);
  assert.equal(p.authorizedRealRuns, 0);
  assert.equal(p.executableRealRunner, false);
  assert.deepEqual(p.limits, { realRuns: 0, realTokens: 0, retries: 0 });
  for (const variant of ['standard', 'compact', 'canonical']) {
    const [direct, office] = p.arms.filter((a) => a.variant === variant);
    for (const key of [
      'submittedPromptHash',
      'fixtureHash',
      'acceptanceHash',
      'model',
      'effort',
      'engine',
      'allowWrites',
      'sessionMode',
    ])
      assert.deepEqual(direct[key], office[key]);
    assert.equal(direct.engine, 'codex-cli');
    assert.equal(direct.effort, 'low');
  }
});
