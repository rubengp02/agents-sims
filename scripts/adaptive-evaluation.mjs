import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cases } from './orchestrator-pilot.mjs';
import { materialize, acceptance } from './benchmark/kit.mjs';
import { loadTools, root } from './optimization-tools.mjs';

// Offline only. This script has no command or option for enabling a real provider.
const tools = await loadTools();
const local = path.join(root, '.local-office', 'ae-' + randomUUID().slice(0, 8));
fs.mkdirSync(local, { recursive: true });
const report = {
  version: 1,
  mode: 'offline-protocol-simulation',
  inferenceCalls: 0,
  tokenCounters: 'injected fixtures, not model efficiency measurements',
  nativeIsolation: 'separately covered by engine:test, not claimed by this in-memory adapter',
  results: [],
  realTrialAuthorized: false,
  passed: false,
};
const variants = [
  'codex-individual',
  'light-local',
  'balanced-local',
  'selective-review',
  'full-team-control',
  'adaptive-office',
];
async function simulate(item, variant, injectDefect = false) {
  const project = path.join(local, randomUUID().slice(0, 8));
  materialize(project, item);
  const git = (args) =>
    execFileSync('git', args, { cwd: project, windowsHide: true, stdio: 'pipe' });
  git(['init', '--initial-branch=main']);
  git(['config', '--local', 'core.autocrlf', 'false']);
  git(['add', '.']);
  git([
    '-c',
    'user.name=Local Evaluation',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-m',
    'fixture',
  ]);
  const criteria = item.contract.split('\n').filter(Boolean);
  const packet = {
    objective: item.objective,
    files: [...item.files, 'TASK.md'],
    decisions: ['Contrato inmutable en TASK.md'],
    acceptance: criteria,
    checks: ['acceptance'],
  };
  const history = new tools.UsageHistory();
  for (const role of ['chief', 'architect', 'developer', 'tester'])
    for (const model of ['gpt-6-luna', 'gpt-6.1-sol'])
      for (const effort of ['low', 'medium', 'high'])
        for (const workload of new Set([
          tools.workloadClass({
            role,
            assessment: role === 'chief' ? undefined : item.assessment,
            reviewMode:
              role === 'tester'
                ? item.assessment.risk === 'high'
                  ? 'deep'
                  : 'focused'
                : undefined,
          }),
          tools.workloadClass({
            role,
            assessment: role === 'chief' ? undefined : { ...item.assessment, risk: 'high' },
            reviewMode: role === 'tester' ? 'deep' : undefined,
          }),
        ]))
          for (let n = 0; n < 5; n++)
            history.add({
              id: `${role}-${model}-${effort}-${workload}-${n}`,
              at: n,
              engine: 'agent-orchestrator',
              provider: 'codex',
              model,
              effort,
              role,
              workload,
              contextCharacters: 90000,
              input: 1000,
              output: 100,
              cached: 500,
              durationMs: 10,
              status: 'completed',
              accepted: true,
              censored: false,
              estimate: null,
              sessionMode: 'new',
            });
  const calls = [];
  const evidence = {
    checkedAt: Date.now(),
    plan: 'plus',
    quota: [],
    models: ['gpt-6-luna', 'gpt-6.1-sol'].map((id) => ({ id, efforts: ['low', 'medium', 'high'] })),
  };
  const executor = {
    provider: 'codex',
    engine: 'agent-orchestrator',
    maxConcurrentReadOnly: 2,
    diagnose: async () => evidence,
    execute: async (options) => {
      calls.push({
        role: options.officeRole,
        model: options.model,
        effort: options.effort,
        allowWrites: !!options.allowWrites,
      });
      if (options.allowWrites && !injectDefect)
        for (const [file, text] of Object.entries(item.reference))
          fs.writeFileSync(path.join(project, file), text);
      if (options.officeRole === 'chief') {
        const roles = ['architect', 'developer', 'tester'];
        options.onOutput?.(
          JSON.stringify({
            tasks: roles.map((role, i) => ({
              role,
              title: role,
              prompt: role === 'developer' ? item.objective : `Analiza el contrato como ${role}`,
              dependsOn: i ? [i - 1] : [],
              choice: { provider: 'codex', model: 'gpt-6.1-sol', effort: 'medium' },
              assessment: item.assessment,
              context: packet,
              ...(role === 'tester'
                ? { reviewMode: item.assessment.risk === 'high' ? 'deep' : 'focused' }
                : {}),
            })),
          }),
        );
      } else
        options.onOutput?.(
          `${options.officeRole === 'tester' ? 'OFFICE_REVIEW {"findings":[]}\n' : ''}OFFICE_RESULT {"status":"completed"}`,
        );
      const record = {
        version: 1,
        id: randomUUID(),
        provider: 'codex',
        billing: 'subscription-only',
        status: 'completed',
        project,
        requestedModel: options.model,
        requestedEffort: options.effort,
        confirmedModel: null,
        sessionId: randomUUID(),
        startedAt: 1,
        updatedAt: 11,
        reasonCode: null,
        inputTokens: 1000,
        outputTokens: 100,
        cachedInputTokens: 500,
        sessionMode: 'new',
      };
      options.onState?.(record);
      return record;
    },
  };
  const checks = new tools.LocalChecks(
    {
      acceptance: {
        executable: process.execPath,
        args: [path.join(root, 'scripts/adaptive-acceptance.mjs'), item.id, project],
        timeoutMs: 10000,
        acceptance: true,
        criteria,
      },
    },
    path.join(local, 'checks'),
  );
  const team = new tools.TeamCoordinator(
    { codex: executor, claude: new tools.DisabledExecutor('claude') },
    undefined,
    undefined,
    checks,
    undefined,
    undefined,
    new tools.AdaptiveRuntime(history, path.join(local, 'artifacts')),
  );
  team.configure({
    mode: 'auto',
    claudeEnabled: false,
    maxRuns: 8,
    maxParallel: 2,
    maxMinutes: 2,
    maxTokens: 200000,
  });
  const start = Date.now();
  if (variant === 'full-team-control') await team.plan(project, item.objective, true);
  else if (variant === 'adaptive-office')
    await team.plan(project, item.objective, true, {
      context: packet,
      assessment: item.assessment,
    });
  else {
    const developer = team.addTask({
      project,
      role: 'developer',
      title: variant,
      prompt: item.objective,
      context: packet,
      assessment: item.assessment,
      allowWrites: true,
    });
    team.override(developer.id, {
      provider: 'codex',
      model: variant === 'light-local' ? 'gpt-6-luna' : 'gpt-6.1-sol',
      effort: variant === 'codex-individual' ? 'medium' : 'low',
    });
    if (variant === 'selective-review' && item.assessment.risk === 'high')
      team.addTask({
        project,
        role: 'tester',
        title: 'Revisión profunda',
        prompt: 'Verifica los riesgos',
        context: packet,
        assessment: item.assessment,
        dependsOn: [developer.id],
        reviewMode: 'deep',
      });
  }
  await team.start();
  const until = Date.now() + 30000;
  while (team.snapshot().running && Date.now() < until)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(!team.snapshot().running, 'simulation deadline');
  const state = team.snapshot(),
    quality = await acceptance(item, project, tools.stopProcess);
  const missingSensitiveReview =
    item.assessment.risk === 'high' &&
    !state.tasks.some((t) => t.role === 'tester' && t.status === 'completed');
  const accepted =
    quality.passed && !missingSensitiveReview && state.tasks.every((t) => t.status === 'completed');
  if (injectDefect) assert.equal(accepted, false);
  else if (!missingSensitiveReview)
    assert.equal(
      accepted,
      true,
      JSON.stringify(state.tasks.map((t) => ({ role: t.role, reason: t.reasonCode }))),
    );
  if (variant === 'adaptive-office' && item.assessment.risk === 'low')
    assert.deepEqual(
      calls.map((c) => c.role),
      ['developer'],
    );
  await team.shutdown();
  return {
    caseId: item.id,
    variant,
    injectedDefect: injectDefect,
    calls,
    accepted,
    checksPassed: quality.tests.filter((t) => t.passed).length,
    totalChecks: quality.tests.length,
    localDurationMs: Date.now() - start,
    simulatedTokens: state.tokensUsed,
    missingSensitiveReview,
    statuses: state.tasks.map((t) => ({ role: t.role, status: t.status, reason: t.reasonCode })),
  };
}
try {
  for (const item of cases)
    for (const variant of variants) report.results.push(await simulate(item, variant));
  report.results.push(await simulate(cases[0], 'light-local', true));
  report.passed = true;
} finally {
  const output = path.join(root, 'reports/optimizacion-adaptativa/SIMULACION.json');
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({
      passed: report.passed,
      inferenceCalls: 0,
      scenarios: report.results.length,
      modelSavingsMeasured: false,
    }),
  );
}
