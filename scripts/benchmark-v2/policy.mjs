import { MODEL, hash, compare } from './protocol.mjs';
const fail = (code) => Object.assign(new Error(code), { code });

/** Equal method envelopes; the startup reserve is never an output/token cap. */
export function fairPolicy(now = Date.now) {
  let ledger, report, item, save, current, methodController, timer, removeStageAbort;
  const pause = (reason) => {
    ledger.paused = true;
    ledger.reason ??= reason;
    save();
  };
  const remaining = () => item.limits.maxMethodTokens - current.tokens;
  const gateRun = () => {
    if (ledger.paused || ledger.closed) return ledger.reason ?? 'paused';
    if (!current || current.closed) return 'method_closed';
    if (methodController.signal.aborted || now() >= current.startedAt + item.limits.maxMethodMs)
      return 'method_time_budget';
    if (now() >= ledger.startedAt + item.limits.maxMs) return 'time_budget';
    if (
      ledger.attempts >= item.limits.maxRuns ||
      current.attempts >= item.limits.maxMethodRuns[current.method]
    )
      return 'run_budget';
    if (!Number.isSafeInteger(current.tokens) || !Number.isSafeInteger(ledger.tokens))
      return 'usage_unknown';
    if (
      remaining() < item.limits.minRunReserve ||
      ledger.tokens + item.limits.minRunReserve > item.limits.maxTokens
    )
      return 'token_budget';
    return null;
  };
  const close = () => {
    clearTimeout(timer);
    removeStageAbort?.();
  };
  return {
    executor(base, shared, state, task, persist) {
      ledger = shared;
      report = state;
      item = task;
      save = persist;
      ledger.methods ??= {};
      let catalog;
      return {
        provider: 'codex',
        maxConcurrentReadOnly: 1,
        async diagnose() {
          if (ledger.paused) throw fail(ledger.reason ?? 'paused');
          try {
            const evidence = await base.diagnose();
            const fingerprint = hash(evidence.models);
            if (catalog && catalog !== fingerprint) throw fail('catalog_changed');
            catalog = fingerprint;
            report.catalogFingerprint = fingerprint;
            return evidence;
          } catch (error) {
            pause(/^[a-z_]+$/.test(error.code ?? '') ? error.code : 'subscription_unverified');
            throw error;
          }
        },
        async execute(options) {
          const blocked = gateRun();
          if (blocked) throw fail(blocked);
          if (
            options.model !== MODEL ||
            options.effort !== item.effort ||
            (options.officeRole !== 'developer' && options.allowWrites)
          )
            throw fail('controls_mismatch');
          const attempt = ++ledger.attempts;
          current.attempts++;
          const started = now(),
            method = current.method,
            ceiling = remaining();
          ledger.inFlight = { attempt, method, role: options.officeRole };
          save();
          let result;
          try {
            result = await base.execute({
              ...options,
              parallelReadOnly: false,
              contextFingerprint: options.contextFingerprint ?? hash(options.prompt),
              maxReportedTokens: ceiling,
              timeoutMs: Math.max(
                1,
                Math.min(
                  current.startedAt + item.limits.maxMethodMs - now(),
                  ledger.startedAt + item.limits.maxMs - now(),
                ),
              ),
            });
          } catch (error) {
            const reason = /^[a-z_]+$/.test(error.code ?? '') ? error.code : 'execution_unverified';
            report.runs.push({
              attempt,
              method,
              role: options.officeRole,
              status: 'blocked',
              reasonCode: reason,
              inputTokens: null,
              outputTokens: null,
              cachedInputTokens: null,
              durationMs: now() - started,
            });
            delete ledger.inFlight;
            pause(reason);
            throw error;
          }
          const cached = result.cachedInputTokens;
          report.runs.push({
            attempt,
            method,
            role: options.officeRole,
            status: result.status,
            reasonCode: result.reasonCode,
            requestedModel: result.requestedModel,
            effort: result.requestedEffort,
            confirmedModel: result.confirmedModel,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            cachedInputTokens:
              Number.isSafeInteger(cached) && cached >= 0 && cached <= result.inputTokens
                ? cached
                : null,
            cliVersion: result.cliVersion ?? null,
            subscriptionVerified: result.subscriptionCheckedAt != null,
            sessionMode: result.sessionMode ?? null,
            sessionHash: result.sessionId ? hash(result.sessionId) : null,
            toolCalls: result.toolCalls ?? null,
            promptCharacters: options.prompt.length,
            promptFingerprint: hash(options.prompt),
            durationMs: now() - started,
            reportedCeiling: ceiling,
          });
          delete ledger.inFlight;
          if (
            !Number.isSafeInteger(result.inputTokens) ||
            result.inputTokens < 0 ||
            !Number.isSafeInteger(result.outputTokens) ||
            result.outputTokens < 0
          ) {
            current.usageUnknown = true;
            pause('usage_unknown');
          } else {
            const tokens = result.inputTokens + result.outputTokens;
            ledger.tokens += tokens;
            current.tokens += tokens;
            if (current.tokens >= item.limits.maxMethodTokens) current.exceeded = true;
            if (ledger.tokens >= item.limits.maxTokens) pause('token_budget');
          }
          if (result.status !== 'completed') {
            if (
              ['token_budget', 'time_limit', 'cancelled_by_user'].includes(result.reasonCode) &&
              !current.usageUnknown
            )
              current.exceeded = true;
            else pause(result.reasonCode ?? 'execution_failed');
          }
          save();
          return result;
        },
      };
    },
    gateMethod(method) {
      if (ledger.paused || ledger.closed) return ledger.reason ?? 'paused';
      if (ledger.methods[method]) return 'method_already_attempted';
      if (ledger.attempts >= item.limits.maxRuns) return 'run_budget';
      // Preserve the entire other envelope. A smaller remainder must not handicap it.
      if (item.limits.maxTokens - ledger.tokens < item.limits.maxMethodTokens)
        return 'equal_budget_unavailable';
      if (item.limits.maxMs - (now() - ledger.startedAt) < item.limits.maxMethodMs)
        return 'equal_time_unavailable';
      return null;
    },
    beginMethod(method, stageSignal, start) {
      close();
      current = {
        method,
        attempts: 0,
        tokens: 0,
        startedAt: start,
        closed: false,
        exceeded: false,
      };
      ledger.methods[method] = current;
      methodController = new AbortController();
      const stop = () => methodController.abort(stageSignal.reason);
      stageSignal.addEventListener('abort', stop, { once: true });
      removeStageAbort = () => stageSignal.removeEventListener('abort', stop);
      if (stageSignal.aborted) stop();
      timer = setTimeout(
        () => {
          current.exceeded = true;
          methodController.abort('method_time_budget');
        },
        Math.max(1, start + item.limits.maxMethodMs - now()),
      );
      save();
      return methodController.signal;
    },
    coordinatorSettings() {
      return {
        mode: 'manual',
        claudeEnabled: false,
        maxRuns: item.expectedOfficeRoles.length,
        maxTokens: item.limits.maxMethodTokens,
        maxParallel: 1,
        maxMinutes: Math.ceil(item.limits.maxMethodMs / 60000),
      };
    },
    startupTokenReserve() {
      return item.limits.minRunReserve;
    },
    endMethod(trial) {
      close();
      current.closed = true;
      current.durationMs = now() - current.startedAt;
      current.exceeded ||=
        current.durationMs > item.limits.maxMethodMs ||
        current.tokens >= item.limits.maxMethodTokens;
      trial.budget = {
        tokenLimit: item.limits.maxMethodTokens,
        timeLimitMs: item.limits.maxMethodMs,
        tokens: current.tokens,
        exceeded: current.exceeded,
        usageUnknown: current.usageUnknown === true,
      };
      const ignored = new Set(['method-completed', 'public-tests']);
      const functionalFailed = trial.quality.failedChecks.filter((id) => !ignored.has(id));
      trial.functionalQuality = {
        passed:
          trial.quality.tests.some((test) => !ignored.has(test.id)) &&
          functionalFailed.length === 0,
        failedChecks: functionalFailed,
      };
      trial.completionVerified =
        trial.quality.tests.find((test) => test.id === 'method-completed')?.passed === true;
      if (current.exceeded) {
        trial.status = 'budget-exceeded';
        trial.quality.passed = false;
      }
    },
    finalize(result) {
      result.comparison = result.controlsPassed
        ? compare(result.trials)
        : { verdict: 'controls_unverified', generalImprovementProven: false };
      result.budgetPolicy = 'equal-method-envelopes';
      result.calibrationExcludedFromTrials = true;
      if (result.trials.some((trial) => trial.budget?.exceeded)) {
        result.status = 'paused';
        ledger.paused = true;
        ledger.reason ??= 'method_budget';
      }
      if (Object.values(ledger.methods).some((method) => method.usageUnknown)) {
        result.knownReportedTokens = result.reportedTokens;
        result.reportedTokens = null;
      }
    },
    close,
  };
}
