/** Preparation is offline. Execution is a separate, explicitly authorized operation. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CASES } from './benchmark/cases.mjs';
import { materialize, acceptance, runCommand } from './benchmark/kit.mjs';
import {
  plan,
  protocolFingerprint,
  verifyAuthorization,
  PROTOCOL_ID,
} from './benchmark/protocol.mjs';
import { runStage, referenceExecutor } from './benchmark/runner.mjs';
import { loadTools, root, sourceFingerprint } from './optimization-tools.mjs';

const privateRoot = join(root, '.local-office/comparison-v1');
const publicRoot = join(root, 'reports/comparacion-codex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const write = (path, value) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });

export async function prepare() {
  const tools = await loadTools();
  mkdirSync(privateRoot, { recursive: true });
  mkdirSync(publicRoot, { recursive: true });
  const reportFile = join(publicRoot, 'preparacion-local.json');
  const report = existsSync(reportFile)
    ? json(reportFile)
    : { protocol: PROTOCOL_ID, realInferenceCalls: 0, attempts: [] };
  const work = join(privateRoot, `preparation-${randomUUID()}`);
  mkdirSync(work);
  const attempt = {
    startedAt: new Date().toISOString(),
    sourceFingerprint: sourceFingerprint(),
    protocolFingerprint: protocolFingerprint(),
    status: 'checking',
    cases: [],
    realInferenceCalls: 0,
  };
  report.attempts.push(attempt);
  write(reportFile, report);
  try {
    const tests = await runCommand(
      process.execPath,
      ['--test', 'scripts/benchmark.test.mjs'],
      root,
      60000,
      undefined,
      tools.stopProcess,
    );
    writeFileSync(join(work, 'harness-tests.log'), tests.output, { mode: 0o600 });
    attempt.harnessTests = {
      exitCode: tests.exitCode,
      durationMs: tests.durationMs,
      passed: tests.passed,
      testsPassed: Number(/(?:ℹ pass|# pass)\s+(\d+)/.exec(tests.output)?.[1] ?? 0),
    };
    for (const item of CASES) {
      const bad = join(work, `${item.id}-initial`),
        good = join(work, `${item.id}-reference`);
      materialize(bad, item);
      materialize(good, item, true);
      const initial = await acceptance(item, bad, tools.stopProcess),
        reference = await acceptance(item, good, tools.stopProcess);
      const ledger = { startedAt: Date.now(), attempts: 0, tokens: 0, paused: false };
      const rehearsal = await runStage({
        item,
        tools,
        executor: referenceExecutor(item),
        workspace: join(work, `${item.id}-rehearsal`),
        ledger,
      });
      write(join(work, `${item.id}-rehearsal.json`), rehearsal);
      const result = {
        caseId: item.id,
        initialRejected: !initial.passed,
        initialFailedChecks: initial.failedChecks,
        referenceAccepted: reference.passed,
        independentAcceptanceChecks: reference.tests.length,
        rehearsalAccepted:
          rehearsal.status === 'completed' &&
          rehearsal.controlsPassed &&
          rehearsal.trials.every((trial) => trial.quality.passed),
        officeRoles: item.expectedOfficeRoles,
        simulatedExecutionAttempts: rehearsal.runs.length,
        realInferenceCalls: 0,
      };
      attempt.cases.push(result);
      write(reportFile, report);
    }
    attempt.sourceUnchanged = attempt.sourceFingerprint === sourceFingerprint();
    attempt.status =
      attempt.sourceUnchanged &&
      attempt.harnessTests.passed &&
      attempt.cases.every(
        (item) => item.initialRejected && item.referenceAccepted && item.rehearsalAccepted,
      )
        ? 'ready-not-authorized'
        : 'failed';
    write(join(publicRoot, 'protocolo.json'), {
      ...plan(),
      protocolFingerprint: protocolFingerprint(),
      sourceFingerprint: attempt.sourceFingerprint,
    });
    const contracts = join(publicRoot, 'casos');
    mkdirSync(contracts, { recursive: true });
    for (const item of CASES)
      writeFileSync(
        join(contracts, `${item.id}.md`),
        `# ${item.label}\n\n${item.objective}\n\n${item.contract}\n\nArchivos modificables: ${item.files.join(', ')}.\nPruebas públicas: \`node --test contract.test.mjs\`.\nModelo solicitado: GPT-6.1 Sol; razonamiento: ${item.effort}, igual para todos los papeles de ambos métodos.\n\nOrden fijado: ${item.order.join(' → ')}.\nPapeles de oficina esperados: ${item.expectedOfficeRoles.join(', ')}.\n`,
        { mode: 0o600 },
      );
    const authorizations = join(privateRoot, 'authorizations');
    mkdirSync(authorizations, { recursive: true });
    for (const item of CASES) {
      const target = join(authorizations, `${item.id}.json`);
      write(join(authorizations, `${item.id}.template.json`), {
        approved: false,
        protocol: PROTOCOL_ID,
        caseId: item.id,
        protocolFingerprint: protocolFingerprint(),
        sourceFingerprint: attempt.sourceFingerprint,
        limits: item.limits,
        authorizationNote: '',
        expiresAt: null,
      });
      // Existing approvals are never overwritten or refreshed by preparing again.
      if (!existsSync(target))
        writeFileSync(
          target,
          JSON.stringify(
            {
              approved: false,
              protocol: PROTOCOL_ID,
              caseId: item.id,
              protocolFingerprint: protocolFingerprint(),
              sourceFingerprint: attempt.sourceFingerprint,
              limits: item.limits,
              authorizationNote: '',
              expiresAt: null,
            },
            null,
            2,
          ) + '\n',
          { flag: 'wx', mode: 0o600 },
        );
    }
  } catch (error) {
    attempt.status = 'failed';
    attempt.reasonCode = /^[a-z_]+$/.test(error.code ?? '') ? error.code : 'preparation_failed';
  } finally {
    attempt.finishedAt = new Date().toISOString();
    write(reportFile, report);
  }
  console.log(
    JSON.stringify({ status: attempt.status, cases: attempt.cases, realInferenceCalls: 0 }),
  );
  if (attempt.status !== 'ready-not-authorized') process.exitCode = 1;
  return attempt;
}

export async function execute(caseId) {
  // No CLI discovery, account check or inference before these offline gates.
  const caseIndex = CASES.findIndex((item) => item.id === caseId);
  if (caseIndex < 0) throw Object.assign(new Error('Caso desconocido.'), { code: 'invalid_case' });
  const currentSource = sourceFingerprint();
  const item = verifyAuthorization(
    json(join(privateRoot, 'authorizations', `${caseId}.json`)),
    caseId,
    currentSource,
  );
  if (caseIndex > 0) {
    const previousFile = join(publicRoot, `${CASES[caseIndex - 1].id}-real.json`);
    if (
      !existsSync(previousFile) ||
      json(previousFile).status !== 'completed' ||
      !json(previousFile).controlsPassed
    )
      throw Object.assign(new Error('La etapa previa no está completa y verificable.'), {
        code: 'previous_stage_incomplete',
      });
  }
  const preparation = json(join(publicRoot, 'preparacion-local.json')).attempts.at(-1);
  if (
    preparation.status !== 'ready-not-authorized' ||
    preparation.sourceFingerprint !== currentSource ||
    preparation.protocolFingerprint !== protocolFingerprint()
  )
    throw Object.assign(
      new Error('Repite la preparación local; cambió el código o el protocolo.'),
      { code: 'preparation_stale' },
    );
  const ledgerFile = join(privateRoot, `${caseId}-ledger.json`),
    reportFile = join(publicRoot, `${caseId}-real.json`);
  const ledger = {
    startedAt: Date.now(),
    attempts: 0,
    tokens: 0,
    paused: false,
    limits: item.limits,
    sourceFingerprint: currentSource,
    protocolFingerprint: protocolFingerprint(),
  };
  // A failed/crashed/completed run cannot get a second budget through this command.
  writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const controller = new AbortController(),
    stop = () => controller.abort();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    const tools = await loadTools(),
      executor = new tools.CodexExecutor(join(root, '.local-office/executions'));
    executor.realInference = true;
    const report = await runStage({
      item,
      tools,
      executor,
      workspace: join(privateRoot, `${caseId}-live-${randomUUID()}`),
      ledger,
      signal: controller.signal,
      save: (report, state) => {
        write(ledgerFile, state);
        write(reportFile, {
          ...report,
          protocol: PROTOCOL_ID,
          sourceFingerprint: currentSource,
          protocolFingerprint: protocolFingerprint(),
        });
      },
    });
    console.log(
      JSON.stringify({
        caseId,
        status: report.status,
        comparison: report.comparison,
        attempts: ledger.attempts,
        reportedTokens: ledger.tokens,
      }),
    );
    if (report.status !== 'completed') process.exitCode = 2;
  } finally {
    ledger.paused = true;
    ledger.closed = true;
    write(ledgerFile, ledger);
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args.length === 1 && args[0] === 'prepare') await prepare();
    else if (
      args.length === 3 &&
      args[0] === 'execute' &&
      args[1] === '--case' &&
      CASES.some((item) => item.id === args[2])
    )
      await execute(args[2]);
    else if (!args.length)
      console.log(
        JSON.stringify(
          { ...plan(), note: 'No se ejecuta inferencia. Usa prepare para validar offline.' },
          null,
          2,
        ),
      );
    else
      throw Object.assign(
        new Error('Usa prepare, o execute --case easy|medium|hard con autorización previa.'),
        { code: 'invalid_arguments' },
      );
  } catch (error) {
    console.error(/^[a-z_]+$/.test(error.code ?? '') ? error.code : 'operation_blocked');
    process.exitCode = 2;
  }
}
