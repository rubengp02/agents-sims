import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { materialize, snapshot, inspectChanges, acceptance } from './kit.mjs';
import { MODEL, gate, hash, usageTotal, comparePair } from './protocol.mjs';

function safeRecord(record, attempt, durationMs) {
  return {
    attempt,
    role: record.officeRole,
    status: record.status,
    reasonCode: record.reasonCode,
    requestedModel: record.requestedModel,
    effort: record.requestedEffort,
    confirmedModel: record.confirmedModel,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    cachedInputTokens:
      Number.isSafeInteger(record.cachedInputTokens) &&
      record.cachedInputTokens >= 0 &&
      record.cachedInputTokens <= record.inputTokens
        ? record.cachedInputTokens
        : null,
    cliVersion: record.cliVersion ?? null,
    subscriptionVerified: record.subscriptionCheckedAt != null,
    sessionMode: record.sessionMode ?? null,
    sessionHash: record.sessionId ? hash(record.sessionId) : null,
    toolCalls: record.toolCalls ?? null,
    durationMs,
  };
}

/** Same guard for direct and actual TeamCoordinator paths. It never grants a new budget. */
export function budgetExecutor(executor, ledger, report, item, save) {
  const records = [];
  let catalogFingerprint = null;
  const pause = (code) => {
    ledger.paused = true;
    ledger.reason = code;
    save();
  };
  return {
    provider: 'codex',
    maxConcurrentReadOnly: 1,
    records,
    async diagnose() {
      try {
        const evidence = await executor.diagnose(),
          current = hash(evidence.models);
        if (catalogFingerprint && catalogFingerprint !== current)
          throw Object.assign(new Error('catalog'), { code: 'catalog_changed' });
        catalogFingerprint = current;
        report.catalogFingerprint = current;
        return evidence;
      } catch (error) {
        pause(/^[a-z_]+$/.test(error.code ?? '') ? error.code : 'subscription_unverified');
        throw error;
      }
    },
    async execute(options) {
      const blocked = gate(ledger, item.limits);
      if (blocked) throw Object.assign(new Error(blocked), { code: blocked });
      if (
        options.model !== MODEL ||
        options.effort !== item.effort ||
        (options.officeRole !== 'developer' && options.allowWrites)
      )
        throw Object.assign(new Error('controls'), { code: 'controls_mismatch' });
      const attempt = ++ledger.attempts,
        start = Date.now();
      ledger.inFlight = { attempt, role: options.officeRole };
      save();
      let result;
      try {
        result = await executor.execute({
          ...options,
          contextFingerprint: options.contextFingerprint ?? hash(options.prompt),
          parallelReadOnly: false,
          timeoutMs: Math.max(
            1,
            Math.min(item.limits.perRunMs, item.limits.maxMs - (Date.now() - ledger.startedAt)),
          ),
          maxReportedTokens: item.limits.reservePerRun,
        });
      } catch (error) {
        const record = {
          attempt,
          role: options.officeRole,
          status: 'blocked',
          reasonCode: /^[a-z_]+$/.test(error.code ?? '') ? error.code : 'execution_unverified',
          inputTokens: null,
          outputTokens: null,
          cachedInputTokens: null,
          durationMs: Date.now() - start,
        };
        records.push(record);
        report.runs.push(record);
        delete ledger.inFlight;
        pause(record.reasonCode);
        throw error;
      }
      const record = safeRecord(result, attempt, Date.now() - start);
      record.promptCharacters = options.prompt.length;
      record.promptFingerprint = hash(options.prompt);
      records.push(record);
      report.runs.push(record);
      delete ledger.inFlight;
      if (
        !Number.isSafeInteger(result.inputTokens) ||
        result.inputTokens < 0 ||
        !Number.isSafeInteger(result.outputTokens) ||
        result.outputTokens < 0
      )
        pause('usage_unknown');
      else {
        ledger.tokens += result.inputTokens + result.outputTokens;
        if (
          result.inputTokens + result.outputTokens >= item.limits.reservePerRun ||
          ledger.tokens >= item.limits.maxTokens
        )
          pause('token_budget');
      }
      if (result.status !== 'completed') pause(result.reasonCode ?? 'execution_failed');
      save();
      return result;
    },
  };
}

export async function runStage({
  item,
  tools,
  executor,
  workspace,
  ledger,
  signal,
  save = () => {},
  policy,
}) {
  mkdirSync(workspace, { recursive: false });
  const report = {
    caseId: item.id,
    model: MODEL,
    effort: item.effort,
    limits: item.limits,
    order: item.order,
    realInference: executor.realInference === true,
    runs: [],
    trials: [],
    repairRuns: 0,
    status: 'running',
  };
  const persist = () => save(report, ledger);
  const guarded = policy
    ? policy.executor(executor, ledger, report, item, persist)
    : budgetExecutor(executor, ledger, report, item, persist);
  const controller = new AbortController();
  const stop = () => {
    ledger.paused = true;
    ledger.reason = ledger.reason ?? 'cancelled_by_user';
    controller.abort();
    persist();
  };
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  const timer = setTimeout(
    () => {
      ledger.reason = 'time_budget';
      stop();
    },
    Math.max(1, item.limits.maxMs - (Date.now() - ledger.startedAt)),
  );
  try {
    await guarded.diagnose(); // No execution before a fresh catalog/subscription check.
    for (const method of item.order) {
      const blocked = policy ? policy.gateMethod(method) : gate(ledger, item.limits);
      if (blocked) {
        ledger.paused = true;
        ledger.reason = ledger.reason ?? blocked;
        break;
      }
      const totalStart = Date.now(),
        project = join(workspace, `${item.id}-${method}`);
      const methodSignal = policy
        ? policy.beginMethod(method, controller.signal, totalStart)
        : controller.signal;
      materialize(project, item);
      const before = snapshot(project),
        firstRun = report.runs.length;
      const checks = new tools.LocalChecks(
        {
          'public-tests': {
            executable: process.execPath,
            args: ['--test', 'contract.test.mjs'],
            timeoutMs: 10000,
            acceptance: true,
          },
        },
        join(workspace, 'check-logs'),
        project,
      );
      const trial = {
        method,
        initialFilesHash: hash(before),
        setupDurationMs: Date.now() - totalStart,
        status: 'running',
        repairRuns: 0,
        localChecks: [],
      };
      report.trials.push(trial);
      persist();
      const executionStart = Date.now();
      let methodComplete = false;
      try {
        if (method === 'direct') {
          let output = '';
          const result = await guarded.execute({
            project,
            officeRole: 'developer',
            model: MODEL,
            effort: item.effort,
            allowWrites: true,
            signal: methodSignal,
            prompt: `Resuelve el encargo completo. Lee AGENTS.md y los módulos del proyecto. No delegues.\n\n${readFileSync(join(project, 'TASK.md'), 'utf8')}`,
            onOutput: (text) => {
              output = (output + text).slice(-20000);
            },
          });
          methodComplete =
            result.status === 'completed' && tools.parseTaskOutcome(output) === 'completed';
          if (!methodSignal.aborted)
            trial.localChecks = await checks.run(['public-tests'], project, methodSignal);
        } else {
          const team = new tools.TeamCoordinator(
            { codex: guarded, claude: new tools.DisabledExecutor('claude') },
            undefined,
            undefined,
            checks,
            policy?.startupTokenReserve(),
          );
          const pause = () => team.pause(ledger.reason ?? 'time_budget');
          methodSignal.addEventListener('abort', pause, { once: true });
          try {
            team.configure(
              policy
                ? policy.coordinatorSettings()
                : {
                    mode: 'manual',
                    claudeEnabled: false,
                    maxRuns: item.limits.maxRuns,
                    maxTokens: item.limits.maxTokens,
                    maxParallel: 1,
                    maxMinutes: Math.ceil(item.limits.maxMs / 60000),
                  },
            );
            const tasks = team.addScopedWorkflow(
              project,
              {
                objective: item.objective,
                files: [...item.files, 'TASK.md', 'contract.test.mjs'],
                decisions: ['Contrato completo en TASK.md; no modificar pruebas ni instrucciones.'],
                acceptance: item.contract.split('\n').filter(Boolean),
                checks: ['public-tests'],
              },
              item.assessment,
              true,
            );
            if (
              JSON.stringify(tasks.map((task) => task.role)) !==
              JSON.stringify(item.expectedOfficeRoles)
            )
              throw Object.assign(new Error('routing changed'), { code: 'routing_changed' });
            for (const task of tasks) {
              if (methodSignal.aborted) break;
              team.override(task.id, { provider: 'codex', model: MODEL, effort: item.effort });
              const assigned = await team.assign(task.id);
              if (!assigned.choice)
                throw Object.assign(new Error('assignment'), {
                  code: assigned.reasonCode ?? 'assignment_failed',
                });
              team.approve(task.id);
            }
            if (!methodSignal.aborted) await team.start();
            while (
              team.snapshot().running ||
              team.snapshot().tasks.some((task) => ['checking', 'running'].includes(task.status))
            )
              await new Promise((resolve) => setTimeout(resolve, 20));
            const state = team.snapshot();
            trial.tasks = state.tasks.map((task) => ({
              role: task.role,
              status: task.status,
              reasonCode: task.reasonCode,
            }));
            trial.localChecks = state.tasks.flatMap((task) => task.localChecks ?? []);
            methodComplete =
              state.tasks.length === tasks.length &&
              state.tasks.every((task) => task.status === 'completed');
          } finally {
            methodSignal.removeEventListener('abort', pause);
            await team.shutdown();
          }
        }
      } catch (error) {
        trial.reasonCode = /^[a-z_]+$/.test(error.code ?? '') ? error.code : 'method_failed';
      }
      trial.executionAndLocalChecksMs = Date.now() - executionStart;
      const oracle = await acceptance(item, project, tools.stopProcess, controller.signal);
      let changes;
      try {
        changes = inspectChanges(before, snapshot(project), item.files);
      } catch {
        changes = { passed: false, changed: [], unexpected: ['unreadable-workspace'] };
      }
      trial.changes = changes;
      trial.quality = {
        tests: [
          ...oracle.tests,
          { id: 'file-scope', passed: changes.passed },
          { id: 'method-completed', passed: methodComplete },
          {
            id: 'public-tests',
            passed:
              trial.localChecks.length > 0 && trial.localChecks.every((check) => check.passed),
          },
        ],
        passed: false,
      };
      trial.quality.failedChecks = [
        ...new Set([
          ...oracle.failedChecks,
          ...trial.quality.tests.filter((test) => !test.passed).map((test) => test.id),
        ]),
      ];
      trial.quality.passed = oracle.passed && trial.quality.failedChecks.length === 0;
      trial.acceptanceDurationMs = oracle.durationMs;
      trial.totalDurationMs = Date.now() - totalStart;
      const records = report.runs.slice(firstRun);
      for (const key of ['inputTokens', 'outputTokens', 'cachedInputTokens'])
        trial[key] = usageTotal(records, key);
      trial.nonCachedInputTokens =
        trial.inputTokens !== null && trial.cachedInputTokens !== null
          ? trial.inputTokens - trial.cachedInputTokens
          : null;
      trial.cliAttempts = records.length;
      trial.status = trial.quality.passed ? 'accepted' : 'failed';
      policy?.endMethod(trial);
      persist();
      if (ledger.paused) break;
    }
    report.comparison = comparePair(report.trials);
    const sessions = report.runs.map((run) => run.sessionHash);
    report.controlsPassed =
      report.trials.length === 2 &&
      report.trials[0].initialFilesHash === report.trials[1].initialFilesHash &&
      report.runs.every(
        (run) =>
          run.requestedModel === MODEL &&
          run.effort === item.effort &&
          run.sessionMode === 'new' &&
          run.subscriptionVerified &&
          typeof run.cliVersion === 'string' &&
          run.cliVersion.length > 0 &&
          (run.confirmedModel === null || run.confirmedModel === MODEL),
      ) &&
      sessions.every(Boolean) &&
      new Set(sessions).size === sessions.length &&
      new Set(report.runs.map((run) => run.cliVersion)).size === 1;
    if (!report.controlsPassed)
      report.comparison = { verdict: 'controls_unverified', generalImprovementProven: false };
    report.status = ledger.paused
      ? 'paused'
      : report.trials.length === 2
        ? 'completed'
        : 'incomplete';
    report.totalDurationMs = Date.now() - ledger.startedAt;
    report.reportedTokens = ledger.tokens;
    report.cache = {
      cachedInputTokens: usageTotal(report.runs, 'cachedInputTokens'),
      distinctSessionCount: new Set(sessions.filter(Boolean)).size,
      sessionReuse: false,
      coldCacheControlled: false,
    };
    policy?.finalize(report);
  } catch (error) {
    report.status = 'blocked';
    report.reasonCode = /^[a-z_]+$/.test(error.code ?? '') ? error.code : 'stage_failed';
    report.comparison = { verdict: 'incomplete', generalImprovementProven: false };
  } finally {
    policy?.close();
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
    ledger.paused = true;
    ledger.reason =
      ledger.reason ?? (ledger.attempts >= item.limits.maxRuns ? 'run_budget' : 'stage_closed');
    ledger.closed = true;
    persist();
  }
  return report;
}

/** Exercises the real coordinator with a deterministic local executor, never a model. */
export function referenceExecutor(item) {
  return {
    provider: 'codex',
    realInference: false,
    diagnose: async () => ({
      checkedAt: Date.now(),
      plan: 'plus',
      quota: [],
      models: [{ id: MODEL, efforts: ['low', 'medium', 'high'] }],
    }),
    async execute(options) {
      const startedAt = Date.now(),
        record = {
          version: 1,
          id: randomUUID(),
          provider: 'codex',
          billing: 'subscription-only',
          officeRole: options.officeRole,
          project: options.project,
          status: 'running',
          reasonCode: null,
          requestedModel: options.model,
          requestedEffort: options.effort,
          confirmedModel: null,
          sessionId: randomUUID(),
          sessionMode: 'new',
          cliVersion: 'local-fixture',
          subscriptionCheckedAt: Date.now(),
          inputTokens: 1000,
          outputTokens: 20,
          cachedInputTokens: 500,
          startedAt,
          updatedAt: startedAt,
        };
      options.onState?.(record);
      if (options.allowWrites) {
        const { writeFileSync } = await import('node:fs');
        for (const [file, source] of Object.entries(item.reference))
          writeFileSync(join(options.project, file), source);
      }
      options.onOutput?.('OFFICE_RESULT {"status":"completed"}');
      record.status = 'completed';
      record.updatedAt = Date.now();
      options.onState?.(record);
      return record;
    },
  };
}
