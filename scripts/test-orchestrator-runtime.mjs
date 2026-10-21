import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = path.join(root, '.local-office/agent-orchestrator');
const go = path.join(local, 'toolchain/go/bin', process.platform === 'win32' ? 'go.exe' : 'go');
const fake = path.join(
  local,
  'bin',
  process.platform === 'win32' ? 'fake-codex.exe' : 'fake-codex',
);
function command(exe, args, cwd = root) {
  const r = spawnSync(exe, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, GOTOOLCHAIN: 'local', GOPATH: path.join(local, 'go-cache') },
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
command(go, ['build', '-o', fake, 'integrations/agent-orchestrator/fake_codex.go']);
const bundle = buildSync({
  stdin: {
    contents: [
      'export * from "./server/src/execution/orchestratorExecutor.ts";',
      'export * from "./server/src/execution/teamCoordinator.ts";',
      'export * from "./server/src/execution/localChecks.ts";',
      'export * from "./server/src/execution/optionalExecutors.ts";',
    ].join('\n'),
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
});
const temporaryModule = path.join(local, 'runtime-test.cjs');
fs.writeFileSync(temporaryModule, bundle.outputFiles[0].text);
const { OrchestratorExecutor, TeamCoordinator, LocalChecks, DisabledExecutor } = createRequire(
  import.meta.url,
)(temporaryModule);
const testRoot = path.join(local, 'native-tests', randomUUID());
fs.mkdirSync(testRoot, { recursive: true });
const evidence = () => ({
  checkedAt: Date.now(),
  plan: 'plus',
  quota: [],
  models: [{ id: 'gpt-6.1-sol', efforts: ['low'] }],
});
let verificationCount = 0;
const deps = {
  metadata: {
    provider: 'codex',
    diagnose: async () => {
      verificationCount++;
      return evidence();
    },
  },
  discover: async () => ({ executable: fake, version: 'fixture' }),
  env: {},
};
const executor = () => new OrchestratorExecutor(root, path.join(testRoot, 'receipts'), deps);
const report = {
  inferenceCalls: 0,
  provider: 'compiled local protocol fixture',
  engine: 'real pinned Agent Orchestrator modules',
  checks: [],
  failures: [],
};
const check = async (name, run) => {
  const at = Date.now();
  try {
    await run();
    report.checks.push({ name, passed: true, durationMs: Date.now() - at });
  } catch (e) {
    report.failures.push({ name, message: e.message });
    throw e;
  }
};
try {
  await check(
    'completed-only, streamed-and-completed and delta-only messages settle once',
    async () => {
      for (const shape of ['FIXTURE_COMPLETE_ONLY', 'FIXTURE_BOTH', 'FIXTURE_DELTA_ONLY']) {
        const shapeRoot = path.join(testRoot, shape);
        fs.mkdirSync(shapeRoot);
        let output = '';
        const result = await executor().execute({
          project: shapeRoot,
          prompt: shape,
          officeRole: 'architect',
          onOutput: (s) => (output += s),
        });
        assert.equal(result.status, 'completed');
        assert.equal(output.match(/OFFICE_RESULT/g)?.length, 1);
        assert.ok(output.endsWith('OFFICE_RESULT {"status":"completed"}'));
      }
    },
  );
  await check(
    'native protocol start and explicit resume after restart, cumulative cache accounting',
    async () => {
      const options = {
        project: testRoot,
        prompt: 'FIXTURE_ANALYSIS',
        officeRole: 'architect',
        executionSessionKey: 'native-resume',
      };
      const a = await executor().execute(options);
      assert.equal(a.status, 'completed');
      assert.equal(a.inputTokens, 100);
      const b = await executor().execute(options);
      assert.equal(b.status, 'completed');
      assert.equal(b.sessionMode, 'resume');
      assert.equal(a.sessionId, b.sessionId);
      assert.equal(b.inputTokens, 100);
      assert.equal(b.cachedInputTokens, 40);
      const request = JSON.parse(
        fs.readFileSync(path.join(testRoot, '.fixture-request.json'), 'utf8'),
      );
      assert.equal(request.params.sandboxPolicy.type, 'readOnly');
    },
  );
  await check(
    'real AO worktree preserves source and sends tester to the changed workspace',
    async () => {
      // Match the nested pilot source path: short fixtures hid Windows ref limits.
      const repo = path.join(testRoot, 'repo-comparable-pilot-path');
      fs.mkdirSync(repo);
      command('git', ['init', '--initial-branch=main', repo]);
      fs.writeFileSync(path.join(repo, '.gitignore'), '.fixture*\n');
      fs.writeFileSync(path.join(repo, 'source.txt'), 'unchanged');
      command('git', ['add', '.'], repo);
      command(
        'git',
        [
          '-c',
          'user.name=Local Fixture',
          '-c',
          'user.email=fixture@example.invalid',
          'commit',
          '-m',
          'fixture',
        ],
        repo,
      );
      const a = await executor().execute({
        project: repo,
        prompt: 'FIXTURE_WRITE',
        officeRole: 'developer',
        allowWrites: true,
      });
      assert.equal(a.status, 'completed');
      assert.notEqual(a.executionProject, repo);
      assert.equal(fs.existsSync(path.join(repo, 'output.txt')), false);
      assert.equal(
        fs.readFileSync(path.join(a.executionProject, 'output.txt'), 'utf8'),
        'isolated fixture output',
      );
      const b = await executor().execute({
        project: repo,
        inheritedWorkspace: a.executionProject,
        prompt: 'FIXTURE_TEST',
        officeRole: 'tester',
      });
      assert.equal(b.status, 'completed');
      assert.equal(b.executionProject, a.executionProject);
      const request = JSON.parse(
        fs.readFileSync(path.join(a.executionProject, '.fixture-request.json'), 'utf8'),
      );
      assert.equal(request.params.sandboxPolicy.type, 'readOnly');
    },
  );
  await check('unknown native usage pauses and a second attempt remains blocked', async () => {
    const options = {
      project: testRoot,
      prompt: 'FIXTURE_NO_USAGE',
      executionSessionKey: 'unknown',
    };
    assert.equal((await executor().execute(options)).status, 'paused');
    await assert.rejects(executor().execute(options), { code: 'ao_recovery_required' });
  });
  await check(
    'full office workflow on compiled AO: diagnosis, isolated implementation, independent mechanical acceptance',
    async () => {
      const repo = path.join(testRoot, 'workflow');
      fs.mkdirSync(repo);
      command('git', ['init', '--initial-branch=main', repo]);
      fs.writeFileSync(path.join(repo, '.gitignore'), '.fixture*\n');
      fs.writeFileSync(
        path.join(repo, 'contract.test.cjs'),
        'require("node:assert/strict").equal(require("node:fs").readFileSync("output.txt","utf8"),"isolated fixture output");',
      );
      command('git', ['add', '.'], repo);
      command(
        'git',
        [
          '-c',
          'user.name=Local Fixture',
          '-c',
          'user.email=fixture@example.invalid',
          'commit',
          '-m',
          'fixture',
        ],
        repo,
      );
      const checks = new LocalChecks(
        {
          acceptance: {
            executable: process.execPath,
            args: ['--test', 'contract.test.cjs'],
            timeoutMs: 5000,
            acceptance: true,
          },
        },
        path.join(testRoot, 'checks'),
      );
      const checkpoint = path.join(testRoot, 'workflow-checkpoint.json');
      const engine = executor();
      const team = new TeamCoordinator(
        { codex: engine, claude: new DisabledExecutor('claude') },
        undefined,
        undefined,
        checks,
        100,
        checkpoint,
      );
      const tasks = team.addScopedWorkflow(
        repo,
        {
          objective: 'FIXTURE_WRITE: crea output.txt según contract.test.cjs',
          files: ['contract.test.cjs'],
          decisions: ['Conserva el contrato'],
          acceptance: ['output.txt contiene isolated fixture output'],
          checks: ['acceptance'],
        },
        {
          scope: 'cross-module',
          risk: 'low',
          uncertainty: 'low',
          modules: ['writer', 'reader'],
          tests: 'available',
        },
        true,
      );
      for (const task of tasks) {
        team.override(task.id, { provider: 'codex', model: 'gpt-6.1-sol', effort: 'low' });
        await team.assign(task.id);
        team.approve(task.id);
      }
      await team.start();
      const limit = Date.now() + 10000;
      while (team.snapshot().running && Date.now() < limit)
        await new Promise((r) => setTimeout(r, 10));
      const done = team.snapshot();
      assert.deepEqual(
        done.tasks.map((t) => t.status),
        ['completed', 'completed', 'completed'],
      );
      assert.equal(fs.existsSync(path.join(repo, 'output.txt')), false);
      assert.equal(done.tasks[1].executionProject, done.tasks[2].executionProject);
      assert.ok(done.tasks[1].localChecks.every((c) => c.passed));
      assert.ok(done.tasks[2].localChecks.every((c) => c.passed));
      await team.shutdown();
      const restored = new TeamCoordinator(
        { codex: executor(), claude: new DisabledExecutor('claude') },
        undefined,
        undefined,
        checks,
        undefined,
        checkpoint,
      );
      assert.equal(restored.snapshot().running, false);
      assert.equal(restored.snapshot().runsUsed, 3);
    },
  );
  report.subscriptionVerificationsSimulated = verificationCount;
  console.log(JSON.stringify(report, null, 2));
} finally {
  fs.writeFileSync(path.join(testRoot, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
