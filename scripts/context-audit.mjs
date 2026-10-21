// Offline only: no native provider is constructed, diagnosed or executed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { cases } from './orchestrator-pilot.mjs';
import { materialize, acceptance, snapshot, inspectChanges } from './benchmark/kit.mjs';
import { loadTools, root, sourceFingerprint } from './optimization-tools.mjs';
import {
  comparisonPlan,
  contextVariants,
  digest,
  verifyCanonicalFiles,
} from './context-experiment.mjs';

const item = cases.find((c) => c.id === 'medium');
const historicalFile = 'reports/optimizacion-adaptativa/validacion-jefe/piloto/RESULTADO_REAL.json';

function historicalCounters(prepared) {
  const r = JSON.parse(fs.readFileSync(path.join(root, historicalFile)));
  const a = r.baseline.run,
    b = r.runs[0];
  const directPrompt =
    'Resuelve el encargo completo. Lee AGENTS.md y TASK.md; no delegues.\n' +
    prepared.files['TASK.md'] +
    '\nTermina con OFFICE_RESULT {"status":"completed"} solo si has completado el encargo.';
  const dirs = [
    path.join(root, '.local-office/orchestrator-pilot/revalidacion-20261021-b/receipts'),
    ...fs
      .readdirSync(path.join(root, '.local-office'))
      .filter((n) => /^cp-[a-f0-9]{8}$/.test(n))
      .map((n) => path.join(root, '.local-office', n, 'receipts')),
  ];
  // Only explicit receipt folders, never credential files or conversation transcripts.
  const receipts = dirs
    .filter((d) => fs.existsSync(d))
    .flatMap((d) =>
      fs
        .readdirSync(d)
        .filter((n) => /^[a-f0-9-]{36}\.json$/.test(n))
        .map((n) => JSON.parse(fs.readFileSync(path.join(d, n)))),
    );
  const select = (input, output) =>
    receipts.filter(
      (r) => r.inputTokens === input && r.outputTokens === output && r.officeRole === 'developer',
    );
  const direct = select(a.inputTokens, a.outputTokens),
    office = select(b.input, b.output);
  if (office.length === 1)
    assert.equal(
      office[0].contextFingerprint,
      prepared.variants.standard.fingerprint,
      'No se reconstruyó exactamente el prompt histórico.',
    );
  const rows = [
    {
      name: 'direct-historical',
      input: a.inputTokens,
      output: a.outputTokens,
      cached: a.cachedInputTokens,
      receipts: direct,
    },
    {
      name: 'office-historical',
      input: b.input,
      output: b.output,
      cached: b.cached,
      receipts: office,
    },
  ];
  return {
    reportHash: digest(fs.readFileSync(path.join(root, historicalFile))),
    reconstructedDirectPromptCharacters: directPrompt.length,
    reconstructedOfficePromptCharacters: prepared.variants.standard.characters,
    rows: rows.map(({ receipts, ...row }) => ({
      ...row,
      total: row.input + row.output,
      nonCachedInput: row.input - row.cached,
      legacyToolCalls: receipts.length === 1 ? (receipts[0].toolCalls ?? null) : null,
      legacyToolMeaning: row.name.startsWith('direct')
        ? 'completed tool events'
        : 'activity-start events; not comparable with completed tools',
      cliVersion: receipts.length === 1 ? (receipts[0].cliVersion ?? null) : null,
      fingerprintMatched: row.name.startsWith('office') && receipts.length === 1 ? true : null,
    })),
    additionalInput: b.input - a.inputTokens,
    additionalOutput: b.output - a.outputTokens,
    additionalTotal: b.input + b.output - a.inputTokens - a.outputTokens,
    causalAttribution:
      'unknown: prompts, effort, transport and cache differed; aggregate receipts cannot identify file reads or internal model requests',
  };
}

async function simulate(tools, local, method, variant, injectDefect = false) {
  const prepared = contextVariants(item, tools),
    project = path.join(local, randomUUID().slice(0, 8));
  materialize(project, item);
  const before = snapshot(project);
  const evidence = {
    checkedAt: Date.now(),
    plan: 'plus',
    quota: [],
    models: [{ id: 'gpt-6.1-sol', efforts: ['low'] }],
  };
  const criteria = prepared.packet.acceptance;
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
        criteria,
      },
    },
    path.join(local, 'logs-' + randomUUID().slice(0, 8)),
  );
  let calls = 0,
    submittedHash;
  const fake = {
    engine: 'codex-cli',
    provider: 'codex',
    diagnose: async () => evidence,
    execute: async (options) => {
      assert.equal(options.model, 'gpt-6.1-sol');
      assert.equal(options.effort, 'low');
      assert.equal(options.allowWrites, true);
      assert.equal(options.officeRole, 'developer');
      if (method === 'office') assert.equal(options.prompt, prepared.variants.standard.prompt);
      else assert.equal(options.prompt, prepared.variants[variant].prompt);
      // Experimental boundary transform, not a production default or a permission change.
      verifyCanonicalFiles(
        item,
        Object.fromEntries(
          Object.keys(prepared.files).map((f) => [
            f,
            fs.readFileSync(path.join(project, f), 'utf8'),
          ]),
        ),
      );
      const submitted = tools.CODEX_TASK_PREFIX + prepared.variants[variant].prompt;
      submittedHash = digest(submitted);
      calls++;
      if (!injectDefect)
        for (const [file, text] of Object.entries(item.reference))
          fs.writeFileSync(path.join(project, file), text);
      options.onOutput?.('OFFICE_RESULT {"status":"completed"}');
      return {
        version: 1,
        id: randomUUID(),
        provider: 'codex',
        billing: 'subscription-only',
        status: 'completed',
        project,
        requestedModel: options.model,
        requestedEffort: options.effort,
        confirmedModel: null,
        sessionId: null,
        sessionMode: 'new',
        startedAt: Date.now(),
        updatedAt: Date.now(),
        reasonCode: null,
        inputTokens: 1,
        outputTokens: 1,
        cachedInputTokens: 0,
        subscriptionCheckedAt: evidence.checkedAt,
      };
    },
  };
  let team, localChecks, taskStatus;
  try {
    if (method === 'direct') {
      await fake.execute({
        project,
        model: 'gpt-6.1-sol',
        effort: 'low',
        allowWrites: true,
        officeRole: 'developer',
        prompt: prepared.variants[variant].prompt,
      });
      localChecks = await checks.run(prepared.packet.checks, project, new AbortController().signal);
      taskStatus = 'completed';
    } else {
      team = new tools.TeamCoordinator(
        { codex: fake, claude: new tools.DisabledExecutor('claude') },
        undefined,
        undefined,
        checks,
        undefined,
        undefined,
        new tools.AdaptiveRuntime(
          new tools.UsageHistory(path.join(local, randomUUID().slice(0, 8), 'history.json')),
          path.join(local, randomUUID().slice(0, 8), 'artifacts'),
        ),
      );
      team.configure({
        mode: 'auto',
        claudeEnabled: false,
        maxRuns: 1,
        maxParallel: 1,
        maxMinutes: 4,
        maxTokens: 120000,
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
      assert.equal(task.choice.model, 'gpt-6.1-sol');
      assert.equal(task.choice.effort, 'low');
      // Fixture authorization for this in-memory fake only; no real authorization file.
      team.reviewBudget(task.id, 120000, 180000, 12000);
      await team.start();
      while (team.snapshot().running) await new Promise((resolve) => setTimeout(resolve, 10));
      const final = team.snapshot().tasks[0];
      localChecks = final.localChecks;
      taskStatus = final.status;
    }
    const quality = await acceptance(item, project, tools.stopProcess);
    const changes = inspectChanges(before, snapshot(project), item.files);
    assert.equal(calls, 1);
    assert(changes.passed);
    const accepted =
      taskStatus === 'completed' && quality.passed && localChecks?.every((c) => c.passed);
    assert.equal(!!accepted, !injectDefect);
    if (!injectDefect) assert.equal(quality.tests.length, 36);
    return {
      method,
      variant,
      injectDefect,
      simulated: true,
      submittedPromptHash: submittedHash,
      fixtureHash: digest(JSON.stringify(prepared.hashes)),
      callsToFake: calls,
      taskStatus,
      accepted: !!accepted,
      quality,
      changes,
      localChecks,
    };
  } finally {
    if (team) await team.shutdown();
  }
}

export async function auditContext(runName = 'preparacion-1') {
  assert.match(runName, /^[a-z][a-z0-9-]{0,63}$/);
  const reportDir = path.join(root, 'reports/optimizacion-contexto');
  const output = path.join(reportDir, runName + '.json');
  assert(!fs.existsSync(output), 'El intento existente se conserva; usa otro nombre.');
  const tools = await loadTools(),
    prepared = contextVariants(item, tools);
  const local = path.join(root, '.local-office', 'ca-' + randomUUID().slice(0, 8));
  fs.mkdirSync(local);
  const report = {
    protocol: 'context-audit-offline-v1',
    inferenceCalls: 0,
    sourceFingerprint: sourceFingerprint(),
    passed: false,
    results: [],
    context: {},
    history: historicalCounters(prepared),
    comparison: comparisonPlan(item, tools),
    errors: [],
  };
  const cliArgs = tools.buildCodexArguments(
    { project: 'fixture', prompt: 'fixture', allowWrites: true },
    'gpt-6.1-sol',
    'low',
  );
  const aoArgsSource = fs.readFileSync(
    path.join(root, 'integrations/agent-orchestrator/office_driver.go'),
    'utf8',
  );
  report.transportAudit = {
    scope: 'current source settings, not a capture of historical provider prompts',
    codexIgnoreUserConfig: cliArgs.includes('--ignore-user-config'),
    codexSkillsContextCap: cliArgs.includes('skills.max_context_tokens=1000') ? 1000 : null,
    aoIgnoreUserConfigExplicit: aoArgsSource.includes('--ignore-user-config'),
    aoSkillsContextCapExplicit: aoArgsSource.includes('skills.max_context_tokens='),
    codexPrefixCharacters: tools.CODEX_TASK_PREFIX.length,
    aoPrefixCharacters: 0,
    aoSourceHash: digest(aoArgsSource),
    implication:
      'Configuration and hidden provider instructions are not proven equivalent across engines. Use the same CLI in the primary comparison; align and verify AO separately without reading credentials or changing global configuration.',
  };
  report.duplication = {
    objectiveCopiesInStandardPrompt:
      prepared.variants.standard.prompt.split(item.objective).length - 1,
    acceptanceCriteriaInline: prepared.packet.acceptance.length,
    allCriteriaAlsoInTaskFile: prepared.packet.acceptance.every((c) =>
      prepared.files['TASK.md'].includes(c),
    ),
    taskFileCharacters: prepared.files['TASK.md'].length,
    projectGuideCharacters: prepared.files['AGENTS.md'].length,
    canonicalFileRequiresRead: true,
    note: 'Exact criteria remain in the trusted mechanical registry for all variants; canonical omits only their prompt copy after fixture validation. This is not a proof of model comprehension or fewer tokens.',
  };
  try {
    const initial = path.join(local, 'initial'),
      reference = path.join(local, 'reference');
    materialize(initial, item);
    materialize(reference, item, true);
    const a = await acceptance(item, initial, tools.stopProcess),
      b = await acceptance(item, reference, tools.stopProcess);
    assert(!a.passed);
    assert(b.passed);
    assert.equal(b.tests.length, 36);
    report.oracle = {
      rejectsInitial: !a.passed,
      acceptsReference: b.passed,
      checks: b.tests.length,
    };
    for (const [name, p] of Object.entries(prepared.variants))
      report.context[name] = {
        characters: p.characters,
        utf8Bytes: p.utf8Bytes,
        fingerprint: p.fingerprint,
        charReductionVsStandard: prepared.variants.standard.characters - p.characters,
        tokenSaving: null,
      };
    for (const variant of Object.keys(prepared.variants)) {
      const direct = await simulate(tools, local, 'direct', variant);
      report.results.push(direct);
      const office = await simulate(tools, local, 'office', variant);
      report.results.push(office);
      assert.equal(direct.submittedPromptHash, office.submittedPromptHash);
      assert.equal(direct.fixtureHash, office.fixtureHash);
    }
    report.results.push(await simulate(tools, local, 'office', 'canonical', true));
    assert.equal(sourceFingerprint(), report.sourceFingerprint);
    report.passed = true;
  } catch (error) {
    report.errors.push({ code: 'offline_validation_failed', name: error.name });
  }
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(
    process.argv.length <= 3,
    'Solo se admite un nombre de informe local; no hay modo execute.',
  );
  const report = await auditContext(process.argv[2]);
  console.log(
    JSON.stringify({
      passed: report.passed,
      inferenceCalls: 0,
      context: report.context,
      simulations: report.results.length,
      errors: report.errors,
    }),
  );
  if (!report.passed) process.exitCode = 1;
}
