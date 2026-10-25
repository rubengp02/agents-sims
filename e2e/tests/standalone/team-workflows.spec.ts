import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { AgentStateStore } from '../../../server/src/agentStateStore.js';
import { buildAssetCache } from '../../../server/src/assetReload.js';
import { AdaptiveRuntime } from '../../../server/src/execution/adaptiveRuntime.js';
import { LocalChecks } from '../../../server/src/execution/localChecks.js';
import { DisabledExecutor } from '../../../server/src/execution/optionalExecutors.js';
import { TeamCoordinator } from '../../../server/src/execution/teamCoordinator.js';
import type { OfficialExecutor, RunRecord } from '../../../server/src/execution/types.js';
import { UsageHistory } from '../../../server/src/execution/usageHistory.js';
import { WorkflowWorkspaceManager } from '../../../server/src/execution/workflowWorkspace.js';
import { createHttpServer } from '../../../server/src/httpServer.js';

/** Browser + real local API/Git/checks, entirely simulated provider and subscription. */
test('visual controls prepare, reserve, integrate and recover an experimental workflow @area:standalone', async ({
  page,
}, testInfo) => {
  const root = mkdtempSync(path.join(tmpdir(), 'pixel-team-workflows-'));
  const project = path.join(root, 'repo');
  const managed = path.join(root, 'spaces');
  mkdirSync(project);
  mkdirSync(managed);
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: project, windowsHide: true, stdio: 'pipe' });
  git(['init', '--initial-branch=main']);
  git(['config', 'core.autocrlf', 'false']);
  for (const name of ['a', 'b'])
    writeFileSync(path.join(project, `${name}.mjs`), `export const ${name}=0;\n`);
  git(['add', '.']);
  git([
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-m',
    'base',
  ]);
  const manager = new WorkflowWorkspaceManager(
    managed,
    path.join(root, 'evidence'),
    async (_project, id, base) => {
      const target = path.join(managed, id);
      git(['worktree', 'add', '--detach', target, base]);
      return target;
    },
  );
  const checks = new LocalChecks(
    Object.fromEntries(
      ['a', 'b', 'joint'].map((id) => [
        id,
        {
          executable: process.execPath,
          args: [
            '--input-type=module',
            '-e',
            id === 'joint'
              ? "import {a} from './a.mjs';import {b} from './b.mjs';if(a+b!==3)process.exit(1)"
              : `import {${id}} from './${id}.mjs';if(${id}!==${id === 'a' ? 1 : 2})process.exit(1)`,
          ],
          timeoutMs: 5000,
          acceptance: id === 'joint',
          criteria: ['a', 'b'],
        },
      ]),
    ),
    path.join(root, 'logs'),
    project,
  );
  let runs = 0;
  const executor: OfficialExecutor = {
    provider: 'codex',
    engine: 'agent-orchestrator',
    workspaceManager: manager,
    maxConcurrentReadOnly: 2,
    diagnose: async () => ({
      checkedAt: Date.now(),
      plan: 'plus',
      quota: [],
      models: [{ id: 'gpt-6.1-sol', efforts: ['low'] }],
    }),
    execute: async (options) => {
      runs++;
      const record: RunRecord = {
        version: 1,
        id: `fixture-${runs}`,
        provider: 'codex',
        billing: 'subscription-only',
        status: 'running',
        project,
        requestedModel: options.model!,
        requestedEffort: options.effort!,
        confirmedModel: null,
        sessionId: `session-${runs}`,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        reasonCode: null,
        inputTokens: 100,
        outputTokens: 10,
      };
      options.onState?.(record);
      await new Promise((r) => setTimeout(r, 250));
      const name = options.prompt.includes('Implementa a') ? 'a' : 'b';
      expect(options.ownedWorkspace).toBeTruthy();
      writeFileSync(
        path.join(options.ownedWorkspace!.path, `${name}.mjs`),
        `export const ${name}=${name === 'a' ? 1 : 2};\n`,
      );
      options.onOutput?.('OFFICE_RESULT {"status":"completed"}');
      record.status = 'completed';
      record.updatedAt = Date.now();
      options.onState?.(record);
      return record;
    },
  };
  const checkpoint = path.join(root, 'checkpoint.json');
  const runtime = new AdaptiveRuntime(
    new UsageHistory(path.join(root, 'history.json')),
    path.join(root, 'artifacts'),
  );
  const team = new TeamCoordinator(
    { codex: executor, claude: new DisabledExecutor('claude') },
    undefined,
    undefined,
    checks,
    undefined,
    checkpoint,
    runtime,
  );
  team.configure({
    mode: 'auto',
    claudeEnabled: false,
    maxParallel: 2,
    maxRuns: 8,
    maxMinutes: 2,
    maxTokens: 10000,
  });
  const dist = path.resolve(__dirname, '../../../dist');
  const assetCache = await buildAssetCache(dist, []);
  const open = (coordinator: TeamCoordinator) =>
    createHttpServer({
      embedded: false,
      token: 'fixture-hook-token',
      store: new AgentStateStore(),
      team: coordinator,
      staticDir: path.join(dist, 'webview'),
      assetCache,
    });
  let server = await open(team);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`http://127.0.0.1:${server.port}`);
    await page.getByRole('button', { name: 'Conversaciones', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Equipo de agentes' });
    await panel
      .getByText('Organización del trabajo · un Programador por defecto', { exact: true })
      .click();
    const experiment = panel.getByRole('checkbox', {
      name: 'Activar dos Programadores experimentales',
    });
    await expect(experiment).not.toBeChecked();
    // This controlled setting is confirmed by the server asynchronously.
    await experiment.click();
    await expect.poll(() => team.snapshot().settings.experimentalParallelWriters).toBe(true);
    await expect(experiment).toBeChecked();
    expect(runs).toBe(0);
    await panel.getByLabel('Carpeta del proyecto', { exact: true }).fill(project);
    await panel.getByLabel('Objetivo o tarea').fill('Implementa dos utilidades independientes');
    await panel
      .getByRole('checkbox', {
        name: 'Permitir cambios en archivos (para el Programador del plan)',
      })
      .check();
    await panel.getByText('Encargo acotado y reparto de archivos', { exact: true }).click();
    await panel
      .getByLabel('Archivos relevantes (rutas relativas)', { exact: true })
      .fill('a.mjs\nb.mjs');
    await panel.getByLabel('Criterios de aceptación del conjunto', { exact: true }).fill('a\nb');
    for (const id of ['a', 'b', 'joint'])
      await panel
        .getByRole('checkbox', { name: `Incluir ${id} en el conjunto`, exact: true })
        .check();
    await panel.getByLabel('Módulos afectados').fill('utils');
    await panel.getByLabel('Riesgo del encargo', { exact: true }).selectOption('low');
    await panel.getByLabel('Incertidumbre del encargo', { exact: true }).selectOption('low');
    await panel.getByLabel('Pruebas disponibles', { exact: true }).selectOption('available');
    await panel.getByRole('checkbox', { name: 'Proponer dos partes independientes' }).check();
    for (const [i, name] of ['a', 'b'].entries()) {
      await panel
        .getByLabel(`Objetivo del Programador ${i + 1}`, { exact: true })
        .fill(`Implementa ${name}`);
      await panel
        .getByLabel(`Archivos propios del Programador ${i + 1}`, { exact: true })
        .fill(`${name}.mjs`);
      await panel
        .getByLabel(`Criterios de aceptación del Programador ${i + 1}`, { exact: true })
        .fill(name);
      await panel
        .getByRole('checkbox', { name: `Incluir ${name} en el Programador ${i + 1}`, exact: true })
        .check();
    }
    // A contract cannot invent acceptance or bypass the server's validation.
    await panel
      .getByLabel('Criterios de aceptación del Programador 1', { exact: true })
      .fill('inventado');
    await panel.getByRole('button', { name: 'Preparar encargo sin IA' }).click();
    await expect(panel.getByRole('alert')).toContainText('La subtarea altera');
    expect(team.snapshot().tasks).toHaveLength(0);
    expect(runs).toBe(0);
    await panel.getByLabel('Criterios de aceptación del Programador 1', { exact: true }).fill('a');
    await panel.getByRole('button', { name: 'Preparar encargo sin IA' }).click();
    const flow = panel.getByRole('article', {
      name: 'Flujo: Implementa dos utilidades independientes',
      exact: true,
    });
    await expect(flow).toBeVisible();
    expect(runs).toBe(0);
    expect(team.snapshot().tasks).toHaveLength(2);
    for (const name of ['a', 'b']) {
      const card = panel.getByRole('article', {
        name: `Programador: Programador ${name === 'a' ? 1 : 2}: Implementa ${name}`,
        exact: true,
      });
      await card.getByRole('button', { name: 'Comprobar asignación', exact: true }).click();
      await card.getByText('Estimación y reserva de la tarea', { exact: true }).click();
      await card.getByLabel('Cota de tokens de la tarea', { exact: true }).fill('1000');
      await card.getByLabel('Cota de duración de la tarea (segundos)', { exact: true }).fill('10');
      await card.getByLabel('Máximo de caracteres del contexto', { exact: true }).fill('12000');
      if (name === 'a') {
        await card.getByLabel('Cota de tokens de la tarea', { exact: true }).fill('10001');
        await card.getByRole('button', { name: 'Guardar cotas revisadas', exact: true }).click();
        expect(team.snapshot().tasks[0].budgetReview).toBeUndefined();
        expect(runs).toBe(0);
        await card.getByLabel('Cota de tokens de la tarea', { exact: true }).fill('1000');
      }
      await card.getByRole('button', { name: 'Guardar cotas revisadas', exact: true }).click();
      await expect(card.getByRole('status')).toHaveText('Cotas guardadas.');
    }
    await flow.getByText('Revisar coste de preparación e integración', { exact: true }).click();
    await flow.getByLabel('Preparación de espacios (segundos)', { exact: true }).fill('10');
    await flow.getByLabel('Integración y comprobaciones (segundos)', { exact: true }).fill('10');
    await flow.getByLabel('Alternativa secuencial completa (segundos)', { exact: true }).fill('40');
    await flow.getByRole('button', { name: 'Guardar cotas revisadas', exact: true }).click();
    await expect(flow.getByRole('status')).toHaveText('Cotas guardadas.');
    expect(runs).toBe(0);
    expect(team.snapshot().settings.maxTokens).toBe(10000);
    await panel.getByRole('button', { name: 'Ejecutar cola', exact: true }).click();
    // Real Git workspaces and local integration checks can exceed the default
    // five-second assertion window, while remaining inside the reviewed budgets.
    await expect(flow.getByText('Estado del conjunto: Aceptado', { exact: true })).toBeVisible({
      timeout: 20000,
    });
    await expect(flow.getByRole('list', { name: 'Comprobaciones del conjunto' })).toContainText(
      'joint: Superada',
    );
    expect(runs).toBe(2);
    const candidate = team.snapshot().workflows![0];
    expect(readFileSync(path.join(project, 'a.mjs'), 'utf8')).toContain('=0');
    expect(readFileSync(path.join(candidate.candidateProject!, 'a.mjs'), 'utf8')).toContain('=1');
    await page.screenshot({ path: testInfo.outputPath('flujo-integrado.png') });
    // Restoring old acceptance must visibly require recovery, with no bypass button.
    await server.app.close();
    const restored = new TeamCoordinator(
      { codex: executor, claude: new DisabledExecutor('claude') },
      undefined,
      undefined,
      checks,
      undefined,
      checkpoint,
      runtime,
    );
    server = await open(restored);
    await page.goto(`http://127.0.0.1:${server.port}`);
    await page.getByRole('button', { name: 'Conversaciones', exact: true }).click();
    await expect(
      panel.getByText('Estado del conjunto: En pausa: requiere revisión', { exact: true }),
    ).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Revisado: permitir continuar' })).toHaveCount(
      0,
    );
    expect(runs).toBe(2);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(panel).toBeVisible();
    const bounds = await panel.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.width).toBeLessThanOrEqual(390);
    await panel
      .getByText('Estado del conjunto: En pausa: requiere revisión', { exact: true })
      .scrollIntoViewIfNeeded();
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath('flujo-recuperado-mobile.png') });
    expect(errors).toEqual([]);
  } finally {
    await server.app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
