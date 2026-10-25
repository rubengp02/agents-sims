/** Offline preparation by default. --real explicitly spends included Codex quota. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { stopProcess } from '../server/src/execution/cliProcess.js';
import { CodexAppServerExecutor } from '../server/src/execution/codexAppServerExecutor.js';
import { ConversationLibrary } from '../server/src/execution/conversationLibrary.js';
import { DisabledExecutor } from '../server/src/execution/optionalExecutors.js';
import { TeamCoordinator } from '../server/src/execution/teamCoordinator.js';
import { ExecutionBlocked, type OfficialExecutor } from '../server/src/execution/types.js';
import { officeApprovalHandler } from '../server/src/tools/appServerApprovals.js';
import { OfficeServices } from '../server/src/tools/officeServices.js';
import { CASES, fixtureFiles } from './benchmark/cases.mjs';
import { iterativeSummary } from './benchmark/iterativeSummary.mjs';
import { acceptance, inspectChanges, runCommand, snapshot } from './benchmark/kit.mjs';

const plan = {
  version: 'iterative-office-v1',
  caseId: 'medium',
  model: 'gpt-6.1-sol',
  effort: 'medium',
  order: ['direct', 'office'],
  maxTokensPerMethod: 600000,
  maxMsPerMethod: 480000,
  maxTurnsPerMethod: 6,
  minStartReserve: 50000,
  maxUsedPercentAtStart: 80,
  samples: 1,
  assumptions: [
    'same initial files and contract',
    'same model and effort for every role',
    'same local tool bridge and writer scope',
    'fresh objective per method; Chief session retained within office',
    'external acceptance, no repairs by the verifier',
    'cache observed, never reset',
    'all coordination, checks and review included in elapsed time',
    'no API billing or extra credits',
  ],
};
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let recordFailure: ((error: unknown) => Promise<void>) | undefined;
const choice = { provider: 'codex' as const, model: plan.model, effort: plan.effort };
class PinnedTeam extends TeamCoordinator {
  override async assign(id: string, prompt?: string) {
    this.override(id, choice);
    return super.assign(id, prompt);
  }
}
async function main() {
  const real = process.argv.includes('--real');
  const simulated = process.argv.includes('--simulate');
  if (
    (real && simulated) ||
    process.argv.slice(2).some((arg) => !['--real', '--simulate'].includes(arg))
  )
    throw new Error('Use no arguments for preparation, --simulate, or --real.');
  const id = randomUUID(),
    proof = resolve('.local-office/iterative-benchmark', id);
  const work = join(homedir(), 'CodexOfficeWorkspaces', 'iterative-benchmark', id);
  await mkdir(proof, { recursive: true });
  await mkdir(work, { recursive: true });
  const item = CASES.find((c) => c.id === plan.caseId)!;
  const files = (reference = false) => ({
    ...fixtureFiles(item, reference),
    'AGENTS.md':
      '# Proyecto de comparación aislado\nSolo modifica los archivos permitidos en TASK.md. No cambies pruebas, instrucciones ni configuración. No añadas dependencias, red, commits, ramas ni archivos nuevos. No inicies CLIs de IA ni subagentes nativos. Las asignaciones del Jefe mediante OFFICE_DECISION pertenecen al modo oficina autorizado. Ejecuta npm test. Termina con OFFICE_RESULT {"status":"completed"}, o blocked/failed si corresponde.\n',
  });
  async function materialize(name: string, reference = false) {
    const project = join(work, name);
    await mkdir(project);
    for (const [file, content] of Object.entries(files(reference)))
      await writeFile(join(project, file), content as string);
    return project;
  }
  const initial = await materialize('initial'),
    reference = await materialize('reference', true);
  const bad = await acceptance(item, initial, stopProcess),
    good = await acceptance(item, reference, stopProcess);
  assert.equal(bad.passed, false);
  assert.equal(good.passed, true);
  const report: any = {
    plan,
    protocolFingerprint: hash({ plan, files: files() }),
    realInference: real,
    simulation: simulated,
    sourceRevision: process.env.OFFICE_BENCHMARK_REVISION ?? null,
    runtimeFingerprint: hash(
      await Promise.all(
        [
          'scripts/iterative-benchmark.ts',
          'scripts/benchmark/iterativeSummary.mjs',
          'scripts/benchmark/acceptance-worker.mjs',
          'scripts/benchmark/cases.mjs',
          'scripts/benchmark/kit.mjs',
          'server/src/execution/codexAppServerExecutor.ts',
          'server/src/execution/codexAppServerConfig.ts',
          'server/src/execution/localFileApprovals.ts',
          'server/src/execution/teamCoordinator.ts',
        ].map(async (file) => [file, hash(await readFile(file, 'utf8'))]),
      ),
    ),
    nodeVersion: process.version,
    preparation: {
      initialRejected: !bad.passed,
      referenceAccepted: good.passed,
      checks: good.tests.length,
    },
    trials: [],
    generalImprovementProven: false,
    status: real ? 'running' : 'prepared',
    limitations: [
      'One exploratory pair in fixed order; no statistical or general superiority claim.',
      'Reported tokens include cached context and are not a subscription price.',
      'Provider usage updates can overshoot an observation threshold.',
    ],
  };
  const save = () => writeFile(join(proof, 'report.json'), JSON.stringify(report, null, 2));
  recordFailure = async (error) => {
    report.status = 'blocked';
    report.reasonCode = error instanceof ExecutionBlocked ? error.code : 'benchmark_failed';
    await save();
  };
  await save();
  console.log(
    JSON.stringify({
      phase: 'prepared',
      proof,
      protocolFingerprint: report.protocolFingerprint,
      ...report.preparation,
    }),
  );
  if (!real && !simulated) return;
  let totalTurns = 0;
  for (const method of plan.order) {
    const project = await materialize(method),
      before = snapshot(project);
    const services = new OfficeServices(join(proof, method, 'tools'), resolve('.'));
    await services.initialize();
    let chiefTurns = 0;
    const chiefSession = randomUUID();
    const fake: OfficialExecutor = {
      provider: 'codex',
      engine: 'codex-app-server',
      executionEvidence: 'simulated',
      async diagnose() {
        return {
          checkedAt: Date.now(),
          plan: 'plus',
          quota: [{ id: 'simulated', usedPercent: 20, resetsAt: 4000000000 }],
          models: [{ id: plan.model, efforts: [plan.effort] }],
        };
      },
      async execute(options) {
        await sleep(20);
        const role = options.officeRole;
        let output = 'OFFICE_RESULT {"status":"completed"}';
        if (role === 'chief') {
          chiefTurns++;
          const decision =
            chiefTurns === 1
              ? {
                  action: 'assign',
                  role: 'developer',
                  title: 'Implementar',
                  task: 'Cumple TASK.md sin modificar otros archivos.',
                  message: 'Programación simulada.',
                }
              : chiefTurns === 2
                ? {
                    action: 'assign',
                    role: 'tester',
                    title: 'Revisar',
                    task: 'Revisión independiente sin editar.',
                    message: 'Revisión simulada.',
                  }
                : { action: 'complete', message: 'Entrega simulada.' };
          output = 'OFFICE_DECISION ' + JSON.stringify(decision);
        } else if (role === 'tester') output = 'OFFICE_REVIEW {"findings":[]}\n' + output;
        else
          for (const [file, content] of Object.entries(item.reference))
            await writeFile(join(options.project, file), content as string);
        options.onOutput?.(output);
        return {
          version: 1,
          id: randomUUID(),
          provider: 'codex',
          billing: 'subscription-only',
          status: 'completed',
          project: options.project,
          requestedModel: plan.model,
          requestedEffort: plan.effort,
          confirmedModel: plan.model,
          sessionId: role === 'chief' ? chiefSession : randomUUID(),
          sessionMode: role === 'chief' && chiefTurns > 1 ? 'resume' : 'new',
          startedAt: Date.now() - 20,
          updatedAt: Date.now(),
          reasonCode: null,
          inputTokens: 100,
          outputTokens: 10,
          cachedInputTokens: 0,
          cliVersion: 'simulated',
        };
      },
    };
    const base = simulated
      ? fake
      : new CodexAppServerExecutor(join(proof, method, 'receipts'), {
          approvals: officeApprovalHandler(services),
        });
    const quotaBefore = (await base.diagnose()).quota;
    if (real && quotaBefore.some((q) => q.usedPercent >= plan.maxUsedPercentAtStart))
      throw new ExecutionBlocked(
        'benchmark_quota_reserve',
        'La evaluación conserva un margen de cuota mayor que el chat normal; no inicia otro método.',
      );
    const trial: any = {
      method,
      initialFilesHash: hash(before),
      quotaBefore,
      runs: [],
      tokens: 0,
      usageKnown: true,
      status: 'running',
    };
    report.trials.push(trial);
    await save();
    const started = Date.now(),
      controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), plan.maxMsPerMethod);
    const guarded = new Proxy(base, {
      get(target, key) {
        if (key === 'execute')
          return async (options: Parameters<OfficialExecutor['execute']>[0]) => {
            if (
              controller.signal.aborted ||
              !trial.usageKnown ||
              trial.runs.length >= plan.maxTurnsPerMethod ||
              trial.tokens + plan.minStartReserve > plan.maxTokensPerMethod
            )
              throw new ExecutionBlocked(
                'benchmark_budget',
                'El bloque de comparación ha terminado; no se amplía automáticamente.',
              );
            assert.equal(options.model, plan.model);
            assert.equal(options.effort, plan.effort);
            const role = options.officeRole ?? 'developer';
            assert.ok(!options.allowWrites || role === 'developer');
            const signal = options.signal
              ? AbortSignal.any([options.signal, controller.signal])
              : controller.signal;
            const runStart = Date.now();
            totalTurns++;
            const pending: any = {
              role,
              status: 'running',
              inputTokens: null,
              outputTokens: null,
              cachedInputTokens: null,
            };
            trial.runs.push(pending);
            await save();
            try {
              const receipt = await target.execute({
                ...options,
                signal,
                timeoutMs: Math.max(1, plan.maxMsPerMethod - (Date.now() - started)),
                maxReportedTokens: plan.maxTokensPerMethod - trial.tokens,
              });
              Object.assign(pending, {
                status: receipt.status,
                reasonCode: receipt.reasonCode,
                inputTokens: receipt.inputTokens,
                outputTokens: receipt.outputTokens,
                cachedInputTokens: receipt.cachedInputTokens,
                model: receipt.confirmedModel,
                effort: receipt.requestedEffort,
                sessionMode: receipt.sessionMode,
                cliVersion: receipt.cliVersion,
                sessionHash: receipt.sessionId ? hash(receipt.sessionId) : null,
                toolCalls: receipt.toolCalls,
                durationMs: Date.now() - runStart,
              });
              if (receipt.inputTokens === null || receipt.outputTokens === null)
                trial.usageKnown = false;
              else trial.tokens += receipt.inputTokens + receipt.outputTokens;
              await save();
              return receipt;
            } catch (error) {
              pending.status = 'uncertain';
              trial.usageKnown = false;
              await save();
              throw error;
            }
          };
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const library = new ConversationLibrary(join(proof, method, 'library'));
    const team = new PinnedTeam(
      { codex: guarded, claude: new DisabledExecutor('claude') },
      undefined,
      undefined,
      undefined,
      undefined,
      join(proof, method, 'checkpoint.json'),
      undefined,
      library,
      services,
    );
    try {
      const registered = library.register(project, 'Comparación controlada');
      library.setAutonomy(registered.id, true);
      const conversation = library.create(registered.id);
      const prompt = await readFile(join(project, 'TASK.md'), 'utf8');
      const task = await team.prepareConversation(
        conversation.id,
        prompt,
        true,
        'codex',
        method === 'office',
      );
      await team.confirmConversation(
        task.id,
        true,
        true,
        false,
        team.snapshot().tasks.find((t) => t.id === task.id)!.confirmationFingerprint!,
      );
      await team.waitUntilIdle();
      const root = team.snapshot().tasks.find((t) => t.id === task.id)!;
      trial.executionAndChecksMs = Date.now() - started;
      trial.taskStatus = root.status;
      trial.reasonCode = root.reasonCode;
      trial.localChecks = root.localChecks ?? [];
      trial.finalEvidence = root.finalEvidence ?? null;
      trial.tasks = team
        .snapshot()
        .tasks.map((t) => ({ role: t.role, status: t.status, reasonCode: t.reasonCode }));
    } catch (error) {
      await writeFile(
        join(proof, method, 'failure.txt'),
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
      trial.reasonCode = error instanceof ExecutionBlocked ? error.code : 'benchmark_failed';
      trial.taskStatus = 'unverified';
      await save();
    } finally {
      clearTimeout(timer);
      await team.shutdown();
    }
    trial.quality = await acceptance(item, project, stopProcess);
    trial.changes = inspectChanges(before, snapshot(project), item.files);
    const publicCheck = await runCommand(
      process.execPath,
      ['--test', 'contract.test.mjs'],
      project,
      10000,
      undefined,
      stopProcess,
    );
    trial.publicCheck = {
      passed: publicCheck.passed,
      durationMs: publicCheck.durationMs,
      exitCode: publicCheck.exitCode,
    };
    trial.totalMs = Date.now() - started;
    trial.quotaAfter = (await base.diagnose()).quota;
    trial.status =
      trial.taskStatus === 'completed' &&
      trial.usageKnown &&
      trial.quality.passed &&
      trial.changes.passed &&
      publicCheck.passed
        ? 'accepted'
        : 'failed';
    await save();
    console.log(
      JSON.stringify({
        phase: 'method',
        method,
        status: trial.status,
        tokens: trial.tokens,
        totalMs: trial.totalMs,
        runs: trial.runs.length,
      }),
    );
    if (!trial.usageKnown || controller.signal.aborted || trial.tokens >= plan.maxTokensPerMethod)
      break;
  }
  Object.assign(report, iterativeSummary(report.trials, plan));
  report.totalTurns = totalTurns;
  await save();
  console.log(JSON.stringify({ phase: 'complete', status: report.status, proof, totalTurns }));
  if (simulated) {
    assert.equal(report.status, 'completed', 'The simulated verifier did not finish both methods.');
    assert.equal(report.realInference, false);
    assert.equal(totalTurns, 6);
    assert.ok(report.trials.every((trial) => trial.status === 'accepted'));
  }
}
main().catch(async (error) => {
  await recordFailure?.(error);
  console.error(error.code ?? error.name, error.message);
  process.exitCode = 1;
});
