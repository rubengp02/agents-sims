import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { OrchestratorExecutor } from '../src/execution/orchestratorExecutor.js';
import { ROLE_PROFILES, roleOutcomeInstruction } from '../src/execution/roleProfiles.js';
import { TeamCoordinator } from '../src/execution/teamCoordinator.js';
import type { ExecuteOptions, OfficialExecutor, RunRecord } from '../src/execution/types.js';

const roots: string[] = [];
const evidence = () => ({
  checkedAt: Date.now(),
  plan: 'plus' as const,
  quota: [],
  models: [{ id: 'gpt-6.1-sol', efforts: ['low', 'high'] }],
});
function fixture(mode = 'ok') {
  const root = mkdtempSync(join(tmpdir(), 'office-ao-'));
  roots.push(root);
  const project = join(root, 'project');
  mkdirSync(project);
  const metadata = {
    provider: 'codex',
    diagnose: vi.fn(async () => evidence()),
    execute: vi.fn(),
  } as unknown as OfficialExecutor;
  const launch = vi.fn(() =>
    spawn(
      process.execPath,
      [
        '-e',
        `
    let buffer='';process.stdin.on('data',chunk=>{buffer+=chunk;let end;
    while((end=buffer.indexOf('\\n'))>=0){const q=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);
      if(q.action==='open') console.log(JSON.stringify({kind:'ready',threadId:q.threadId||'test-thread'}));
      else if(q.action==='turn') {
        if(${JSON.stringify(mode)}==='hang') { setInterval(()=>{},1000);return; }
        console.log(JSON.stringify({kind:'text',text:${JSON.stringify(mode)}==='show-prompt'?q.prompt:'OFFICE_RESULT {"status":"completed"}'}));
        if(${JSON.stringify(mode)}!=='no-usage') console.log(JSON.stringify({kind:'usage',input:${mode === 'second' ? 200 : 100},output:${mode === 'second' ? 40 : 20},cached:${mode === 'bad-cache' ? 999 : mode === 'second' ? 80 : 40}}));
        console.log(JSON.stringify({kind:'finished',status:'completed'}));
      }
    }});
  `,
      ],
      { stdio: 'pipe', windowsHide: true },
    ),
  );
  const deps = {
    metadata,
    launch,
    verifyBuild: () => {},
    discover: async () => ({ executable: process.execPath, version: 'fixture' }),
    env: {},
  };
  return {
    root,
    project,
    deps,
    launch,
    metadata,
    executor: new OrchestratorExecutor(root, join(root, 'receipts'), deps),
  };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('restricted Agent Orchestrator boundary (simulated provider)', () => {
  it('hands missing original instructions to the isolated turn without storing their contents', async () => {
    const h = fixture('show-prompt');
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', h.project, ...args], { windowsHide: true, stdio: 'pipe' });
    git('init');
    writeFileSync(join(h.project, 'AGENTS.md'), 'TRACKED_PROJECT_GUIDANCE');
    git('add', 'AGENTS.md');
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-m',
      'fixture',
    );
    const parent = join(h.root, '.local-office/agent-orchestrator/workspaces');
    mkdirSync(parent, { recursive: true });
    const workspace = join(parent, 'inherited');
    git('worktree', 'add', '--detach', workspace, 'HEAD');
    writeFileSync(join(h.project, '.git/info/exclude'), 'AGENTS.override.md\n');
    writeFileSync(join(h.project, 'AGENTS.override.md'), 'LOCAL_IGNORED_GUIDANCE');
    const output: string[] = [];
    const result = await h.executor.execute({
      project: h.project,
      inheritedWorkspace: workspace,
      prompt: 'Encargo',
      onOutput: (text) => output.push(text),
    });
    expect(result.status).toBe('completed');
    expect(output.join('')).toContain('LOCAL_IGNORED_GUIDANCE');
    expect(output.join('')).not.toContain('TRACKED_PROJECT_GUIDANCE');
    expect(result.metrics!.submittedCharacters).toBeGreaterThan(result.metrics!.promptCharacters);
    expect(readFileSync(join(h.root, 'receipts', result.id + '.json'), 'utf8')).not.toContain(
      'LOCAL_IGNORED_GUIDANCE',
    );
  });
  it('checks subscription before launch and again before the turn; reports cache separately', async () => {
    const h = fixture();
    const r = await h.executor.execute({
      project: h.project,
      prompt: 'diagnostica',
      officeRole: 'architect',
    });
    expect(h.metadata.diagnose).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({
      engine: 'agent-orchestrator',
      status: 'completed',
      inputTokens: 100,
      outputTokens: 20,
      cachedInputTokens: 40,
      sessionMode: 'new',
    });
  });
  it('does not launch on subscription failure or silently fall back', async () => {
    const h = fixture();
    vi.mocked(h.metadata.diagnose).mockRejectedValue(new Error('quota'));
    await expect(h.executor.execute({ project: h.project, prompt: 'x' })).rejects.toThrow();
    expect(h.launch).not.toHaveBeenCalled();
    expect(h.metadata.execute).not.toHaveBeenCalled();
  });
  it('does not send a turn when the second verification fails', async () => {
    const h = fixture();
    vi.mocked(h.metadata.diagnose)
      .mockResolvedValueOnce(evidence())
      .mockRejectedValue(new Error('quota'));
    const r = await h.executor.execute({ project: h.project, prompt: 'x' });
    expect(r.status).toBe('paused');
    expect(r.inputTokens).toBeNull();
  });
  it.each(['no-usage', 'bad-cache'])('unknown/invalid accounting pauses: %s', async (mode) => {
    const h = fixture(mode);
    const r = await h.executor.execute({
      project: h.project,
      prompt: 'x',
      executionSessionKey: 'same',
    });
    expect(r.status).toBe('paused');
    await expect(
      h.executor.execute({ project: h.project, prompt: 'x', executionSessionKey: 'same' }),
    ).rejects.toMatchObject({ code: 'ao_recovery_required' });
  });
  it('continues an explicitly owned session after executor restart, subtracting cumulative usage', async () => {
    const h = fixture();
    const options = { project: h.project, prompt: 'x', executionSessionKey: 'same' };
    const first = await h.executor.execute(options);
    const other = fixture('second');
    const restarted = new OrchestratorExecutor(h.root, join(h.root, 'receipts'), {
      ...h.deps,
      launch: other.launch,
    });
    const next = await restarted.execute(options);
    expect(next.sessionId).toBe(first.sessionId);
    expect(next.sessionMode).toBe('resume');
    expect(next.inputTokens).toBe(100);
    expect(next.outputTokens).toBe(20);
    expect(next.cachedInputTokens).toBe(40);
    expect(next.metrics).toMatchObject({
      source: 'ao-activity',
      completedToolEvents: null,
      completedTurns: 1,
      usageEvents: 1,
    });
  });
  it('preserves interim usage separately when a budget stop prevents a clean completion', async () => {
    const h = fixture();
    const r = await h.executor.execute({ project: h.project, prompt: 'x', maxReportedTokens: 50 });
    expect(r.status).toBe('paused');
    expect(r.reasonCode).toBe('token_budget');
    expect(r.inputTokens).toBeNull();
    expect(r.outputTokens).toBeNull();
    expect(r.cachedInputTokens).toBeNull();
    expect(r.observedUsage).toEqual({ inputTokens: 100, outputTokens: 20, cachedInputTokens: 40 });
  });
  it('a character alone does not continue a session', async () => {
    const h = fixture();
    await h.executor.execute({ project: h.project, prompt: 'x', officeRole: 'architect' });
    const next = await h.executor.execute({
      project: h.project,
      prompt: 'y',
      officeRole: 'architect',
    });
    expect(next.sessionMode).toBe('new');
  });
  it('enforces deadline and token budget and refuses writes for an architect', async () => {
    const h = fixture('hang');
    const r = await h.executor.execute({ project: h.project, prompt: 'x', timeoutMs: 50 });
    expect(r).toMatchObject({ status: 'paused', reasonCode: 'time_budget' });
    const other = fixture();
    expect(
      (await other.executor.execute({ project: other.project, prompt: 'x', maxReportedTokens: 50 }))
        .status,
    ).toBe('paused');
    await expect(
      other.executor.execute({
        project: other.project,
        prompt: 'x',
        officeRole: 'architect',
        allowWrites: true,
      }),
    ).rejects.toMatchObject({ code: 'ao_scope_invalid' });
  });
  it('passes an explicit unbounded native timeout to the bridge while keeping cancellation', async () => {
    const h = fixture('hang');
    const original = h.launch.getMockImplementation()!;
    h.launch.mockImplementation(() => {
      const child = original();
      vi.spyOn(child.stdin, 'write');
      return child;
    });
    const controller = new AbortController();
    let running = false;
    const task = h.executor.execute({
      project: h.project,
      prompt: 'long work',
      timeoutMs: null,
      signal: controller.signal,
      onState: (state) => {
        running ||= state.status === 'running';
      },
    });
    await vi.waitFor(() => expect(running).toBe(true));
    const child = h.launch.mock.results[0].value;
    const open = JSON.parse(String(vi.mocked(child.stdin.write).mock.calls[0][0]));
    expect(open.timeoutMs).toBe(0);
    controller.abort();
    expect((await task).status).toBe('cancelled');
  });
  it('rejects payment environment and a missing or changed artifact before launch', async () => {
    const h = fixture();
    const bad = new OrchestratorExecutor(h.root, join(h.root, 'receipts'), {
      ...h.deps,
      env: { OPENAI_API_KEY: 'fixture-only' },
    });
    await expect(bad.diagnose()).rejects.toMatchObject({ code: 'payment_environment' });
    const missing = new OrchestratorExecutor(h.root, join(h.root, 'receipts'), {
      ...h.deps,
      verifyBuild: undefined,
    });
    await expect(missing.diagnose()).rejects.toMatchObject({ code: 'ao_build_unverified' });
    expect(h.launch).not.toHaveBeenCalled();
  });
});

describe('role completion and durable office queue', () => {
  it('distinguishes a completed diagnosis from failing product acceptance', () => {
    expect(ROLE_PROFILES.architect).toContain('código inicial');
    expect(roleOutcomeInstruction('architect')).toContain('no convierten');
    expect(roleOutcomeInstruction('tester')).toContain('aceptación fallan');
  });
  function coordinator(root: string) {
    const executor: OfficialExecutor = {
      provider: 'codex',
      diagnose: async () => evidence(),
      execute: vi.fn(async (o: ExecuteOptions) => {
        o.onOutput?.('Diagnóstico entregado: hay defectos.\nOFFICE_RESULT {"status":"completed"}');
        return {
          status: 'completed',
          id: 'receipt',
          inputTokens: 100,
          outputTokens: 20,
        } as RunRecord;
      }),
    };
    return {
      executor,
      team: new TeamCoordinator(
        { codex: executor, claude: executor },
        undefined,
        undefined,
        undefined,
        undefined,
        join(root, 'checkpoint.json'),
      ),
    };
  }
  it('recovers tasks and spent budget without auto-starting; architect findings unblock implementation', async () => {
    const h = fixture(),
      c = coordinator(h.root);
    const a = c.team.addTask({
      project: h.project,
      role: 'architect',
      title: 'Diagnóstico',
      prompt: 'Analiza el código con fallos',
    });
    c.team.addTask({
      project: h.project,
      role: 'developer',
      title: 'Corrección',
      prompt: 'Corrige',
      dependsOn: [a.id],
    });
    await c.team.start();
    for (let i = 0; i < 100 && c.team.snapshot().running; i++)
      await new Promise((r) => setTimeout(r, 5));
    expect(c.team.snapshot().tasks.map((t) => t.status)).toEqual(['completed', 'completed']);
    const restored = coordinator(h.root);
    expect(restored.team.snapshot()).toMatchObject({
      running: false,
      runsUsed: 2,
      tokensUsed: 240,
    });
    expect(restored.executor.execute).not.toHaveBeenCalled();
  });
  it('an interrupted checkpoint or corrupt file cannot reset accounting or auto-resume', () => {
    const h = fixture(),
      c = coordinator(h.root);
    c.team.addTask({ project: h.project, role: 'developer', title: 'Cambio', prompt: 'x' });
    c.team.snapshot();
    const file = join(h.root, 'checkpoint.json'),
      saved = JSON.parse(readFileSync(file, 'utf8'));
    saved.tasks[0].status = 'running';
    saved.runsUsed = 1;
    saved.tokensUsed = 42;
    writeFileSync(file, JSON.stringify(saved));
    const restored = coordinator(h.root);
    expect(restored.team.snapshot()).toMatchObject({
      running: false,
      runsUsed: 1,
      tokensUsed: 42,
      budgetReason: 'usage_unknown_after_restart',
    });
    expect(() => restored.team.resume()).toThrow();
    writeFileSync(file, 'invalid');
    const invalid = coordinator(h.root);
    invalid.team.snapshot();
    expect(readFileSync(file, 'utf8')).toBe('invalid');
  });
});
