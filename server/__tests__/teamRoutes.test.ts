import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import { DisabledExecutor } from '../src/execution/optionalExecutors.js';
import { TeamCoordinator } from '../src/execution/teamCoordinator.js';
import { DEFAULT_TEAM_SETTINGS } from '../src/execution/teamPolicy.js';
import type { OfficialExecutor } from '../src/execution/types.js';
import { createHttpServer } from '../src/httpServer.js';

const apps: FastifyInstance[] = [],
  roots: string[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }));
});

async function harness() {
  const root = mkdtempSync(join(tmpdir(), 'pixel-team-http-'));
  roots.push(root);
  const execute = vi.fn();
  const codex: OfficialExecutor = {
    provider: 'codex',
    diagnose: async () => ({
      checkedAt: Date.now(),
      plan: 'plus',
      quota: [],
      models: [{ id: 'gpt-6.1-sol', efforts: ['low'] }],
    }),
    execute,
  };
  const team = new TeamCoordinator({ codex, claude: new DisabledExecutor('claude') });
  const { app, port } = await createHttpServer({
    embedded: false,
    token: 'unrelated-hook-token',
    store: new AgentStateStore(),
    team,
  });
  apps.push(app);
  const headers = { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` };
  const state = await app.inject({ url: '/api/team', headers });
  const control = { ...headers, 'x-office-control': state.json().controlToken };
  return { app, root, team, headers, control, execute };
}

describe('local team HTTP control', () => {
  it('protects decomposition and integration-budget routes with the same local control nonce', async () => {
    const h = await harness();
    for (const url of ['/api/team/scope', '/api/team/workflow-budget-review']) {
      const response = await h.app.inject({ method: 'POST', url, headers: h.headers, payload: {} });
      expect(response.statusCode).toBe(403);
    }
    const result = await h.app.inject({
      method: 'POST',
      url: '/api/team/workflow-budget-review',
      headers: h.control,
      payload: { id: 'unknown', preparationMs: 1000, integrationMs: 1000, sequentialMs: 5000 },
    });
    expect(result.statusCode).toBe(409);
    expect(h.execute).not.toHaveBeenCalled();
  });
  it('opening the office reads state without launching or probing models', async () => {
    const h = await harness();
    const response = await h.app.inject({ url: '/api/team', headers: h.headers });
    expect(response.statusCode).toBe(200);
    expect(response.json().settings.mode).toBe('auto');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(h.execute).not.toHaveBeenCalled();
  });
  it('requires a local control nonce for every mutation', async () => {
    const h = await harness();
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/team/settings',
      headers: h.headers,
      payload: { ...DEFAULT_TEAM_SETTINGS, claudeEnabled: true },
    });
    expect(response.statusCode).toBe(403);
    expect(h.team.snapshot().settings.claudeEnabled).toBe(false);
  });
  it.each([
    { host: 'attacker.invalid' },
    { origin: 'https://attacker.invalid' },
    { 'sec-fetch-site': 'cross-site' },
  ])('rejects cross-origin or rebound hosts before revealing control state: %j', async (extra) => {
    const h = await harness();
    const response = await h.app.inject({ url: '/api/team', headers: { ...h.headers, ...extra } });
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain('controlToken');
  });
  it('validates task dependencies and paths; adds a real pending task without inference', async () => {
    const h = await harness();
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/team/tasks',
      headers: h.control,
      payload: { role: 'tester', title: 'Verificar', prompt: 'Lista archivos', project: h.root },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().tasks[0].status).toBe('planned');
    const invalid = await h.app.inject({
      method: 'POST',
      url: '/api/team/tasks',
      headers: h.control,
      payload: {
        role: 'tester',
        title: 'Mal',
        prompt: 'x',
        project: h.root,
        dependsOn: ['missing'],
      },
    });
    expect(invalid.statusCode).toBe(409);
    expect(h.execute).not.toHaveBeenCalled();
  });
  it('never allows an Antigravity provider through a manual override', async () => {
    const h = await harness();
    const task = h.team.addTask({ role: 'tester', title: 'x', prompt: 'x', project: h.root });
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/team/override',
      headers: h.control,
      payload: { id: task.id, choice: { provider: 'antigravity', model: 'x', effort: 'low' } },
    });
    expect(response.statusCode).toBe(409);
    expect(h.execute).not.toHaveBeenCalled();
  });
  it('checks availability independently and reports Claude disabled', async () => {
    const h = await harness();
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/team/check',
      headers: h.control,
    });
    expect(
      response
        .json()
        .providers.find((provider: { provider: string }) => provider.provider === 'claude')
        .reasonCode,
    ).toBe('claude_disabled');
    expect(h.execute).not.toHaveBeenCalled();
  });
  it('stops owned work before acknowledging shutdown and rejects subsequent execution', async () => {
    const h = await harness();
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/team/shutdown',
      headers: h.control,
    });
    expect(response.json()).toEqual({ stopped: true });
    const start = await h.app.inject({
      method: 'POST',
      url: '/api/team/start',
      headers: h.control,
    });
    expect(start.statusCode).toBe(409);
    expect(start.json().code).toBe('server_stopped');
    expect(h.execute).not.toHaveBeenCalled();
  });
  it('rejects a remote peer even with forged local Host and Origin', async () => {
    const h = await harness();
    const response = await h.app.inject({
      url: '/api/team',
      remoteAddress: '192.0.2.10',
      headers: h.headers,
    });
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain('controlToken');
  });
});
