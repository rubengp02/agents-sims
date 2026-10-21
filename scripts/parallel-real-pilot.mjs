// Explicitly authorized, one-shot local benchmark; never imported by CI.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTools, root, sourceFingerprint } from './optimization-tools.mjs';
import { objective, contracts, caseFiles, references } from './parallel-pilot-case.mjs';
import { verifyFutureTrial } from './parallel-protocol.mjs';
import { writeJson } from './pilot-supervision.mjs';

export const limits = Object.freeze({
  maxRuns: 3,
  maxTokens: 200000,
  totalMs: 720000,
  maxParallel: 2,
  perRunMs: 180000,
  directTokens: 80000,
  workerTokens: 60000,
  officeMs: 480000,
  maxRepairs: 0,
});
const hash = (x) => createHash('sha256').update(x).digest('hex');
const files = Object.keys(contracts);
const tests = ['csv.test.mjs', 'graph.test.mjs', 'integration.test.mjs'];
export function usageIsFinal(record) {
  return (
    record.status === 'completed' &&
    record.reasonCode == null &&
    Number.isSafeInteger(record.inputTokens) &&
    record.inputTokens >= 0 &&
    Number.isSafeInteger(record.outputTokens) &&
    record.outputTokens >= 0
  );
}
function paths(id, fixture = false) {
  assert.match(id, /^parallel-[a-f0-9]{8}$/);
  return {
    privateDir: path.join(root, '.local-office/parallel-real', id),
    publicDir: fixture
      ? path.join(root, '.local-office/parallel-real', id, 'fixture-report')
      : path.join(root, 'reports/paralelismo-real', id),
  };
}
function materialize(dir, reference = false) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(caseFiles(reference)))
    fs.writeFileSync(path.join(dir, name), content);
}
function snapshot(dir) {
  const out = {};
  function visit(relative = '') {
    for (const n of fs.readdirSync(path.join(dir, relative)).sort()) {
      if (n === '.git') continue;
      const rel = path.join(relative, n),
        stat = fs.lstatSync(path.join(dir, rel));
      assert(!stat.isSymbolicLink(), 'Unexpected symlink');
      if (stat.isDirectory()) visit(rel);
      else out[rel.replaceAll('\\', '/')] = hash(fs.readFileSync(path.join(dir, rel)));
    }
  }
  visit();
  return out;
}
function git(dir, args) {
  return execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    windowsHide: true,
    stdio: 'pipe',
  }).trim();
}
function init(dir) {
  git(dir, ['init', '--initial-branch=main']);
  git(dir, ['config', '--local', 'core.autocrlf', 'false']);
  git(dir, ['add', '.']);
  git(dir, [
    '-c',
    'user.name=Benchmark',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-m',
    'initial',
  ]);
}
function acceptance(dir, selected = tests) {
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...selected], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 15000,
    windowsHide: true,
    maxBuffer: 1000000,
    env: Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|TMPDIR|COMSPEC|LANG|LC_ALL)$/i.test(key),
      ),
    ),
  });
  return {
    passed: result.status === 0,
    tests: Number(/^# tests (\d+)$/m.exec(result.stdout ?? '')?.[1] ?? 0),
    failures: Number(/^# fail (\d+)$/m.exec(result.stdout ?? '')?.[1] ?? 0),
  };
}
export async function prepare(injectedTools) {
  const id = 'parallel-' + randomUUID().slice(0, 8),
    p = paths(id, !!injectedTools);
  fs.mkdirSync(p.privateDir, { recursive: true });
  for (const ref of [false, true])
    materialize(path.join(p.privateDir, ref ? 'reference' : 'initial'), ref);
  const initial = acceptance(path.join(p.privateDir, 'initial'));
  const reference = acceptance(path.join(p.privateDir, 'reference'));
  assert(
    !initial.passed && reference.passed && reference.tests === 50,
    'Invalid acceptance oracle',
  );
  // Each part passes alone with the other part still broken; the joint gate rejects it.
  const partial = path.join(p.privateDir, 'partial');
  materialize(partial);
  fs.writeFileSync(path.join(partial, 'csv.mjs'), references['csv.mjs']);
  assert(acceptance(partial, ['csv.test.mjs']).passed && !acceptance(partial).passed);
  const tools = injectedTools ?? (await loadTools());
  const capability = await new tools.OrchestratorExecutor(
    root,
    path.join(p.privateDir, 'preflight'),
  ).diagnose();
  assert(capability.models.some((m) => m.id === 'gpt-6.1-sol' && m.efforts.includes('low')));
  const plan = {
    id: 'controlled-fixed-v1',
    attempt: id,
    status: 'prepared-not-authorized',
    realProviderEnabled: true,
    sourceFingerprint: sourceFingerprint(),
    limits,
    model: 'gpt-6.1-sol',
    effort: 'low',
    sessionMode: 'fresh',
    task: 'csv-and-dag-import-pipeline-v1',
    objective,
    ownedFiles: files,
    checks: { initial, reference, partialRejected: true },
    initialHash: hash(JSON.stringify(snapshot(path.join(p.privateDir, 'initial')))),
    arms: ['codex-individual-strict', 'office-two-writers'],
    order: 'direct-first; single pair, exploratory; cache/order bias not eliminated',
    chief: 'local deterministic routing from explicit disjoint contracts; no AI planning',
    review: 'immutable local acceptance; low-risk isolated exercise; no AI reviewer or repair',
    estimates:
      'Human approval required: 80k direct, 60k per worker; 180s per call; 20s preparation and integration each. These are conservative caps, not measured parallel speedups.',
    tokenCeiling:
      'Observed usage at turn completion; CLI does not guarantee a hard token generation cap.',
    limitations: [
      'One separable task; not coupled tasks or statistical proof',
      'Different native engines: Codex CLI versus optional AO; whole-product comparison',
      'No historical baseline matches this task',
      'No automatic budget increases or retries',
    ],
    preparedAt: new Date().toISOString(),
    inferenceCalls: 0,
  };
  writeJson(path.join(p.publicDir, 'PLAN.json'), plan, true);
  writeJson(
    path.join(p.privateDir, 'authorization.pending.json'),
    { approved: false, planHash: hash(JSON.stringify(plan)), expiresAt: null },
    true,
  );
  return plan;
}
export async function execute(id, injectedTools) {
  const p = paths(id, !!injectedTools),
    plan = JSON.parse(fs.readFileSync(path.join(p.publicDir, 'PLAN.json')));
  const authorization = JSON.parse(fs.readFileSync(path.join(p.privateDir, 'authorization.json')));
  verifyFutureTrial(plan, authorization, sourceFingerprint());
  assert.deepEqual(plan.limits, limits);
  assert.equal(plan.attempt, id);
  const ledger = {
    startedAt: Date.now(),
    attempts: 0,
    tokens: 0,
    observedTokens: 0,
    reserved: 0,
    paused: false,
    closed: false,
    reason: null,
  };
  const ledgerFile = path.join(p.privateDir, 'ledger.json');
  writeJson(ledgerFile, ledger, true);
  const report = {
    mode: injectedTools ? 'injected-protocol-fixture' : 'real-pilot',
    usageSource: injectedTools ? 'simulated' : 'official-cli-receipts',
    version: 1,
    protocol: plan.id,
    task: plan.task,
    limits,
    model: plan.model,
    effort: plan.effort,
    sourceFingerprint: plan.sourceFingerprint,
    runs: [],
    methods: [],
    inferenceObserved: false,
    repairs: 0,
  };
  const save = () => {
    writeJson(ledgerFile, ledger);
    writeJson(path.join(p.publicDir, 'RESULTADO.json'), report);
  };
  const tools = injectedTools ?? (await loadTools()),
    abort = new AbortController();
  let team,
    active = 0,
    peak = 0;
  const stop = (reason) => {
    ledger.paused = true;
    ledger.reason ??= reason;
    abort.abort();
    team?.pause(reason);
    save();
  };
  const timer = setTimeout(() => stop('total_time_budget'), limits.totalMs);
  async function guarded(engine, options, reserve, method) {
    assert(!ledger.paused && !ledger.closed && ledger.tokens !== null);
    assert(
      ledger.attempts < limits.maxRuns &&
        ledger.tokens + ledger.reserved + reserve <= limits.maxTokens,
      'Budget reservation rejected',
    );
    assert(Date.now() - ledger.startedAt < limits.totalMs);
    const receipt = {
      attempt: ++ledger.attempts,
      method,
      worker: options.officeRole ?? 'developer',
      status: 'dispatching',
      startedAt: Date.now(),
      runId: null,
      input: null,
      output: null,
      cached: null,
    };
    ledger.reserved += reserve;
    report.runs.push(receipt);
    save();
    active++;
    peak = Math.max(peak, active);
    try {
      // Each native executor re-verifies subscription before dispatch and before its turn.
      const r = await engine.execute({
        ...options,
        model: plan.model,
        effort: plan.effort,
        timeoutMs: Math.min(
          options.timeoutMs ?? Infinity,
          limits.perRunMs,
          limits.totalMs - (Date.now() - ledger.startedAt),
        ),
        maxReportedTokens: reserve,
        executionSessionKey: id + '-' + receipt.attempt,
        signal: options.signal ? AbortSignal.any([options.signal, abort.signal]) : abort.signal,
      });
      Object.assign(receipt, {
        status: r.status,
        runId: r.id,
        input: r.inputTokens,
        output: r.outputTokens,
        cached: r.cachedInputTokens ?? null,
        durationMs: r.updatedAt - r.startedAt,
        subscriptionVerified: !!r.subscriptionCheckedAt,
        requestedModel: r.requestedModel,
        cliVersion: r.cliVersion ?? null,
        confirmedModel: r.confirmedModel,
        effort: r.requestedEffort,
        sessionMode: r.sessionMode,
        metrics: r.metrics ?? null,
        reason: r.reasonCode,
        usageComplete: usageIsFinal(r),
        observedUsage: r.observedUsage ?? null,
        finishedAt: Date.now(),
      });
      ledger.reserved -= reserve;
      if (Number.isSafeInteger(r.inputTokens) && Number.isSafeInteger(r.outputTokens))
        ledger.observedTokens += r.inputTokens + r.outputTokens;
      else if (r.observedUsage) {
        ledger.observedTokens += r.observedUsage.inputTokens + r.observedUsage.outputTokens;
        report.inferenceObserved ||=
          !injectedTools && r.observedUsage.inputTokens + r.observedUsage.outputTokens > 0;
      }
      if (!usageIsFinal(r)) {
        ledger.tokens = null;
        stop(r.reasonCode ?? 'usage_unknown');
      } else {
        if (ledger.tokens !== null) ledger.tokens += r.inputTokens + r.outputTokens;
        report.inferenceObserved ||= !injectedTools && r.inputTokens + r.outputTokens > 0;
        if (
          r.inputTokens + r.outputTokens > reserve ||
          ledger.tokens + ledger.reserved > limits.maxTokens
        )
          stop('token_budget');
      }
      if (r.status !== 'completed' || !r.subscriptionCheckedAt)
        stop(r.reasonCode ?? 'execution_not_accepted');
      save();
      return r;
    } catch (error) {
      receipt.status = 'interrupted';
      ledger.tokens = null;
      stop(error.code ?? 'receipt_unknown');
      throw error;
    } finally {
      active--;
      save();
    }
  }
  try {
    for (const method of plan.arms) {
      if (ledger.paused) break;
      const start = Date.now(),
        project = path.join(p.privateDir, method);
      materialize(project);
      const before = snapshot(project);
      assert.equal(hash(JSON.stringify(before)), plan.initialHash);
      init(project);
      let candidate = project,
        complete = false,
        operations = null;
      if (method === 'codex-individual-strict') {
        const record = await guarded(
          new tools.CodexExecutor(path.join(p.privateDir, 'direct-receipts')),
          {
            project,
            prompt:
              objective +
              ' Lee TASK.md. Resuelve todo tú, sin delegación. Ejecuta las pruebas completas.',
            allowWrites: true,
            signal: abort.signal,
          },
          limits.directTokens,
          method,
        );
        complete = record.status === 'completed';
      } else {
        const native = new tools.OrchestratorExecutor(
          root,
          path.join(p.privateDir, 'office-receipts'),
        );
        const executor = {
          provider: 'codex',
          engine: 'agent-orchestrator',
          workspaceManager: native.workspaceManager,
          maxConcurrentReadOnly: 2,
          diagnose: () => native.diagnose(),
          execute: (options) => guarded(native, options, limits.workerTokens, method),
        };
        const criteria = Object.values(contracts);
        const registry = {};
        for (const [name, selected] of [
          ['csv', ['csv.test.mjs']],
          ['graph', ['graph.test.mjs']],
          ['joint', tests],
        ])
          registry[name] = {
            executable: process.execPath,
            args: ['--test', ...selected],
            timeoutMs: 15000,
            acceptance: true,
            criteria: name === 'joint' ? criteria : [contracts[name + '.mjs']],
          };
        const checks = new tools.LocalChecks(registry, path.join(p.privateDir, 'checks'), project);
        team = new tools.TeamCoordinator(
          { codex: executor, claude: new tools.DisabledExecutor('claude') },
          undefined,
          undefined,
          checks,
          undefined,
          path.join(p.privateDir, 'team-checkpoint.json'),
          new tools.AdaptiveRuntime(
            new tools.UsageHistory(path.join(p.privateDir, 'history.json')),
            path.join(p.privateDir, 'artifacts'),
          ),
        );
        team.configure({
          mode: 'auto',
          claudeEnabled: false,
          maxRuns: 2,
          maxParallel: 2,
          maxMinutes: limits.officeMs / 60000,
          maxTokens: 120000,
        });
        const context = {
          objective,
          files: Object.keys(caseFiles()),
          decisions: ['Lee TASK.md. Contratos y pruebas inmutables. Sin delegación.'],
          acceptance: criteria,
          checks: ['csv', 'graph', 'joint'],
        };
        const assessment = {
          scope: 'bounded',
          risk: 'low',
          uncertainty: 'low',
          modules: ['csv', 'graph'],
          tests: 'available',
          acceptanceCoverage: 'complete',
        };
        const decomposition = {
          sharedFiles: Object.keys(caseFiles()).filter((f) => !files.includes(f)),
          parts: files.map((f, i) => ({
            title: 'Programador ' + (i + 1),
            objective: 'Implementa únicamente ' + f + ' según TASK.md.',
            ownedFiles: [f],
            context: {
              ...context,
              objective: 'Implementa únicamente ' + f + ' según TASK.md.',
              files: context.files.filter((other) => other !== files[1 - i]),
              checks: [i === 0 ? 'csv' : 'graph'],
              acceptance: [contracts[f]],
            },
            assessment: { ...assessment, modules: [f] },
          })),
        };
        team.addScopedWorkflow(project, context, assessment, true, decomposition);
        assert.equal(team.snapshot().tasks.length, 2, 'Unexpected specialists: no dispatch');
        for (const t of team.snapshot().tasks) {
          team.override(t.id, { provider: 'codex', model: plan.model, effort: plan.effort });
          await team.assign(t.id);
          team.reviewBudget(t.id, limits.workerTokens, limits.perRunMs, 15000);
        }
        const workflow = team.snapshot().workflows[0];
        assert(workflow);
        team.reviewWorkflowBudget(workflow.id, 20000, 20000, 360000);
        const planningMs = Date.now() - start;
        await team.start();
        while (team.snapshot().running && !ledger.paused)
          await new Promise((r) => setTimeout(r, 100));
        const state = team.snapshot(),
          w = state.workflows[0];
        candidate = w.candidateProject ?? project;
        operations = {
          planningMs,
          workflowStatus: w.status,
          mode: w.mode,
          reason: w.reason,
          preparationMs: w.preparationMs,
          integrationMs: w.integrationMs,
          sumWorkMs: state.timeUsedMs,
          localChecks: w.localChecks,
          tasks: state.tasks.map((t) => ({
            role: t.role,
            status: t.status,
            runId: t.runId,
            localChecks: t.localChecks,
          })),
        };
        complete = w.status === 'accepted' && state.tasks.every((t) => t.status === 'completed');
        await team.shutdown();
        team = null;
      }
      const after = snapshot(candidate),
        changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
          (f) => before[f] !== after[f],
        );
      const protectedFiles = changed.every((f) => files.includes(f));
      const quality = acceptance(candidate),
        accepted =
          complete && protectedFiles && quality.passed && quality.tests === 50 && !ledger.paused;
      const calls = report.runs.filter((r) => r.method === method);
      const usageComplete = calls.length > 0 && calls.every((r) => r.usageComplete);
      report.methods.push({
        method,
        accepted,
        quality,
        protectedFiles,
        changed,
        operations,
        wallMs: Date.now() - start,
        sumAgentMs: calls.reduce((n, r) => n + (r.durationMs ?? 0), 0),
        usageComplete,
        observedTokens: calls.reduce(
          (n, r) =>
            n +
            (r.input ?? r.observedUsage?.inputTokens ?? 0) +
            (r.output ?? r.observedUsage?.outputTokens ?? 0),
          0,
        ),
        input: usageComplete ? calls.reduce((n, r) => n + r.input, 0) : null,
        output: usageComplete ? calls.reduce((n, r) => n + r.output, 0) : null,
        cached:
          usageComplete && calls.every((r) => r.cached !== null)
            ? calls.reduce((n, r) => n + r.cached, 0)
            : null,
        uncachedInput:
          usageComplete && calls.every((r) => r.cached !== null && r.input !== null)
            ? calls.reduce((n, r) => n + r.input - r.cached, 0)
            : null,
        peakConcurrent: method === 'office-two-writers' ? peak : 1,
      });
      save();
      if (!accepted) stop('acceptance_or_circuit_failed');
    }
  } catch (error) {
    stop(error.code ?? 'execution_unverified');
  } finally {
    clearTimeout(timer);
    await team?.shutdown();
    ledger.closed = true;
    report.wallMs = Date.now() - ledger.startedAt;
    report.reason = ledger.reason;
    report.complete = report.methods.length === 2 && report.methods.every((m) => m.accepted);
    save();
  }
  return { complete: report.complete, reason: report.reason, attempt: id };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'prepare') console.log(JSON.stringify(await prepare(), null, 2));
  else if (process.argv[2] === 'execute')
    console.log(JSON.stringify(await execute(process.argv[3])));
  else throw new Error('Use prepare or execute <attempt>; authorization is never implicit.');
}
