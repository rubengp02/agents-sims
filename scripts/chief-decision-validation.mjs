import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadTools, root, sourceFingerprint } from './optimization-tools.mjs';

const tools = await loadTools();
const cases = JSON.parse(fs.readFileSync(path.join(root, 'scripts/chief-decision-cases.json')));
const base = path.join(root, '.local-office/chief-' + randomUUID().slice(0, 8));
fs.mkdirSync(base, { recursive: true });
const report = {
  mode: 'local-decision-tests',
  inferenceCalls: 0,
  modelCallsSimulated: 0,
  sourceFingerprint: sourceFingerprint(),
  results: [],
  passed: false,
};
for (const item of cases) {
  const project = path.join(base, item.id);
  fs.mkdirSync(project);
  const context = {
    objective: item.objective,
    files: ['code.mjs'],
    decisions: ['Conserva el contrato'],
    acceptance: ['resultado correcto', 'sin mutación'],
    checks: ['checks'],
  };
  const assessment = {
    scope: item.scope,
    risk: item.risk ?? 'low',
    uncertainty: item.uncertainty ?? 'low',
    tests: item.tests ?? 'available',
    modules: item.modules ?? (item.scope === 'cross-module' ? ['money', 'invoice'] : ['money']),
    ...(item.claimComplete ? { acceptanceCoverage: 'complete' } : {}),
  };
  const registry = new tools.LocalChecks(
    {
      checks: {
        executable: process.execPath,
        args: ['-e', 'process.exit(0)'],
        timeoutMs: 1000,
        acceptance: assessment.tests === 'available',
        criteria:
          item.coverage === 'complete'
            ? context.acceptance
            : item.coverage === 'partial'
              ? context.acceptance.slice(0, 1)
              : [],
      },
    },
    path.join(base, 'logs'),
  );
  const executor = {
    provider: 'codex',
    engine: 'codex-cli',
    diagnose: async () => ({
      checkedAt: 1,
      plan: 'plus',
      quota: [],
      models: [
        { id: 'gpt-6.1-sol', efforts: ['low', 'medium', 'high'] },
        { id: 'gpt-6-luna', efforts: ['low'] },
      ],
    }),
    execute: async () => {
      report.modelCallsSimulated++;
      throw new Error('An unexpected simulated worker was dispatched.');
    },
  };
  const team = new tools.TeamCoordinator(
    { codex: executor, claude: new tools.DisabledExecutor('claude') },
    undefined,
    undefined,
    registry,
    undefined,
    undefined,
    new tools.AdaptiveRuntime(new tools.UsageHistory(), path.join(base, 'artifacts')),
  );
  let blocked = null;
  try {
    if (item.method === 'scope')
      team.addScopedWorkflow(project, context, assessment, item.write !== false);
    else await team.plan(project, context.objective, item.write !== false, { context, assessment });
  } catch (error) {
    blocked = error.code ?? 'unexpected_error';
  }
  const tasks = team.snapshot().tasks;
  for (const task of tasks.filter((t) => t.status === 'planned')) await team.assign(task.id);
  const final = team.snapshot().tasks;
  const row = {
    id: item.id,
    roles: final.map((t) => t.role),
    blocked,
    choices: final.map((t) => ({
      role: t.role,
      model: t.choice?.model ?? null,
      effort: t.choice?.effort ?? null,
      review: t.reviewMode ?? null,
    })),
    passed: false,
  };
  try {
    assert.deepEqual(row.roles, item.expectedRoles);
    assert.equal(blocked, item.expectedBlock ?? null);
    if (item.expectedEffort)
      assert.equal(final.find((t) => t.role === 'developer')?.choice?.effort, item.expectedEffort);
    if (item.expectedReview)
      assert.equal(final.find((t) => t.role === 'tester')?.reviewMode, item.expectedReview);
    assert.equal(report.modelCallsSimulated, 0);
    row.passed = true;
  } catch {
    row.expected = {
      roles: item.expectedRoles,
      block: item.expectedBlock ?? null,
      effort: item.expectedEffort ?? null,
      review: item.expectedReview ?? null,
    };
  }
  report.results.push(row);
  await team.shutdown();
}
report.passed = report.results.every((r) => r.passed) && report.modelCallsSimulated === 0;
const destination = path.join(root, 'reports/optimizacion-adaptativa/validacion-jefe');
fs.mkdirSync(destination, { recursive: true });
const attemptsFile = path.join(destination, 'INTENTOS.json');
const attempts = fs.existsSync(attemptsFile) ? JSON.parse(fs.readFileSync(attemptsFile)) : [];
attempts.push({
  at: new Date().toISOString(),
  sourceFingerprint: report.sourceFingerprint,
  passed: report.passed,
  inferenceCalls: 0,
  failedCases: report.results
    .filter((r) => !r.passed)
    .map((r) => ({ id: r.id, actual: r.choices, expected: r.expected })),
});
fs.writeFileSync(attemptsFile, JSON.stringify(attempts, null, 2) + '\n');
fs.writeFileSync(path.join(destination, 'DECISIONES.json'), JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify({
    passed: report.passed,
    cases: report.results.length,
    inferenceCalls: 0,
    failedCases: report.results.filter((r) => !r.passed).map((r) => r.id),
  }),
);
if (!report.passed) process.exitCode = 1;
