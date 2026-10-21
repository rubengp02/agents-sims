import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { AgentStateStore } from '../../../server/src/agentStateStore.js';
import { buildAssetCache } from '../../../server/src/assetReload.js';
import type { AgentRuntime } from '../../../server/src/agentRuntime.js';
import { DisabledExecutor } from '../../../server/src/execution/optionalExecutors.js';
import { TeamCoordinator } from '../../../server/src/execution/teamCoordinator.js';
import { TeamOfficeBridge } from '../../../server/src/execution/teamOfficeBridge.js';
import type { OfficialExecutor, RunRecord } from '../../../server/src/execution/types.js';
import { createHttpServer } from '../../../server/src/httpServer.js';

/** Real HTTP/WS/React/canvas, injected deterministic executor. Never a real model. */
test('team plans, assigns, runs dependencies and animates real office messages @area:standalone', async ({
  page,
}, testInfo) => {
  const root = mkdtempSync(path.join(tmpdir(), 'pixel-team-browser-'));
  const store = new AgentStateStore();
  store.setAdapter({
    loadAgents: () => [],
    saveAgents: () => {},
    loadSeats: () => ({}),
    saveSeats: () => {},
    getSetting: (_key, fallback) => fallback,
    setSetting: () => {},
  });
  const runtime = { registerAgent: () => {}, unregisterAgent: () => {} } as unknown as AgentRuntime;
  let runs = 0;
  let active = 0;
  let peakActive = 0;
  const completed: string[] = [];
  const executor: OfficialExecutor = {
    provider: 'codex',
    maxConcurrentReadOnly: 2,
    diagnose: async () => ({
      checkedAt: Date.now(),
      plan: 'plus',
      quota: [],
      models: [
        { id: 'gpt-6.1-sol', efforts: ['low', 'high'] },
        { id: 'gpt-6-luna', efforts: ['low'] },
      ],
    }),
    execute: async (options) => {
      runs++;
      active++;
      peakActive = Math.max(peakActive, active);
      if (options.allowWrites) {
        expect(active).toBe(1);
        expect(completed).toContain('Arquitecto');
        expect(completed).toContain('Diseñador');
      }
      if (options.prompt.includes('Tu papel: Tester')) expect(completed).toContain('Programador');
      const record: RunRecord = {
        version: 1,
        id: `fixture-run-${runs}`,
        provider: 'codex',
        billing: 'subscription-only',
        status: 'running',
        project: root,
        requestedModel: options.model!,
        requestedEffort: options.effort!,
        confirmedModel: null,
        sessionId: `fixture-session-${runs}`,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        reasonCode: null,
        inputTokens: 20,
        outputTokens: 4,
      };
      options.onState?.(record);
      options.onActivity?.('reading');
      await new Promise((resolve) => setTimeout(resolve, 250));
      options.onOutput?.(
        options.prompt.includes('Divide el objetivo')
          ? JSON.stringify({
              tasks: [
                {
                  role: 'architect',
                  title: 'Arquitectura de prueba',
                  prompt: 'Analiza la estructura',
                  dependsOn: [],
                  parallelSafe: true,
                },
                {
                  role: 'designer',
                  title: 'Análisis visual de prueba',
                  prompt: 'Analiza la interfaz sin modificarla',
                  dependsOn: [],
                  parallelSafe: true,
                },
                {
                  role: 'developer',
                  title: 'Implementación de prueba',
                  prompt: 'Implementa el cambio autorizado',
                  dependsOn: [0, 1],
                },
                {
                  role: 'tester',
                  title: 'Verificación de prueba',
                  prompt: 'Verifica el cambio',
                  dependsOn: [2],
                },
              ],
            })
          : 'RESULTADO LOCAL DE PRUEBA\nOFFICE_RESULT {"status":"completed"}',
      );
      record.status = 'completed';
      options.onState?.(record);
      active--;
      completed.push(/Tu papel: ([^.]+)/.exec(options.prompt)?.[1] ?? '');
      return record;
    },
  };
  const team = new TeamCoordinator(
    { codex: executor, claude: new DisabledExecutor('claude') },
    undefined,
    new TeamOfficeBridge(store, runtime),
  );
  const dist = path.resolve(__dirname, '../../../dist');
  const { app, port } = await createHttpServer({
    embedded: false,
    token: 'fixture-hook-token',
    store,
    team,
    staticDir: path.join(dist, 'webview'),
    assetCache: await buildAssetCache(dist, []),
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      (window as unknown as { __PIXEL_AGENTS_E2E: boolean }).__PIXEL_AGENTS_E2E = true;
    });
    await page.goto(`http://127.0.0.1:${port}`);
    await page.getByRole('button', { name: 'Equipo', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Equipo de agentes' });
    await expect(panel.getByLabel('Modo de asignación')).toHaveValue('auto');
    await expect(panel.getByText('Habilitar comprobación de Claude')).toBeVisible();
    await page.getByLabel('Carpeta del proyecto', { exact: true }).fill(root);
    await page.getByLabel('Objetivo o tarea').fill('Prepara un cambio pequeño y compruébalo');
    await page
      .getByRole('checkbox', {
        name: 'Permitir cambios en archivos (para el Programador del plan)',
      })
      .check();
    await page.getByRole('button', { name: 'Pedir plan al Jefe · 1 llamada' }).click();
    await expect(panel.getByText('Implementación de prueba', { exact: true })).toBeVisible();
    expect(runs).toBe(1);
    await page.getByRole('button', { name: 'Ejecutar cola', exact: true }).click();
    await expect
      .poll(() => team.snapshot().tasks.filter((task) => task.status === 'completed').length)
      .toBe(5);
    expect(runs).toBe(5);
    expect(peakActive).toBe(2);
    await expect(panel.getByText(/Orden de trabajo:/)).toHaveCount(5);
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            (
              window as unknown as { __pixelAgentsTestHooks?: { getCharacters?: () => unknown[] } }
            ).__pixelAgentsTestHooks?.getCharacters?.().length ?? 0,
        ),
      )
      .toBe(5);
    await page.getByRole('button', { name: 'Mesa de asignaciones' }).click();
    // Verifying changed code without scope evidence is no longer a simple explanation.
    await expect(panel.getByText('Solicitado: codex · gpt-6.1-sol · low')).toHaveCount(5);
    await expect(
      panel.getByText('Modelo confirmado por el CLI: no comunicado').first(),
    ).toBeVisible();
    // The Chief also has a response; DOM order does not identify the Tester.
    const verification = panel.getByRole('article').filter({
      has: page.getByText('Verificación de prueba', { exact: true }),
    });
    await verification.getByText('Ver respuesta', { exact: true }).click();
    await expect(verification.getByText('RESULTADO LOCAL DE PRUEBA')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('equipo-fixture-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(panel).toBeVisible();
    const bounds = await panel.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: testInfo.outputPath('equipo-fixture-mobile.png') });
    await panel.press('Escape');
    await expect(panel).not.toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
