import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cases, acceptanceSource } from './parallel-evaluation-cases.mjs';
import { loadTools, root, sourceFingerprint } from './optimization-tools.mjs';

// No real-provider switch exists. Synthetic providers never call a CLI or network.
assert.equal(
  process.argv.length,
  2,
  'Esta matriz solo admite ejecución local, sin opciones reales.',
);
const tools = await loadTools();
const local = path.join(root, '.local-office', 'matrix-' + randomUUID().slice(0, 8));
fs.mkdirSync(local, { recursive: true });
const variants = [
  'codex-individual-strict',
  'light-local',
  'balanced-local',
  'selective-review',
  'full-team',
  'adaptive-office',
];
const report = {
  version: 1,
  mode: 'offline-structural-fixtures',
  inferenceCalls: 0,
  realTrialAuthorized: false,
  sourceFingerprint: sourceFingerprint(),
  limitations:
    'Fixtures reducidos: verifican contratos, decisiones y circuito; no capacidad de modelos ni rendimiento real. Los ceros de recibos internos no son consumo medido de IA.',
  results: [],
  failures: [],
  passed: false,
};
const hash = (text) => createHash('sha256').update(text).digest('hex');
async function simulate(item, variant) {
  const dir = path.join(local, randomUUID().slice(0, 8)),
    project = path.join(dir, 'repo'),
    managed = path.join(dir, 'spaces');
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(managed);
  const git = (args) =>
    execFileSync('git', ['-C', project, ...args], { windowsHide: true, stdio: 'pipe' });
  git(['init', '--initial-branch=main']);
  git(['config', 'core.autocrlf', 'false']);
  for (const name of Object.keys(item.reference))
    fs.writeFileSync(path.join(project, name), 'module.exports={};\n');
  const acceptance = acceptanceSource(item);
  fs.writeFileSync(path.join(project, 'acceptance.cjs'), acceptance);
  git(['add', '.']);
  git([
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-m',
    'base',
  ]);
  const files = Object.keys(item.reference),
    context = {
      objective: item.goal,
      files: [...files, 'acceptance.cjs'],
      decisions: ['Aceptación inmutable. Sin cambios visuales.'],
      acceptance: ['contract'],
      checks: ['acceptance', ...(item.split ? ['part-a', 'part-b'] : [])],
    };
  const assessment = {
    scope: files.length > 1 ? 'cross-module' : 'bounded',
    risk: item.risk ?? 'low',
    uncertainty: 'low',
    modules: files,
    tests: 'available',
    acceptanceCoverage: 'complete',
  };
  const checks = new tools.LocalChecks(
    {
      acceptance: {
        executable: process.execPath,
        args: ['acceptance.cjs'],
        timeoutMs: 5000,
        acceptance: true,
        criteria: ['contract'],
      },
      ...Object.fromEntries(
        item.split
          ? ['a', 'b'].map((name) => [
              'part-' + name,
              {
                executable: process.execPath,
                args: [
                  '-e',
                  `if(typeof require('./${name}.cjs').value!=='function')process.exit(1)`,
                ],
                timeoutMs: 5000,
              },
            ])
          : [],
      ),
    },
    path.join(dir, 'checks'),
    project,
  );
  const manager = new tools.WorkflowWorkspaceManager(
    managed,
    path.join(dir, 'evidence'),
    async (_project, id, base) => {
      const target = path.join(managed, id);
      git(['worktree', 'add', '--detach', target, base]);
      return target;
    },
  );
  let active = 0,
    peak = 0,
    verificationCount = 0;
  const calls = [],
    sessions = new Set();
  const executor = {
    provider: 'codex',
    engine: 'agent-orchestrator',
    workspaceManager: manager,
    maxConcurrentReadOnly: 2,
    diagnose: async () => {
      verificationCount++;
      return {
        checkedAt: Date.now(),
        plan: 'plus',
        quota: [],
        models: ['gpt-6-luna', 'gpt-6.1-sol'].map((id) => ({
          id,
          efforts: ['low', 'medium', 'high'],
        })),
      };
    },
    execute: async (options) => {
      active++;
      peak = Math.max(peak, active);
      const start = Date.now();
      const key = options.executionSessionKey ?? randomUUID(),
        resumed = sessions.has(key);
      sessions.add(key);
      const target = options.ownedWorkspace?.path ?? options.inheritedWorkspace ?? project;
      const owned = options.ownedWorkspace
        ? options.prompt.match(/Propiedad de escritura exclusiva: (\[[^\n]+?\])/)
        : null;
      const names = owned ? JSON.parse(owned[1]) : files;
      await new Promise((r) => setTimeout(r, 5));
      if (options.allowWrites)
        for (const name of names) fs.writeFileSync(path.join(target, name), item.reference[name]);
      const output =
        options.officeRole === 'chief'
          ? JSON.stringify({
              tasks: ['architect', 'developer', 'tester'].map((role, i) => ({
                role,
                title: role,
                prompt: role === 'developer' ? item.goal : 'Examina el contrato y las pruebas',
                dependsOn: i ? [i - 1] : [],
                context,
                assessment,
                ...(role === 'tester' ? { reviewMode: item.risk ? 'deep' : 'focused' } : {}),
              })),
            })
          : `${options.officeRole === 'tester' ? 'OFFICE_REVIEW {"findings":[]}\n' : ''}OFFICE_RESULT {"status":"completed"}`;
      options.onOutput?.(output);
      const record = {
        version: 1,
        id: randomUUID(),
        provider: 'codex',
        billing: 'subscription-only',
        status: 'completed',
        project,
        executionProject: target,
        requestedModel: options.model,
        requestedEffort: options.effort,
        confirmedModel: null,
        sessionId: key,
        sessionMode: resumed ? 'resume' : 'new',
        startedAt: start,
        updatedAt: Date.now(),
        reasonCode: null,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        subscriptionCheckedAt: Date.now(),
      };
      options.onState?.(record);
      active--;
      calls.push({
        role: options.officeRole,
        model: options.model,
        effort: options.effort,
        writes: !!options.allowWrites,
        sessionMode: record.sessionMode,
        durationMs: Date.now() - start,
      });
      return record;
    },
  };
  const team = new tools.TeamCoordinator(
    { codex: executor, claude: new tools.DisabledExecutor('claude') },
    undefined,
    undefined,
    checks,
    undefined,
    path.join(dir, 'checkpoint.json'),
    new tools.AdaptiveRuntime(new tools.UsageHistory(), path.join(dir, 'artifacts')),
  );
  team.configure({
    mode: 'auto',
    claudeEnabled: false,
    maxRuns: 8,
    maxParallel: 2,
    maxMinutes: 2,
    maxTokens: 30000,
  });
  const start = Date.now();
  if (variant === 'codex-individual-strict') {
    await executor.diagnose();
    await executor.execute({
      project,
      prompt: item.goal,
      model: 'gpt-6.1-sol',
      effort: 'low',
      allowWrites: true,
    });
  } else {
    if (variant === 'full-team') {
      // Prepare a budgeted chief; generated tasks are then independently budgeted.
      const chief = team.addTask({
        project,
        role: 'chief',
        title: 'Planificación simulada',
        prompt: 'Planifica ' + item.goal,
      });
      await team.assign(chief.id);
      team.reviewBudget(chief.id, 1000, 10000, 60000);
      // The plan method performs its own chief dispatch; this fixture uses explicit
      // roles to keep all calls reserved before the first worker starts.
      const arch = team.addTask({
        project,
        role: 'architect',
        title: 'Contrato',
        prompt: 'Examina el contrato',
        context,
        assessment,
      });
      const dev = team.addTask({
        project,
        role: 'developer',
        title: 'Implementación',
        prompt: item.goal,
        context,
        assessment,
        allowWrites: true,
        dependsOn: [chief.id, arch.id],
      });
      team.addTask({
        project,
        role: 'tester',
        title: 'Revisión',
        prompt: 'Revisa el diff y las pruebas',
        context,
        assessment,
        dependsOn: [dev.id],
        reviewMode: item.risk ? 'deep' : 'focused',
      });
    } else if (variant === 'adaptive-office') {
      const decomposition = item.split
        ? {
            sharedFiles: ['acceptance.cjs'],
            parts: files.map((name) => ({
              title: name,
              objective: 'Implementa ' + name,
              ownedFiles: [name],
              assessment: {
                ...assessment,
                scope: 'bounded',
                modules: [name],
                acceptanceCoverage: undefined,
              },
              context: {
                ...context,
                objective: 'Implementa ' + name,
                files: [name, 'acceptance.cjs'],
                checks: ['part-' + name[0]],
              },
            })),
          }
        : undefined;
      // Local chief routing: no inference for clear scopes, risk still adds review.
      team.addScopedWorkflow(project, context, assessment, true, decomposition);
    } else {
      const dev = team.addTask({
        project,
        role: 'developer',
        title: variant,
        prompt: item.goal,
        context,
        assessment,
        allowWrites: true,
      });
      team.override(dev.id, {
        provider: 'codex',
        model: variant === 'light-local' ? 'gpt-6-luna' : 'gpt-6.1-sol',
        effort: 'low',
      });
      if (variant === 'selective-review' && item.risk)
        team.addTask({
          project,
          role: 'tester',
          title: 'Revisión profunda',
          prompt: 'Revisa el diff y las pruebas',
          context,
          assessment,
          dependsOn: [dev.id],
          reviewMode: 'deep',
        });
    }
    async function reserve() {
      for (const t of team.snapshot().tasks.filter((t) => t.status === 'planned')) {
        await team.assign(t.id);
        team.reviewBudget(t.id, 1000, 10000, 60000);
      }
      for (const w of team.snapshot().workflows ?? [])
        if (w.status === 'planned') team.reviewWorkflowBudget(w.id, 15000, 15000, 70000);
    }
    async function run() {
      await reserve();
      await team.start();
      const deadline = Date.now() + 60000;
      while (team.snapshot().running && Date.now() < deadline)
        await new Promise((r) => setTimeout(r, 10));
      assert(!team.snapshot().running, 'deadline local');
    }
    await run();
    if (item.resume) {
      const prior = team.snapshot().tasks.find((t) => t.role === 'developer');
      team.addTask({
        project,
        role: 'developer',
        title: 'Continuación explícita',
        prompt: item.goal,
        context,
        assessment,
        allowWrites: true,
        continueTaskId: prior.id,
      });
      await run();
    }
  }
  const state = team.snapshot(),
    workflow = state.workflows?.[0],
    candidate = workflow?.candidateProject ?? project;
  const acceptanceUnchanged =
    hash(fs.readFileSync(path.join(candidate, 'acceptance.cjs'))) === hash(acceptance);
  const acceptanceResults = await checks.run(
    ['acceptance'],
    candidate,
    new AbortController().signal,
  );
  const quality = acceptanceUnchanged && acceptanceResults.every((c) => c.passed);
  const complete =
    variant === 'codex-individual-strict' ||
    (state.tasks.every((t) => t.status === 'completed') &&
      (!workflow || workflow.status === 'accepted'));
  // A strict individual baseline has its own policy; office roles are irrelevant to its correctness.
  const needsReview = item.risk && variant !== 'codex-individual-strict';
  const policyCompliant =
    !needsReview || state.tasks.some((t) => t.role === 'tester' && t.status === 'completed');
  const result = {
    caseId: item.id,
    family: item.family,
    variant,
    quality,
    policyCompliant,
    circuitCompleted: complete,
    acceptanceProtected: acceptanceUnchanged,
    checksPassed: acceptanceResults.filter((c) => c.passed).length,
    checksTotal: acceptanceResults.length,
    defects: quality ? 0 : 1,
    repairs: 0,
    calls,
    peakConcurrent: peak,
    localWallMs: Date.now() - start,
    sumProviderMs: calls.reduce((n, c) => n + c.durationMs, 0),
    sumWorkMs: state.timeUsedMs,
    tasks: state.tasks.map((t) => ({
      role: t.role,
      status: t.status,
      reason: t.reasonCode,
      checks: t.localChecks ?? [],
      reviewMode: t.reviewMode ?? null,
    })),
    schedule: workflow ? { mode: workflow.mode, reason: workflow.reason } : null,
    preparationMs: workflow?.preparationMs ?? 0,
    integrationMs: workflow?.integrationMs ?? 0,
    modelInputTokens: null,
    modelOutputTokens: null,
    modelCachedInputTokens: null,
    simulatedSubscriptionChecks: verificationCount,
    workflowStatus: workflow?.status ?? null,
    reason: state.budgetReason,
  };
  await team.shutdown();
  assert(quality && complete, JSON.stringify(result));
  return result;
}
try {
  for (const item of cases)
    for (const variant of variants) {
      try {
        report.results.push(await simulate(item, variant));
      } catch (error) {
        report.failures.push({
          caseId: item.id,
          variant,
          code: error.code ?? 'local_fixture_failed',
        });
        throw error;
      }
      console.log(`${report.results.length}/72 ${item.id} ${variant}`);
    }
  assert.equal(report.results.length, 72);
  assert.equal(report.results.filter((r) => r.peakConcurrent === 2).length, 2);
  report.passed = true;
} finally {
  const out = path.join(root, 'reports/oficina-paralela/evaluacion-local');
  fs.mkdirSync(out, { recursive: true });
  // Never replace a previous outcome, including a failed attempt.
  const name = 'MATRIZ-' + randomUUID().slice(0, 8) + '.json';
  fs.writeFileSync(path.join(out, name), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(
    JSON.stringify({
      report: name,
      passed: report.passed,
      scenarios: report.results.length,
      inferenceCalls: 0,
    }),
  );
}
