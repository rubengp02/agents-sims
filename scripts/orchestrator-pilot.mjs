import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES } from './benchmark/cases.mjs';
import { materialize, inspectChanges, acceptance } from './benchmark/kit.mjs';
import { loadTools, root, sourceFingerprint } from './optimization-tools.mjs';

const reuseDirect = process.argv[4];
if (reuseDirect !== undefined && !/^[a-z][a-z0-9-]{0,63}$/.test(reuseDirect))
  throw new Error('Identificador de referencia inválido.');
export const LIMITS = Object.freeze({
  maxRuns: reuseDirect ? 3 : 4,
  maxTokens: reuseDirect ? 200000 : 400000,
  perMethodTokens: 200000,
  perMethodMs: 240000,
  totalMs: reuseDirect ? 240000 : 480000,
  perRunMs: 180000,
  minReserve: 20000,
});
export const cases = CASES.map((item) => ({
  ...item,
  contract:
    item.contract +
    (item.id === 'medium'
      ? '\nPrecisión: si quantity o discountBps son de tipo number pero no enteros (incluidos NaN e infinitos), lanza RangeError. Si su tipo no es number, lanza TypeError.'
      : item.id === 'hard'
        ? '\nPrecisión: también rechaza con TypeError un id cuyo trim() sea vacío. No normalices los ids válidos.'
        : ''),
}));
// A newly authorized attempt gets separate evidence; existing ledgers remain one-shot.
const attempt = process.argv[3];
if (attempt !== undefined && !/^[a-z][a-z0-9-]{0,63}$/.test(attempt))
  throw new Error('Identificador de ensayo inválido.');
const local = path.join(root, '.local-office/orchestrator-pilot', ...(attempt ? [attempt] : []));
const reports = path.join(root, 'reports/agent-orchestrator', ...(attempt ? [attempt] : []));
const write = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n', { mode: 0o600 });
};
const fingerprint = () =>
  createHash('sha256')
    .update(sourceFingerprint())
    .update(fs.readFileSync(path.join(root, 'integrations/agent-orchestrator/main.go')))
    .update(fs.readFileSync(path.join(root, 'integrations/agent-orchestrator/office_driver.go')))
    .digest('hex');
function directReference() {
  if (!reuseDirect) return null;
  const file = path.join(root, 'reports/agent-orchestrator', reuseDirect, 'PILOTO_REAL.json');
  const bytes = fs.readFileSync(file);
  const report = JSON.parse(bytes);
  const method = report.methods.find((m) => m.method === 'direct');
  const run = report.runs.find((r) => r.method === 'direct');
  if (
    report.model !== 'gpt-6.1-sol' ||
    report.effort !== 'medium' ||
    !report.realInference ||
    method?.status !== 'accepted' ||
    !method.quality.passed ||
    !method.changes.passed ||
    !method.mechanical.every((c) => c.passed) ||
    run?.status !== 'completed' ||
    !run.subscriptionVerified
  )
    throw new Error('La referencia directa no cumple la aceptación.');
  return {
    attempt: reuseDirect,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    method,
    run,
  };
}
function snap(dir) {
  const out = {};
  const visit = (relative = '') => {
    for (const name of fs.readdirSync(path.join(dir, relative)).sort()) {
      if (name === '.git') continue;
      const file = path.join(relative, name),
        stat = fs.lstatSync(path.join(dir, file));
      if (stat.isSymbolicLink()) throw new Error('symlink not accepted');
      if (stat.isDirectory()) visit(file);
      else
        out[file.replaceAll('\\', '/')] = createHash('sha256')
          .update(fs.readFileSync(path.join(dir, file)))
          .digest('hex');
    }
  };
  visit();
  return out;
}
export async function prepare() {
  if (fs.existsSync(path.join(local, 'ledger.json')))
    throw new Error(
      'El piloto ya tiene un registro cerrado o en curso. No se reemplazan su preparación ni su presupuesto.',
    );
  const tools = await loadTools();
  const base = path.join(local, 'preflight-' + randomUUID());
  fs.mkdirSync(base, { recursive: true });
  const checks = [];
  for (const item of cases) {
    const initial = path.join(base, item.id + '-initial'),
      reference = path.join(base, item.id + '-reference');
    materialize(initial, item);
    materialize(reference, item, true);
    const a = await acceptance(item, initial, tools.stopProcess),
      b = await acceptance(item, reference, tools.stopProcess);
    if (a.passed || !b.passed) throw new Error('Oráculo incorrecto: ' + item.id);
    checks.push({
      caseId: item.id,
      rejectsInitial: !a.passed,
      acceptsReference: b.passed,
      testCount: b.tests.length,
    });
  }
  const value = {
    protocol: 'ao-integration-pilot-v1',
    attempt: attempt ?? 'original',
    directReference: directReference(),
    sourceFingerprint: fingerprint(),
    limits: LIMITS,
    realCase: 'medium',
    model: 'gpt-6.1-sol',
    effort: 'medium',
    checks,
    inferenceCalls: 0,
    preparedAt: new Date().toISOString(),
  };
  write(path.join(reports, 'PREPARACION.json'), value);
  return value;
}
export async function execute() {
  const preparation = JSON.parse(fs.readFileSync(path.join(reports, 'PREPARACION.json'), 'utf8'));
  if (
    preparation.sourceFingerprint !== fingerprint() ||
    JSON.stringify(preparation.directReference) !== JSON.stringify(directReference()) ||
    JSON.stringify(preparation.limits) !== JSON.stringify(LIMITS)
  )
    throw new Error('Preparación desactualizada.');
  fs.mkdirSync(local, { recursive: true });
  const ledgerFile = path.join(local, 'ledger.json');
  // One-shot allocation. Preparing or fixing source never resets a real attempt.
  const ledger = {
    startedAt: Date.now(),
    runs: 0,
    tokens: 0,
    paused: false,
    reason: null,
    closed: false,
  };
  fs.writeFileSync(ledgerFile, JSON.stringify(ledger), { flag: 'wx', mode: 0o600 });
  const item = cases.find((c) => c.id === 'medium'),
    tools = await loadTools();
  const runRoot = path.join(local, 'run-' + randomUUID());
  fs.mkdirSync(runRoot);
  const report = {
    protocol: preparation.protocol,
    attempt: preparation.attempt,
    limits: LIMITS,
    sourceFingerprint: preparation.sourceFingerprint,
    model: preparation.model,
    effort: preparation.effort,
    realInference: true,
    directReference: preparation.directReference,
    runs: [],
    methods: [],
    repairs: 0,
    status: 'running',
    reason: null,
  };
  const save = () => {
    write(ledgerFile, ledger);
    write(path.join(reports, 'PILOTO_REAL.json'), report);
  };
  let methodTokens = 0,
    methodStart = 0,
    methodRuns = 0,
    methodName = '';
  const guarded = (engine) => ({
    provider: 'codex',
    maxConcurrentReadOnly: 1,
    diagnose: () => engine.diagnose(),
    async execute(options) {
      if (
        ledger.paused ||
        ledger.closed ||
        ledger.runs >= LIMITS.maxRuns ||
        methodRuns >= (methodName === 'direct' ? 1 : 3) ||
        ledger.tokens + LIMITS.minReserve > LIMITS.maxTokens ||
        methodTokens + LIMITS.minReserve > LIMITS.perMethodTokens ||
        Date.now() - ledger.startedAt >= LIMITS.totalMs ||
        Date.now() - methodStart >= LIMITS.perMethodMs
      )
        throw new Error('Límite alcanzado; no se reinicia.');
      ledger.runs++;
      methodRuns++;
      save();
      const at = Date.now();
      let record;
      try {
        record = await engine.execute({
          ...options,
          model: preparation.model,
          effort: preparation.effort,
          parallelReadOnly: false,
          timeoutMs: Math.max(
            1,
            Math.min(
              LIMITS.perRunMs,
              LIMITS.perMethodMs - (Date.now() - methodStart),
              LIMITS.totalMs - (Date.now() - ledger.startedAt),
            ),
          ),
          maxReportedTokens: Math.min(
            LIMITS.perMethodTokens - methodTokens,
            LIMITS.maxTokens - ledger.tokens,
          ),
        });
      } catch (error) {
        ledger.paused = true;
        ledger.reason = error.code ?? 'execution_failed';
        report.runs.push({
          method: methodName,
          role: options.officeRole,
          status: 'blocked',
          reason: ledger.reason,
          durationMs: Date.now() - at,
          inputTokens: null,
          outputTokens: null,
          cachedInputTokens: null,
        });
        save();
        throw error;
      }
      const total =
        record.inputTokens === null || record.outputTokens === null
          ? null
          : record.inputTokens + record.outputTokens;
      report.runs.push({
        method: methodName,
        role: options.officeRole,
        status: record.status,
        reason: record.reasonCode,
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens,
        cachedInputTokens: record.cachedInputTokens,
        durationMs: Date.now() - at,
        sessionMode: record.sessionMode,
        subscriptionVerified: !!record.subscriptionCheckedAt,
        requestedModel: record.requestedModel,
        confirmedModel: record.confirmedModel,
      });
      if (total === null) {
        ledger.paused = true;
        ledger.reason = record.reasonCode ?? 'usage_unknown';
      } else {
        ledger.tokens += total;
        methodTokens += total;
      }
      if (
        record.status !== 'completed' ||
        methodTokens > LIMITS.perMethodTokens ||
        ledger.tokens > LIMITS.maxTokens
      ) {
        ledger.paused = true;
        ledger.reason ??= record.reasonCode ?? 'execution_failed';
      }
      save();
      return record;
    },
  });
  try {
    for (const method of reuseDirect ? ['office'] : ['direct', 'office']) {
      if (ledger.paused) break;
      methodName = method;
      methodTokens = 0;
      methodRuns = 0;
      methodStart = Date.now();
      const project = path.join(runRoot, method);
      materialize(project, item);
      const before = snap(project);
      const git = (args) =>
        execFileSync('git', args, { cwd: project, windowsHide: true, stdio: 'ignore' });
      git(['init', '--initial-branch=main']);
      // Keep fixture bytes identical when AO checks out a separate worktree.
      // This affects only this disposable benchmark repository, never user config.
      git(['config', '--local', 'core.autocrlf', 'false']);
      git(['add', '.']);
      git([
        '-c',
        'user.name=Local Pilot',
        '-c',
        'user.email=fixture@example.invalid',
        'commit',
        '-m',
        'Initial contract',
      ]);
      const checks = new tools.LocalChecks(
        {
          'public-tests': {
            executable: process.execPath,
            args: ['--test', 'contract.test.mjs'],
            timeoutMs: 10000,
            acceptance: true,
          },
        },
        path.join(runRoot, 'check-logs'),
      );
      const engine =
        method === 'direct'
          ? new tools.CodexExecutor(path.join(local, 'receipts'))
          : new tools.OrchestratorExecutor(root, path.join(local, 'receipts'));
      const executor = guarded(engine);
      let target = project,
        completed = false;
      let tasks = [];
      const row = {
        method,
        initialHash: createHash('sha256').update(JSON.stringify(before)).digest('hex'),
        status: 'running',
      };
      report.methods.push(row);
      save();
      if (
        preparation.directReference &&
        row.initialHash !== preparation.directReference.method.initialHash
      )
        throw new Error('La referencia y la oficina no parten de los mismos archivos.');
      if (method === 'direct') {
        let output = '';
        const record = await executor.execute({
          project,
          officeRole: 'developer',
          allowWrites: true,
          prompt:
            'Resuelve el encargo completo. Lee AGENTS.md y TASK.md; no delegues.\n' +
            fs.readFileSync(path.join(project, 'TASK.md'), 'utf8') +
            '\nTermina con OFFICE_RESULT {"status":"completed"} solo si has completado el encargo.',
          onOutput: (s) => (output = (output + s).slice(-20000)),
        });
        completed = record.status === 'completed' && tools.parseTaskOutcome(output) === 'completed';
        fs.writeFileSync(path.join(runRoot, 'direct-final.txt'), output, { mode: 0o600 });
      } else {
        const team = new tools.TeamCoordinator(
          { codex: executor, claude: new tools.DisabledExecutor('claude') },
          undefined,
          undefined,
          checks,
          LIMITS.minReserve,
        );
        team.configure({
          mode: 'manual',
          claudeEnabled: false,
          maxRuns: 3,
          maxParallel: 1,
          maxMinutes: 4,
          maxTokens: LIMITS.perMethodTokens,
        });
        tasks = team.addScopedWorkflow(
          project,
          {
            objective: item.objective,
            files: [...item.files, 'TASK.md', 'contract.test.mjs'],
            decisions: ['Contrato completo en TASK.md. No cambiar instrucciones ni pruebas.'],
            acceptance: item.contract.split('\n').filter(Boolean),
            checks: ['public-tests'],
          },
          item.assessment,
          true,
        );
        for (const task of tasks) {
          team.override(task.id, {
            provider: 'codex',
            model: preparation.model,
            effort: preparation.effort,
          });
          await team.assign(task.id);
          team.approve(task.id);
        }
        await team.start();
        while (team.snapshot().running) await new Promise((r) => setTimeout(r, 100));
        tasks = team.snapshot().tasks;
        completed = tasks.every((t) => t.status === 'completed');
        target =
          tasks.find((t) => t.executionProject && t.role === 'developer')?.executionProject ??
          project;
        write(path.join(runRoot, 'office-tasks.json'), tasks);
        await team.shutdown();
      }
      const quality = await acceptance(item, target, tools.stopProcess),
        changes = inspectChanges(before, snap(target), item.files);
      const mechanical = await checks.run(['public-tests'], target, new AbortController().signal);
      Object.assign(row, {
        status:
          completed && quality.passed && changes.passed && mechanical.every((c) => c.passed)
            ? 'accepted'
            : 'not-accepted',
        quality,
        changes,
        mechanical,
        tokens: methodTokens,
        durationMs: Date.now() - methodStart,
        roles: tasks.map((t) => ({ role: t.role, status: t.status, reason: t.reasonCode })),
      });
      save();
    }
    report.status = ledger.paused ? 'paused' : 'completed';
    report.reason = ledger.reason;
  } catch (error) {
    report.status = 'paused';
    report.reason = error.code ?? 'execution_failed';
    ledger.paused = true;
    ledger.reason = report.reason;
  } finally {
    ledger.closed = true;
    report.totalTokens = ledger.tokens;
    report.durationMs = Date.now() - ledger.startedAt;
    save();
  }
  console.log(JSON.stringify(report, null, 2));
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const action = process.argv[2] ?? 'prepare';
  if (action === 'prepare') console.log(JSON.stringify(await prepare(), null, 2));
  else if (action === 'execute') await execute();
  else throw new Error('Acción desconocida.');
}
