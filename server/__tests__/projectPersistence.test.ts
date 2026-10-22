import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TaskContext, TeamSnapshot } from '../../core/src/team.js';
import { AgentStateStore } from '../src/agentStateStore.js';
import { LocalChecks } from '../src/execution/localChecks.js';
import { DisabledExecutor } from '../src/execution/optionalExecutors.js';
import { TeamCoordinator } from '../src/execution/teamCoordinator.js';
import type { OfficialExecutor, RunRecord } from '../src/execution/types.js';
import { createHttpServer } from '../src/httpServer.js';

const roots: string[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

const context: TaskContext = {
  objective: 'Verifica el contrato local',
  files: ['contract.txt'],
  decisions: ['Conservar el contrato público'],
  acceptance: ['El contrato contiene OK'],
  checks: ['contract'],
};

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pixel-project-persistence-'));
  roots.push(root);
  writeFileSync(join(root, 'contract.txt'), 'OK');
  return root;
}

/** Real HTTP server, disk checkpoint and Node check; model execution is simulated. */
async function open(root: string, registered = true) {
  const execute = vi.fn<OfficialExecutor['execute']>(async (options) => {
    options.onOutput?.('OFFICE_RESULT {"status":"completed"}');
    return {
      version: 1,
      id: 'fixture-receipt',
      provider: 'codex',
      billing: 'subscription-only',
      status: 'completed',
      project: options.project,
      requestedModel: options.model!,
      requestedEffort: options.effort!,
      confirmedModel: options.model!,
      sessionId: 'fixture-session',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      reasonCode: null,
      inputTokens: 20,
      outputTokens: 4,
    } satisfies RunRecord;
  });
  const diagnose = vi.fn<OfficialExecutor['diagnose']>(async () => ({
    checkedAt: Date.now(),
    plan: 'plus',
    quota: [],
    models: [{ id: 'gpt-6.1-sol', efforts: ['low', 'medium', 'high'] }],
  }));
  const checks = new LocalChecks(
    registered
      ? {
          contract: {
            executable: process.execPath,
            args: [
              '-e',
              "const fs=require('node:fs');process.exit(fs.readFileSync('contract.txt','utf8')==='OK'?0:7)",
            ],
            timeoutMs: 5000,
            acceptance: true,
            criteria: context.acceptance,
          },
        }
      : {},
    join(root, 'check-logs'),
    root,
  );
  const team = new TeamCoordinator(
    { codex: { provider: 'codex', diagnose, execute }, claude: new DisabledExecutor('claude') },
    join(root, 'settings.json'),
    undefined,
    checks,
    undefined,
    join(root, 'checkpoint.json'),
  );
  const { app, port } = await createHttpServer({
    embedded: false,
    token: 'fixture-hook-token',
    store: new AgentStateStore(),
    team,
  });
  apps.push(app);
  const headers = { host: `127.0.0.1:${port}` };
  const state = () => app.inject({ url: '/api/team', headers });
  const initial = await state();
  const controlToken = initial.json().controlToken as string;
  const post = (route: string, payload: object = {}) =>
    app.inject({
      method: 'POST',
      url: `/api/team/${route}`,
      headers: { ...headers, 'x-office-control': controlToken },
      payload,
    });
  const add = () =>
    post('tasks', {
      project: root,
      role: 'developer',
      title: 'Comprobar contrato',
      prompt: 'Verifica el contrato sin editar',
      context,
    });
  const settled = async () => {
    await vi.waitFor(() => expect(team.snapshot().running).toBe(false));
    return (await state()).json<TeamSnapshot>();
  };
  return { app, team, state, post, add, settled, execute, diagnose, controlToken };
}

describe('project context and checks across the local HTTP restart boundary', () => {
  it('recovers project, instructions and selected checks paused, without model calls', async () => {
    const root = fixture();
    const first = await open(root);
    const added = await first.add();
    expect(added.statusCode).toBe(200);
    const task = added.json<TeamSnapshot>().tasks[0];
    await first.app.close();

    const restored = await open(root);
    const state = (await restored.state()).json<TeamSnapshot>();
    expect(state.tasks[0]).toMatchObject({
      id: task.id,
      project: realpathSync(root),
      title: task.title,
      prompt: task.prompt,
      context,
      status: 'paused',
      reasonCode: 'server_restarted',
      approved: false,
      choice: null,
    });
    expect(state.capabilities?.checks).toEqual([{ id: 'contract', acceptance: true }]);
    expect(state.tasks[0].localChecks).toBeUndefined();
    expect(state.running).toBe(false);
    expect(restored.controlToken).not.toBe(first.controlToken);
    expect(restored.execute).not.toHaveBeenCalled();
    expect(restored.diagnose).not.toHaveBeenCalled();
  });

  it.each([
    ['OK', 'completed', 0],
    ['BROKEN', 'blocked', 7],
  ] as const)(
    'executes actual checks for %s and preserves their results and usage after restart',
    async (content, status, exitCode) => {
      const root = fixture();
      writeFileSync(join(root, 'contract.txt'), content);
      const first = await open(root);
      expect((await first.add()).statusCode).toBe(200);
      expect((await first.post('start')).statusCode).toBe(200);
      const result = await first.settled();
      expect(result.tasks[0]).toMatchObject({
        status,
        localChecks: [{ id: 'contract', exitCode, passed: exitCode === 0 }],
      });
      if (status === 'blocked') expect(result.tasks[0].reasonCode).toBe('local_checks_failed');
      expect(first.execute).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ runsUsed: 1, tokensUsed: 24 });
      await first.app.close();

      const restored = await open(root);
      const state = (await restored.state()).json<TeamSnapshot>();
      expect(state.tasks[0].project).toBe(realpathSync(root));
      expect(state.tasks[0].context).toEqual(context);
      expect(state.tasks[0].localChecks).toEqual(result.tasks[0].localChecks);
      expect(state.tasks[0].status).toBe(status === 'completed' ? 'completed' : 'paused');
      expect(state).toMatchObject({ runsUsed: 1, tokensUsed: 24, running: false });
      expect(restored.execute).not.toHaveBeenCalled();
    },
  );

  it('blocks a pending task when its check is no longer configured after restart', async () => {
    const root = fixture();
    const first = await open(root);
    await first.add();
    await first.app.close();
    const restored = await open(root, false);
    expect((await restored.post('resume')).statusCode).toBe(200);
    expect((await restored.post('start')).statusCode).toBe(200);
    const state = await restored.settled();
    expect(state.tasks[0]).toMatchObject({ status: 'blocked', reasonCode: 'check_unconfigured' });
    expect(restored.execute).not.toHaveBeenCalled();
  });

  it('preserves a corrupt checkpoint and reports the recovery block through HTTP', async () => {
    const root = fixture();
    writeFileSync(join(root, 'checkpoint.json'), 'CORRUPT');
    const restored = await open(root);
    expect((await restored.state()).json().budgetReason).toBe('checkpoint_invalid');
    expect((await restored.post('resume')).statusCode).toBe(409);
    expect(readFileSync(join(root, 'checkpoint.json'), 'utf8')).toBe('CORRUPT');
    expect(restored.execute).not.toHaveBeenCalled();
  });
});
