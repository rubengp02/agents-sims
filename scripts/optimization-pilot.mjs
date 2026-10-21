/** Explicit, single-use subscription pilot. Never part of tests, packaging or CI. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadTools, root, sourceFingerprint } from './optimization-tools.mjs';
import { variants } from './optimization-study.mjs';
import { PILOT_LIMITS, pilotGate, acceptAnalysis, compareMeasured } from './pilot-policy.mjs';

if (process.argv.slice(2).join(' ') !== '--run-authorized-pilot') {
  console.log('Sin inferencia. Piloto explícito de un solo uso:', JSON.stringify(PILOT_LIMITS));
} else {
  const validation = JSON.parse(
    readFileSync(join(root, 'reports/contexto/validacion-local.json'), 'utf8'),
  ).attempts.at(-1);
  const study = JSON.parse(
    readFileSync(join(root, 'reports/contexto/optimizacion-local.json'), 'utf8'),
  );
  if (
    !validation?.passed ||
    validation.sourceFingerprint !== sourceFingerprint() ||
    !study.specialistComparison.classifications.every((item) => item.passed)
  )
    throw new Error('Validación local pendiente o código cambiado. No se inicia inferencia.');
  const { CodexExecutor, prepareTaskContext } = await loadTools();
  const privateDir = join(root, '.local-office/optimization');
  const ledgerFile = join(privateDir, 'pilot-ledger.json');
  const reportFile = join(root, 'reports/contexto/piloto-real.json');
  const ledger = {
    startedAt: Date.now(),
    attempts: 0,
    tokens: 0,
    paused: false,
    limits: PILOT_LIMITS,
    state: 'prepared',
  };
  // Exclusive create: rerunning never grants a new budget, even after a crash.
  writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2), { flag: 'wx', mode: 0o600 });
  const report = {
    type: 'single-pair-context-only',
    limits: PILOT_LIMITS,
    sourceFingerprint: validation.sourceFingerprint,
    controls: study.contextComparison.controls,
    order: ['history', 'specific'],
    orderAlternated: false,
    coldCacheControlled: false,
    cacheNote: 'Cache is observed, not forced cold/warm; order may influence it.',
    runs: [],
    comparison: null,
    stoppedReason: null,
    status: 'prepared',
  };
  const executor = new CodexExecutor(join(root, '.local-office/executions'));
  const controller = new AbortController();
  const stop = () => {
    ledger.paused = true;
    report.stoppedReason = 'cancelled_by_user';
    controller.abort();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  const timer = setTimeout(() => {
    ledger.paused = true;
    report.stoppedReason = 'time_budget';
    controller.abort();
  }, PILOT_LIMITS.maxMs);
  const save = () => {
    writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2) + '\n', { mode: 0o600 });
    writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
  };
  save();
  try {
    for (const variant of variants(prepareTaskContext)) {
      const gate = pilotGate(ledger);
      if (gate) {
        report.stoppedReason = gate;
        ledger.paused = true;
        break;
      }
      ledger.attempts++;
      const trial = {
        variant: variant.id,
        attempt: ledger.attempts,
        status: 'checking',
        contextCharacters: variant.characters,
        contextFingerprint: variant.fingerprint,
        defects: null,
        repairs: 0,
      };
      report.runs.push(trial);
      save();
      const started = Date.now();
      try {
        const evidence = await executor.diagnose();
        trial.subscriptionVerifiedBeforeRun = true;
        trial.catalog = evidence.models;
        const project = join(privateDir, `trial-${variant.id}`);
        mkdirSync(project, { recursive: false });
        const source =
          'export function clamp(value,min,max) { return Math.min(min, Math.max(max,value)); }\n';
        writeFileSync(join(project, 'clamp.mjs'), source);
        const initialHash = createHash('sha256').update(source).digest('hex');
        let output = '';
        const run = await executor.execute({
          project,
          prompt: variant.prompt,
          contextFingerprint: variant.fingerprint,
          officeRole: 'developer',
          model: 'gpt-6.1-sol',
          effort: 'low',
          allowWrites: false,
          timeoutMs: Math.min(
            PILOT_LIMITS.perRunMs,
            PILOT_LIMITS.maxMs - (Date.now() - ledger.startedAt),
          ),
          maxReportedTokens: PILOT_LIMITS.reservePerRun,
          signal: controller.signal,
          onOutput: (text) => {
            output = (output + text).slice(0, 20000);
          },
        });
        const unchanged =
          readdirSync(project).join() === 'clamp.mjs' &&
          readFileSync(join(project, 'clamp.mjs'), 'utf8') === source;
        trial.quality = acceptAnalysis(output, unchanged);
        trial.quality.tests.push({ id: 'no-tools', passed: run.toolCalls === 0 });
        trial.quality.passed = trial.quality.tests.every((test) => test.passed);
        trial.quality.defects = trial.quality.tests.filter((test) => !test.passed).length;
        Object.assign(trial, {
          status: run.status,
          reasonCode: run.reasonCode,
          defects: trial.quality.defects,
          durationMs: Date.now() - started,
          cliDurationMs: run.updatedAt - run.startedAt,
          inputTokens: run.inputTokens,
          outputTokens: run.outputTokens,
          cachedInputTokens: run.cachedInputTokens ?? null,
          nonCachedInputTokens:
            run.inputTokens !== null && run.cachedInputTokens != null
              ? run.inputTokens - run.cachedInputTokens
              : null,
          requestedModel: run.requestedModel,
          confirmedModel: run.confirmedModel,
          effort: run.requestedEffort,
          cliVersion: run.cliVersion ?? null,
          sessionMode: run.sessionMode,
          sessionHash: run.sessionId
            ? createHash('sha256').update(run.sessionId).digest('hex')
            : null,
          subscriptionVerifiedByExecutor: run.subscriptionCheckedAt != null,
          initialFilesHash: initialHash,
          toolCalls: run.toolCalls,
        });
        if (run.inputTokens === null || run.outputTokens === null) {
          ledger.paused = true;
          report.stoppedReason = 'usage_unknown';
        } else ledger.tokens += run.inputTokens + run.outputTokens;
        if (run.status !== 'completed' || !trial.quality.passed) {
          ledger.paused = true;
          report.stoppedReason = run.reasonCode ?? 'quality_failed';
        }
        if (ledger.tokens >= PILOT_LIMITS.maxTokens) {
          ledger.paused = true;
          report.stoppedReason = 'token_budget';
        }
      } catch (error) {
        trial.status = 'blocked';
        trial.reasonCode = /^[a-z_]+$/.test(error.code ?? '') ? error.code : 'pilot_unverified';
        trial.durationMs = Date.now() - started;
        ledger.paused = true;
        report.stoppedReason = trial.reasonCode;
      }
      save();
      console.log(
        `${trial.variant}: ${trial.status}, calidad ${trial.quality?.passed ?? 'desconocida'}, tokens ${trial.inputTokens ?? '?'} + ${trial.outputTokens ?? '?'}`,
      );
      if (ledger.paused) break;
    }
    report.comparison = compareMeasured(report.runs[0], report.runs[1]);
    report.status = ledger.paused
      ? 'paused'
      : report.runs.length === 2
        ? 'completed'
        : 'incomplete';
    ledger.state = report.status;
    if (ledger.attempts >= PILOT_LIMITS.maxRuns) {
      ledger.paused = true;
      ledger.pauseReason = 'run_budget';
      report.budgetClosed = 'run_budget';
    }
    report.totalReportedTokens = ledger.tokens;
    report.totalDurationMs = Date.now() - ledger.startedAt;
    report.distinctSessions =
      report.runs.length === 2 &&
      report.runs.every((run) => run.sessionHash) &&
      report.runs[0].sessionHash !== report.runs[1].sessionHash;
    if (report.status !== 'completed') process.exitCode = 2;
  } finally {
    clearTimeout(timer);
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    save();
  }
}
