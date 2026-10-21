// Explicitly gated real pilot. Preparation and injected-fixture tests never start a model.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cases } from './orchestrator-pilot.mjs';
import { materialize, acceptance, inspectChanges } from './benchmark/kit.mjs';
import { fixtureFiles } from './benchmark/cases.mjs';
import { contextVariants, digest, verifyCanonicalFiles } from './context-experiment.mjs';
import { loadTools, root, sourceFingerprint } from './optimization-tools.mjs';
import {
  attachSupervision,
  launchSupervised,
  reconcileSupervision,
  writeJson,
} from './pilot-supervision.mjs';

export const LIMITS = Object.freeze({
  maxRuns: 4,
  maxTokens: 480000,
  perRunTokens: 120000,
  totalMs: 960000,
  perArmMs: 220000,
  perRunMs: 180000,
  maxRepairs: 0,
});
export const ARMS = Object.freeze([
  { method: 'direct', variant: 'standard' },
  { method: 'office', variant: 'standard' },
  { method: 'office', variant: 'canonical' },
  { method: 'direct', variant: 'canonical' },
]);
const item = cases.find((c) => c.id === 'medium');
const defaultPrivate = path.join(root, '.local-office/context-pilot');
const defaultReports = path.join(root, 'reports/optimizacion-contexto/piloto-controlado');
export function pilotPaths(attempt) {
  if (attempt === undefined) return { privateDir: defaultPrivate, reports: defaultReports };
  assert.match(attempt, /^[a-z][a-z0-9-]{0,47}$/);
  return {
    privateDir: path.join(defaultPrivate, attempt),
    reports: path.join(defaultReports, attempt),
    attempt,
  };
}
const write = writeJson;
function fixtureSnapshot(project) {
  const files = {};
  function visit(relative = '') {
    for (const name of fs.readdirSync(path.join(project, relative)).sort()) {
      if (name === '.git') continue;
      const file = path.join(relative, name),
        stat = fs.lstatSync(path.join(project, file));
      assert(!stat.isSymbolicLink(), 'No se aceptan enlaces.');
      if (stat.isDirectory()) visit(file);
      else files[file.replaceAll('\\', '/')] = digest(fs.readFileSync(path.join(project, file)));
    }
  }
  visit();
  return files;
}
function verifyWorkspace(project) {
  const files = Object.fromEntries(
    Object.keys(fixtureFiles(item)).map((f) => {
      const file = path.join(project, f),
        stat = fs.lstatSync(file);
      assert(stat.isFile() && !stat.isSymbolicLink());
      return [f, fs.readFileSync(file, 'utf8')];
    }),
  );
  return verifyCanonicalFiles(item, files);
}
export function verifyAuthorization(authorization, plan, now = Date.now()) {
  assert.equal(authorization?.approved, true, 'Falta aprobación expresa de los límites.');
  assert.equal(authorization.protocol, plan.protocol);
  assert.equal(authorization.planHash, digest(JSON.stringify(plan)));
  assert.deepEqual(authorization.limits, LIMITS);
  assert.equal(typeof authorization.authorizationNote, 'string');
  assert(authorization.authorizationNote.trim());
  const expiry = Date.parse(authorization.expiresAt);
  assert(Number.isFinite(expiry) && expiry > now && expiry <= now + 86400000);
  assert(
    ['context-controlled-real-v1', 'context-controlled-supervised-v2'].includes(plan.protocol),
  );
  if (plan.protocol === 'context-controlled-supervised-v2') {
    assert.equal(plan.supervisionRequired, true);
    assert.match(plan.attempt, /^[a-z][a-z0-9-]{0,47}$/);
  }
  assert.equal(plan.model, 'gpt-6.1-sol');
  assert.equal(plan.effort, 'low');
  assert.equal(plan.engine, 'codex-cli');
  assert.deepEqual(plan.limits, LIMITS);
  assert.deepEqual(
    plan.arms.map(({ method, variant }) => ({ method, variant })),
    ARMS,
  );
}

export async function prepareContextPilot(options = {}) {
  const privateDir = options.privateDir ?? defaultPrivate,
    reports = options.reports ?? defaultReports;
  assert(
    !fs.existsSync(path.join(privateDir, 'ledger.json')),
    'Este piloto ya tiene un intento; no se reinicia.',
  );
  assert(!fs.existsSync(path.join(reports, 'PLAN.json')), 'El plan existente se conserva.');
  const tools = await loadTools(),
    prepared = contextVariants(item, tools);
  const dir = path.join(root, '.local-office', 'cx-' + randomUUID().slice(0, 8));
  fs.mkdirSync(dir);
  const initial = path.join(dir, 'initial'),
    reference = path.join(dir, 'reference');
  materialize(initial, item);
  materialize(reference, item, true);
  const a = await acceptance(item, initial, tools.stopProcess),
    b = await acceptance(item, reference, tools.stopProcess);
  assert(!a.passed && b.passed);
  assert.equal(b.tests.length, 36);
  const plan = {
    protocol: options.attempt ? 'context-controlled-supervised-v2' : 'context-controlled-real-v1',
    ...(options.attempt ? { attempt: options.attempt, supervisionRequired: true } : {}),
    status: 'prepared-awaiting-exact-limit-approval',
    model: 'gpt-6.1-sol',
    effort: 'low',
    engine: 'codex-cli',
    caseId: item.id,
    limits: LIMITS,
    sourceFingerprint: sourceFingerprint(),
    fixtureHash: digest(JSON.stringify(fixtureSnapshot(initial))),
    acceptanceHash: digest(JSON.stringify(prepared.packet.acceptance)),
    arms: ARMS.map((arm) => ({
      ...arm,
      submittedPromptHash: digest(tools.CODEX_TASK_PREFIX + prepared.variants[arm.variant].prompt),
    })),
    preflight: { rejectsInitial: true, acceptsReference: true, independentChecks: 36 },
    protocolNotes: [
      'same CLI, configuration, effort, permissions and fixture in all four arms',
      'same submitted prompt for direct and office within each variant',
      'one pair per variant, reversed method order; exploratory, no automatic promotion',
      'local checks, independent acceptance and scope validation required for every arm',
      'unknown usage, subscription loss, failed acceptance or a limit pauses the whole pilot',
      'cache observed, not manipulated; new sessions; no additional providers',
      'all remaining calls reserve their full per-run token and time bounds before dispatch',
    ],
    observedLimit:
      'Tokens may be reported at completion; observed bounds do not guarantee an exact generation ceiling.',
    inferenceCalls: 0,
  };
  write(path.join(reports, 'PLAN.json'), plan, true);
  write(
    path.join(privateDir, 'authorization.pending.json'),
    {
      protocol: plan.protocol,
      approved: false,
      planHash: digest(JSON.stringify(plan)),
      limits: LIMITS,
      authorizationNote: '',
      expiresAt: null,
    },
    true,
  );
  return plan;
}

/** Optional dependencies are an in-process test seam; the CLI exposes no bypass. */
export async function executeContextPilot(deps = {}) {
  const privateDir = deps.privateDir ?? defaultPrivate,
    reports = deps.reports ?? defaultReports;
  const plan = JSON.parse(fs.readFileSync(path.join(reports, 'PLAN.json')));
  const authorization = JSON.parse(fs.readFileSync(path.join(privateDir, 'authorization.json')));
  verifyAuthorization(authorization, plan);
  assert.equal(plan.sourceFingerprint, sourceFingerprint(), 'Código distinto al preparado.');
  if (plan.supervisionRequired) {
    assert.equal(plan.attempt, deps.attempt, 'La autorización pertenece a otro intento.');
    assert(deps.supervision, 'Este intento necesita controlador y vigilante independientes.');
    deps.supervision.validate();
  }
  const ledgerFile = path.join(privateDir, 'ledger.json');
  const ledger = {
    startedAt: deps.supervision?.startedAt ?? Date.now(),
    attempts: 0,
    tokens: 0,
    closed: false,
    paused: false,
    reason: null,
  };
  write(ledgerFile, ledger, true);
  const report = {
    protocol: plan.protocol,
    mode: deps.executorFactory ? 'offline-fixture' : 'real-pilot',
    planHash: digest(JSON.stringify(plan)),
    sourceFingerprint: plan.sourceFingerprint,
    limits: LIMITS,
    runs: [],
    arms: [],
    status: 'running',
    inferenceObserved: false,
    automaticPromotion: false,
  };
  const save = () => {
    write(ledgerFile, ledger);
    write(path.join(reports, 'RESULTADO.json'), report);
  };
  const controller = new AbortController();
  let team,
    armTimer,
    phase = 'loading',
    active = null;
  const pause = (reason) => {
    ledger.paused = true;
    ledger.reason ??= reason;
    controller.abort();
    team?.pause(reason);
    save();
  };
  deps.supervision?.onLost(() => pause('supervision_lost'));
  const timer = setTimeout(
    () => pause('total_time_budget'),
    Math.max(1, LIMITS.totalMs - (Date.now() - ledger.startedAt)),
  );
  save();
  try {
    const tools = await loadTools(),
      prepared = contextVariants(item, tools);
    assert.equal(plan.acceptanceHash, digest(JSON.stringify(prepared.packet.acceptance)));
    const runtime = deps.executorFactory ? null : await tools.discoverCodex();
    for (let i = 0; i < ARMS.length; i++) {
      if (ledger.paused) break;
      const remaining = ARMS.length - i;
      assert(
        ledger.tokens !== null &&
          remaining * LIMITS.perRunTokens <= LIMITS.maxTokens - ledger.tokens,
        'No cabe la reserva completa pendiente.',
      );
      assert(
        remaining * LIMITS.perArmMs <= LIMITS.totalMs - (Date.now() - ledger.startedAt),
        'No cabe la reserva de tiempo pendiente.',
      );
      const arm = ARMS[i],
        startedAt = Date.now();
      deps.supervision?.arm();
      active = `${arm.method}-${arm.variant}`;
      const dir = path.join(root, '.local-office', 'cx-' + randomUUID().slice(0, 8));
      fs.mkdirSync(dir);
      const project = path.join(dir, 'source');
      materialize(project, item);
      const before = fixtureSnapshot(project);
      assert.equal(digest(JSON.stringify(before)), plan.fixtureHash);
      verifyWorkspace(project);
      const git = (args) =>
        execFileSync('git', args, { cwd: project, windowsHide: true, stdio: 'pipe' });
      git(['init', '--initial-branch=main']);
      git(['config', '--local', 'core.autocrlf', 'false']);
      git(['add', '.']);
      git([
        '-c',
        'user.name=Local Comparison',
        '-c',
        'user.email=fixture@example.invalid',
        'commit',
        '-m',
        'initial',
      ]);
      const initialCommit = git(['rev-parse', 'HEAD']).toString();
      const initialGitConfig = digest(fs.readFileSync(path.join(project, '.git/config')));
      const checks = new tools.LocalChecks(
        {
          public: {
            executable: process.execPath,
            args: ['--test', 'contract.test.mjs'],
            timeoutMs: 10000,
          },
          acceptance: {
            executable: process.execPath,
            args: [path.join(root, 'scripts/adaptive-acceptance.mjs'), item.id, '.'],
            timeoutMs: 10000,
            acceptance: true,
            criteria: prepared.packet.acceptance,
          },
        },
        path.join(dir, 'logs'),
      );
      const executor = deps.executorFactory
        ? deps.executorFactory({ project, item, arm })
        : new tools.CodexExecutor(path.join(dir, 'receipts'), {
            discover: async () => runtime,
            ...(deps.supervision
              ? {
                  launch: (selectedRuntime, args, env) => {
                    const child = spawn(selectedRuntime.executable, args, {
                      cwd: project,
                      env,
                      windowsHide: true,
                      stdio: 'pipe',
                    });
                    deps.supervision.launched(child);
                    return child;
                  },
                }
              : {}),
          });
      let calls = 0,
        output = '',
        record;
      const guarded = {
        provider: 'codex',
        engine: 'codex-cli',
        diagnose: () => executor.diagnose(),
        execute: async (options) => {
          assert(!ledger.closed && !ledger.paused && !controller.signal.aborted);
          assert.equal(calls, 0);
          assert(ledger.attempts < LIMITS.maxRuns);
          assert.equal(options.model, plan.model);
          assert.equal(options.effort, plan.effort);
          assert.equal(options.allowWrites, true);
          assert.equal(options.officeRole, 'developer');
          assert.equal(
            options.prompt,
            prepared.variants[arm.method === 'office' ? 'standard' : arm.variant].prompt,
          );
          verifyWorkspace(project);
          const selected = prepared.variants[arm.variant];
          assert.equal(
            digest(tools.CODEX_TASK_PREFIX + selected.prompt),
            plan.arms[i].submittedPromptHash,
          );
          calls++;
          ledger.attempts++;
          phase = 'model';
          deps.supervision?.model();
          save();
          record = await executor.execute({
            ...options,
            prompt: selected.prompt,
            contextFingerprint: selected.fingerprint,
            timeoutMs: Math.min(
              LIMITS.perRunMs,
              LIMITS.perArmMs - (Date.now() - startedAt),
              LIMITS.totalMs - (Date.now() - ledger.startedAt),
            ),
            maxReportedTokens: LIMITS.perRunTokens,
            signal: AbortSignal.any([
              controller.signal,
              ...(options.signal ? [options.signal] : []),
            ]),
            onOutput: (text) => {
              output = (output + text).slice(-2048);
              options.onOutput?.(text);
            },
            onState: (state) => {
              deps.supervision?.record(state);
              options.onState?.(state);
            },
          });
          deps.supervision?.endModel();
          const known = [record.inputTokens, record.outputTokens].every(
            (n) => Number.isSafeInteger(n) && n >= 0,
          );
          const tokens = known ? record.inputTokens + record.outputTokens : null;
          report.runs.push({
            ...arm,
            order: i,
            status: record.status,
            reason: record.reasonCode,
            input: record.inputTokens,
            output: record.outputTokens,
            cached: record.cachedInputTokens ?? null,
            durationMs: record.updatedAt - record.startedAt,
            requestedModel: record.requestedModel,
            confirmedModel: record.confirmedModel,
            requestedEffort: record.requestedEffort,
            cliVersion: record.cliVersion ?? null,
            subscriptionVerified: !!record.subscriptionCheckedAt,
            sessionMode: record.sessionMode,
            contextFingerprint: selected.fingerprint,
            submittedPromptHash: plan.arms[i].submittedPromptHash,
            metrics: record.metrics ?? null,
          });
          if (tokens === null) {
            ledger.tokens = null;
            report.inferenceObserved = deps.executorFactory ? false : null;
            pause('usage_unknown');
          } else {
            ledger.tokens += tokens;
            report.inferenceObserved ||= !deps.executorFactory && tokens > 0;
            if (tokens >= LIMITS.perRunTokens || ledger.tokens >= LIMITS.maxTokens)
              pause('token_budget');
          }
          if (!record.subscriptionCheckedAt) pause('subscription_unverified');
          if (record.status !== 'completed') pause('execution_not_completed');
          if (record.sessionMode !== 'new') pause('session_invariant_failed');
          save();
          return record;
        },
      };
      armTimer = setTimeout(
        () => pause('arm_time_budget'),
        Math.max(1, LIMITS.perArmMs - (Date.now() - startedAt)),
      );
      let taskStatus, mechanical;
      phase = 'dispatch';
      if (arm.method === 'direct') {
        const r = await guarded.execute({
          project,
          officeRole: 'developer',
          model: plan.model,
          effort: plan.effort,
          allowWrites: true,
          prompt: prepared.variants[arm.variant].prompt,
        });
        taskStatus = r.status;
        phase = 'checks';
        mechanical = controller.signal.aborted
          ? []
          : await checks.run(prepared.packet.checks, project, controller.signal);
      } else {
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
          maxTokens: LIMITS.perRunTokens,
        });
        await team.plan(project, item.objective, true, {
          context: prepared.packet,
          assessment: item.assessment,
        });
        assert.deepEqual(
          team.snapshot().tasks.map((t) => t.role),
          ['developer'],
        );
        const task = await team.assign(team.snapshot().tasks[0].id);
        assert.equal(task.choice?.model, plan.model);
        assert.equal(task.choice?.effort, plan.effort);
        team.reviewBudget(task.id, LIMITS.perRunTokens, LIMITS.perRunMs, 12000);
        await team.start();
        while (team.snapshot().running) await new Promise((resolve) => setTimeout(resolve, 25));
        const final = team.snapshot().tasks[0];
        taskStatus = final.status;
        mechanical = final.localChecks ?? [];
      }
      phase = 'acceptance';
      const quality = await acceptance(item, project, tools.stopProcess);
      const changes = inspectChanges(before, fixtureSnapshot(project), item.files);
      const gitUnchanged =
        git(['rev-parse', 'HEAD']).toString() === initialCommit &&
        git(['branch', '--show-current']).toString().trim() === 'main' &&
        digest(fs.readFileSync(path.join(project, '.git/config'))) === initialGitConfig;
      const passed =
        !ledger.paused &&
        taskStatus === 'completed' &&
        tools.parseTaskOutcome(output) === 'completed' &&
        calls === 1 &&
        quality.passed &&
        quality.tests.length === 36 &&
        changes.passed &&
        gitUnchanged &&
        mechanical.length === 2 &&
        mechanical.every((c) => c.passed);
      report.arms.push({
        ...arm,
        order: i,
        status: passed ? 'accepted' : 'not-accepted',
        fixtureHash: plan.fixtureHash,
        quality,
        changes,
        gitUnchanged,
        mechanical,
        durationMs: Date.now() - startedAt,
        tokens:
          record?.inputTokens != null && record?.outputTokens != null
            ? record.inputTokens + record.outputTokens
            : null,
      });
      clearTimeout(armTimer);
      await team?.shutdown();
      team = undefined;
      if (!passed) pause('acceptance_failed');
      if (Date.now() - startedAt > LIMITS.perArmMs) pause('arm_time_budget');
      deps.supervision?.endArm();
      save();
    }
    report.status =
      report.arms.length === ARMS.length &&
      report.arms.every((a) => a.status === 'accepted') &&
      !ledger.paused
        ? 'completed-exploratory'
        : 'paused';
  } catch (error) {
    if (phase === 'model' && ledger.attempts > report.runs.length) {
      ledger.tokens = null;
      report.inferenceObserved = deps.executorFactory ? false : null;
    }
    report.failure = {
      phase,
      arm: active,
      code: /^[a-z_]{1,64}$/.test(error.code ?? '') ? error.code : 'pilot_invariant_failed',
    };
    pause(report.failure.code);
    report.status = 'paused';
  } finally {
    clearTimeout(timer);
    clearTimeout(armTimer);
    await team?.shutdown();
    ledger.closed = true;
    report.reason = ledger.reason;
    report.durationMs = Date.now() - ledger.startedAt;
    if (ledger.paused) report.status = 'paused';
    report.skipped = ARMS.slice(ledger.attempts);
    report.observedTokens = ledger.tokens;
    save();
  }
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv.length >= 3 && process.argv.length <= 4);
  const action = process.argv[2];
  const locations = pilotPaths(process.argv[3]);
  if (action === 'prepare') {
    const p = await prepareContextPilot(locations);
    console.log(JSON.stringify({ status: p.status, limits: p.limits, inferenceCalls: 0 }));
  } else if (action === 'launch') {
    assert(locations.attempt);
    const p = JSON.parse(fs.readFileSync(path.join(locations.reports, 'PLAN.json')));
    const a = JSON.parse(fs.readFileSync(path.join(locations.privateDir, 'authorization.json')));
    verifyAuthorization(a, p);
    assert.equal(p.attempt, locations.attempt);
    assert.equal(p.sourceFingerprint, sourceFingerprint());
    assert.equal(p.supervisionRequired, true);
    const owner = launchSupervised(locations);
    console.log(JSON.stringify({ launched: true, supervisorPid: owner.pid, limits: p.limits }));
  } else if (action === 'inspect') {
    const current = await reconcileSupervision(locations.privateDir);
    console.log(
      JSON.stringify({
        status: current.report?.status,
        closed: current.ledger?.closed,
        reason: current.ledger?.reason,
        tokens: current.ledger?.tokens,
        attempts: current.ledger?.attempts,
      }),
    );
  } else if (action === 'execute' || action === 'execute-supervised') {
    const supervision =
      action === 'execute-supervised' ? await attachSupervision(locations.privateDir) : null;
    let r;
    try {
      r = await executeContextPilot({ ...locations, supervision });
    } finally {
      supervision?.close();
    }
    console.log(
      JSON.stringify({
        status: r.status,
        reason: r.reason,
        completedArms: r.arms.length,
        inferenceObserved: r.inferenceObserved,
      }),
    );
    if (r.status !== 'completed-exploratory') process.exitCode = 1;
  } else throw new Error('Acción no reconocida.');
}
