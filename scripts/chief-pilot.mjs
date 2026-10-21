import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cases } from './orchestrator-pilot.mjs';
import { materialize, acceptance, inspectChanges } from './benchmark/kit.mjs';
import { loadTools, root, sourceFingerprint } from './optimization-tools.mjs';

export const LIMITS = Object.freeze({
  maxRuns: 1,
  maxTokens: 120000,
  totalMs: 240000,
  perRunMs: 180000,
  maxRepairs: 0,
});
const privateRoot = path.join(root, '.local-office/chief-pilot');
const reportRoot = path.join(root, 'reports/optimizacion-adaptativa/validacion-jefe/piloto');
const baselineFile = path.join(
  root,
  'reports/agent-orchestrator/revalidacion-20261021-b/PILOTO_REAL.json',
);
const item = cases.find((c) => c.id === 'medium');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
};
function snapshot(dir) {
  const files = {};
  function visit(relative = '') {
    for (const name of fs.readdirSync(path.join(dir, relative)).sort()) {
      if (name === '.git') continue;
      const file = path.join(relative, name),
        stat = fs.lstatSync(path.join(dir, file));
      if (stat.isSymbolicLink()) throw new Error('No se aceptan enlaces en el piloto.');
      if (stat.isDirectory()) visit(file);
      else files[file.replaceAll('\\', '/')] = hash(fs.readFileSync(path.join(dir, file)));
    }
  }
  visit();
  return files;
}
function baseline() {
  const bytes = fs.readFileSync(baselineFile),
    report = JSON.parse(bytes);
  const direct = report.methods.find((m) => m.method === 'direct'),
    run = report.runs.find((r) => r.method === 'direct');
  assert.equal(direct?.status, 'accepted');
  assert.equal(direct.quality.passed, true);
  assert.equal(direct.quality.tests.length, 36);
  assert.equal(direct.changes.passed, true);
  assert.equal(run.subscriptionVerified, true);
  assert.equal(run.status, 'completed');
  assert.equal(report.model, 'gpt-6.1-sol');
  assert.equal(report.effort, 'medium');
  assert.ok(direct.mechanical.length && direct.mechanical.every((c) => c.passed));
  return {
    reportSha256: hash(bytes),
    model: report.model,
    effort: report.effort,
    method: direct,
    run,
  };
}
export function verifyPilotAuthorization(authorization, plan, now = Date.now()) {
  if (
    authorization?.approved !== true ||
    authorization.protocol !== plan.protocol ||
    authorization.planHash !== hash(JSON.stringify(plan)) ||
    JSON.stringify(authorization.limits) !== JSON.stringify(LIMITS) ||
    !authorization.authorizationNote?.trim() ||
    !Number.isFinite(Date.parse(authorization.expiresAt)) ||
    Date.parse(authorization.expiresAt) <= now ||
    Date.parse(authorization.expiresAt) > now + 86400000
  )
    throw new Error('Falta autorización explícita vigente para este plan y estos límites exactos.');
}
export async function preparePilot() {
  if (fs.existsSync(path.join(privateRoot, 'ledger.json')))
    throw new Error('Este piloto ya tiene un intento; no se reinicia.');
  const tools = await loadTools(),
    dir = path.join(root, '.local-office', 'cp-' + randomUUID().slice(0, 8));
  fs.mkdirSync(dir);
  const initial = path.join(dir, 'initial'),
    reference = path.join(dir, 'reference');
  materialize(initial, item);
  materialize(reference, item, true);
  const a = await acceptance(item, initial, tools.stopProcess),
    b = await acceptance(item, reference, tools.stopProcess);
  assert.equal(a.passed, false);
  assert.equal(b.passed, true);
  assert.equal(b.tests.length, 36);
  const previous = baseline(),
    initialHash = hash(JSON.stringify(snapshot(initial)));
  assert.equal(initialHash, previous.method.initialHash);
  const plan = {
    protocol: 'adaptive-chief-single-worker-v1',
    status: 'prepared-not-authorized',
    sourceFingerprint: sourceFingerprint(),
    model: 'gpt-6.1-sol',
    effort: 'low',
    engine: 'agent-orchestrator',
    limits: LIMITS,
    caseId: 'medium',
    initialHash,
    allowedFiles: item.files,
    baseline: previous,
    checks: { rejectsInitial: true, acceptsReference: true, count: 36 },
    decision: 'Local chief must select exactly one developer; no AI chief, architect or reviewer.',
    limitation:
      'Historical reference uses medium effort and another engine/context; this is exploratory whole-product comparison, not isolated model-effort evidence.',
    tokenLimit: 'Observed usage, not a provider-guaranteed generation ceiling.',
    inferenceCalls: 0,
    preparedAt: new Date().toISOString(),
  };
  write(path.join(reportRoot, 'PLAN.json'), plan);
  write(path.join(privateRoot, 'authorization.pending.json'), {
    protocol: plan.protocol,
    approved: false,
    planHash: hash(JSON.stringify(plan)),
    limits: LIMITS,
    authorizationNote: '',
    expiresAt: null,
  });
  return plan;
}
export async function executePilot() {
  const plan = JSON.parse(fs.readFileSync(path.join(reportRoot, 'PLAN.json')));
  // All authorization/staleness checks precede native provider construction.
  const authorization = JSON.parse(fs.readFileSync(path.join(privateRoot, 'authorization.json')));
  verifyPilotAuthorization(authorization, plan);
  assert.equal(plan.sourceFingerprint, sourceFingerprint(), 'Preparación desactualizada.');
  assert.deepEqual(plan.limits, LIMITS);
  assert.equal(plan.baseline.reportSha256, baseline().reportSha256);
  assert.equal(plan.model, 'gpt-6.1-sol');
  assert.equal(plan.effort, 'low');
  assert.equal(plan.caseId, 'medium');
  const ledgerFile = path.join(privateRoot, 'ledger.json');
  const ledger = {
    startedAt: Date.now(),
    attempts: 0,
    tokens: 0,
    closed: false,
    paused: false,
    reason: null,
  };
  fs.writeFileSync(ledgerFile, JSON.stringify(ledger), { flag: 'wx', mode: 0o600 });
  const report = {
    protocol: plan.protocol,
    mode: 'real-pilot-requested',
    limits: LIMITS,
    baseline: plan.baseline,
    sourceFingerprint: plan.sourceFingerprint,
    model: plan.model,
    effort: plan.effort,
    initialHash: plan.initialHash,
    runs: [],
    inferenceObserved: false,
    methods: [],
    status: 'running',
    repairs: 0,
  };
  const save = () => {
    write(ledgerFile, ledger);
    write(path.join(reportRoot, 'RESULTADO_REAL.json'), report);
  };
  let team, timer;
  try {
    const tools = await loadTools(),
      dir = path.join(root, '.local-office', 'cp-' + randomUUID().slice(0, 8)),
      project = path.join(dir, 'source');
    fs.mkdirSync(dir);
    materialize(project, item);
    const before = snapshot(project);
    assert.equal(hash(JSON.stringify(before)), plan.initialHash);
    const git = (args) =>
      execFileSync('git', args, { cwd: project, windowsHide: true, stdio: 'pipe' });
    git(['init', '--initial-branch=main']);
    git(['config', '--local', 'core.autocrlf', 'false']);
    git(['add', '.']);
    git([
      '-c',
      'user.name=Local Pilot',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-m',
      'initial',
    ]);
    const criteria = item.contract.split('\n').filter(Boolean);
    const checks = new tools.LocalChecks(
      {
        acceptance: {
          executable: process.execPath,
          args: [path.join(root, 'scripts/adaptive-acceptance.mjs'), item.id, '.'],
          timeoutMs: 10000,
          acceptance: true,
          criteria,
        },
        public: {
          executable: process.execPath,
          args: ['--test', 'contract.test.mjs'],
          timeoutMs: 10000,
        },
      },
      path.join(dir, 'logs'),
    );
    const engine = new tools.OrchestratorExecutor(root, path.join(dir, 'receipts'));
    const guarded = {
      provider: 'codex',
      engine: 'agent-orchestrator',
      diagnose: () => engine.diagnose(),
      async execute(options) {
        if (
          ledger.closed ||
          ledger.paused ||
          ledger.attempts >= LIMITS.maxRuns ||
          Date.now() - ledger.startedAt >= LIMITS.totalMs
        )
          throw new Error('El piloto no permite otra llamada.');
        ledger.attempts++;
        save();
        const record = await engine.execute({
          ...options,
          model: plan.model,
          effort: plan.effort,
          timeoutMs: Math.min(LIMITS.perRunMs, LIMITS.totalMs - (Date.now() - ledger.startedAt)),
          maxReportedTokens: LIMITS.maxTokens,
        });
        report.runs.push({
          role: options.officeRole,
          status: record.status,
          reason: record.reasonCode,
          input: record.inputTokens,
          output: record.outputTokens,
          cached: record.cachedInputTokens,
          durationMs: record.updatedAt - record.startedAt,
          subscriptionVerified: !!record.subscriptionCheckedAt,
          requestedModel: record.requestedModel,
          confirmedModel: record.confirmedModel,
          effort: record.requestedEffort,
          sessionMode: record.sessionMode,
        });
        if (record.inputTokens === null || record.outputTokens === null) {
          ledger.tokens = null;
          ledger.paused = true;
          ledger.reason = record.reasonCode ?? 'usage_unknown';
        } else {
          ledger.tokens = record.inputTokens + record.outputTokens;
          report.inferenceObserved = ledger.tokens > 0;
          if (ledger.tokens > LIMITS.maxTokens) {
            ledger.paused = true;
            ledger.reason = 'token_budget';
          }
        }
        save();
        return record;
      },
    };
    team = new tools.TeamCoordinator(
      { codex: guarded, claude: new tools.DisabledExecutor('claude') },
      undefined,
      undefined,
      checks,
      undefined,
      undefined,
      new tools.AdaptiveRuntime(
        new tools.UsageHistory(path.join(dir, 'control/history.json')),
        path.join(dir, 'control/artifacts'),
      ),
    );
    team.configure({
      mode: 'auto',
      claudeEnabled: false,
      maxRuns: 1,
      maxParallel: 1,
      maxMinutes: 4,
      maxTokens: LIMITS.maxTokens,
    });
    timer = setTimeout(
      () => {
        ledger.paused = true;
        ledger.reason = 'time_budget';
        save();
        team.pause('time_budget');
      },
      Math.max(1, LIMITS.totalMs - (Date.now() - ledger.startedAt)),
    );
    await team.plan(project, item.objective, true, {
      context: {
        objective: item.objective,
        files: item.files,
        decisions: ['Contrato completo en TASK.md; no modificar instrucciones ni pruebas.'],
        acceptance: criteria,
        checks: ['public', 'acceptance'],
      },
      assessment: item.assessment,
    });
    assert.deepEqual(
      team.snapshot().tasks.map((t) => t.role),
      ['developer'],
    );
    const task = await team.assign(team.snapshot().tasks[0].id);
    if (!task.choice)
      throw Object.assign(new Error('Asignación bloqueada antes de inferencia.'), {
        code: task.reasonCode ?? 'assignment_unverified',
      });
    assert.equal(task.choice.model, plan.model);
    assert.equal(task.choice.effort, plan.effort);
    // This human bound may only be applied after the exact pilot authorization above.
    team.reviewBudget(task.id, LIMITS.maxTokens, LIMITS.perRunMs, 12000);
    await team.start();
    while (team.snapshot().running) await new Promise((resolve) => setTimeout(resolve, 100));
    const final = team.snapshot().tasks[0],
      target = final.executionProject ?? project;
    const quality = await acceptance(item, target, tools.stopProcess),
      changes = inspectChanges(before, snapshot(target), item.files);
    if (Date.now() - ledger.startedAt > LIMITS.totalMs) {
      ledger.paused = true;
      ledger.reason = 'time_budget';
    }
    report.methods.push({
      method: 'adaptive-office',
      model: plan.model,
      effort: plan.effort,
      initialHash: plan.initialHash,
      status:
        final.status === 'completed' && quality.passed && changes.passed && !ledger.paused
          ? 'accepted'
          : 'not-accepted',
      quality,
      changes,
      mechanical: final.localChecks,
      roles: [final.role],
      tokens: ledger.tokens,
      durationMs: Date.now() - ledger.startedAt,
    });
    report.status = final.status;
    ledger.reason ??= final.reasonCode;
  } catch (error) {
    report.status = 'paused';
    ledger.paused = true;
    ledger.reason = error.code ?? 'execution_unverified';
  } finally {
    clearTimeout(timer);
    if (team) await team.shutdown();
    ledger.closed = true;
    report.reason = ledger.reason;
    report.durationMs = Date.now() - ledger.startedAt;
    save();
  }
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const action = process.argv[2] ?? 'prepare';
  if (action === 'prepare') {
    const p = await preparePilot();
    console.log(
      JSON.stringify({
        status: p.status,
        limits: p.limits,
        model: p.model,
        effort: p.effort,
        inferenceCalls: 0,
      }),
    );
  } else if (action === 'execute') console.log(JSON.stringify(await executePilot(), null, 2));
  else throw new Error('Acción no reconocida.');
}
