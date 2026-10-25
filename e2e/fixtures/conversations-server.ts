import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { AgentStateStore } from '../../server/src/agentStateStore.js';
import { buildAssetCache } from '../../server/src/assetReload.js';
import { ConversationLibrary } from '../../server/src/execution/conversationLibrary.js';
import { AdaptiveRuntime } from '../../server/src/execution/adaptiveRuntime.js';
import { UsageHistory } from '../../server/src/execution/usageHistory.js';
import { DisabledExecutor } from '../../server/src/execution/optionalExecutors.js';
import { TeamCoordinator } from '../../server/src/execution/teamCoordinator.js';
import type { OfficialExecutor } from '../../server/src/execution/types.js';
import { createHttpServer } from '../../server/src/httpServer.js';
import { OfficeServices } from '../../server/src/tools/officeServices.js';

/** Test-only child process: real server/storage/UI, no inference or hooks. */
async function main() {
  const root = process.argv[2];
  const store = new AgentStateStore();
  store.setAdapter({
    loadAgents: () => [],
    saveAgents: () => {},
    loadSeats: () => ({}),
    saveSeats: () => {},
    getSetting: (_key, fallback) => fallback,
    setSetting: () => {},
  });
  const runCounter = path.join(root, 'runs.txt');
  let runs = existsSync(runCounter) ? Number(readFileSync(runCounter, 'utf8')) : 0;
  let unknownReceiptInjected = false;
  const activeTurns = new Map<string, string[]>();
  const chiefTurns = new Map<string, number>();
  const executor: OfficialExecutor = {
    provider: 'codex',
    executionEvidence: 'simulated',
    engine: 'codex-app-server',
    supportsSteering: true,
    steer: async (key, input) => {
      const instructions = activeTurns.get(key);
      if (!instructions) return { status: 'not_running' };
      instructions.push(input.text);
      writeFileSync(path.join(root, 'release-work.txt'), 'released by simulated steering');
      return { status: 'accepted', turnId: 'fixture-turn' };
    },
    diagnose: async () => ({
      checkedAt: Date.now(),
      plan: 'plus',
      quota: [
        { id: 'codex:primary', usedPercent: 25, resetsAt: Math.floor(Date.now() / 1000) + 3600 },
      ],
      models: [{ id: 'gpt-6.1-sol', efforts: ['low', 'medium', 'high'] }],
    }),
    execute: async (options) => {
      const instructions: string[] = [];
      if (options.executionSessionKey) activeTurns.set(options.executionSessionKey, instructions);
      if (options.prompt.includes('Trabajo lento para comprobar pendientes')) {
        options.onState?.({
          version: 1,
          id: randomUUID(),
          provider: 'codex',
          billing: 'subscription-only',
          status: 'running',
          project: options.project,
          requestedModel: options.model!,
          requestedEffort: options.effort!,
          confirmedModel: options.model!,
          sessionId: 'fixture-active',
          startedAt: Date.now(),
          updatedAt: Date.now(),
          reasonCode: null,
          inputTokens: null,
          outputTokens: null,
        });
        while (!existsSync(path.join(root, 'release-work.txt')) && !options.signal?.aborted)
          await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (options.prompt.includes('Comprueba la captura adjunta')) {
        if (!options.imagePaths?.length || options.imagePaths.some((file) => !existsSync(file)))
          throw new Error('Missing persisted image input');
        writeFileSync(
          path.join(root, 'image-input-verified.txt'),
          'real attachment path provided to simulated executor',
        );
      }
      const unknownReceipt =
        !unknownReceiptInjected && options.prompt.includes('Fallo de prueba sin recibo');
      if (unknownReceipt) unknownReceiptInjected = true;
      runs++;
      writeFileSync(path.join(root, 'runs.txt'), String(runs));
      let text = options.prompt.includes('Segunda pregunta')
        ? options.prompt.includes('Respuesta guardada de la primera pregunta') &&
          options.prompt.includes('Conserva mis instrucciones')
          ? 'Seguimiento con contexto conservado'
          : 'CONTEXTO_PERDIDO'
        : 'Respuesta guardada de la primera pregunta\n\n**Propósito y funcionalidades.** Texto en *cursiva*.\n\n`**texto literal**`';
      if (options.officeRole === 'chief') {
        // Scope the scripted workflow to this objective. Prior conversation text
        // can contain a Tester delivery from another objective and is not evidence.
        const key = options.objectiveSessionKey;
        if (!key) throw new Error('Missing objective-scoped Chief session');
        const turn = chiefTurns.get(key) ?? 0;
        if (!unknownReceipt) chiefTurns.set(key, turn + 1);
        const decision =
          turn >= 2
            ? { action: 'complete', message: 'Objetivo de oficina revisado y terminado' }
            : turn === 1
              ? {
                  action: 'assign',
                  role: 'tester',
                  title: 'Revisa el análisis',
                  task: 'Comprueba las conclusiones',
                  message: 'Verificación independiente',
                }
              : {
                  action: 'assign',
                  role: 'architect',
                  title: 'Analiza el proyecto',
                  task: 'Estudia el contrato',
                  message: 'Necesitamos contexto verificable',
                };
        text = 'OFFICE_DECISION ' + JSON.stringify(decision);
      } else if (options.officeRole === 'architect')
        text = 'Entrega del Arquitecto: contrato investigado';
      else if (options.officeRole === 'tester')
        text = 'Entrega del Tester: conclusiones verificadas\nOFFICE_REVIEW {"findings":[]}';
      if (instructions.length) text += '\nIndicación aplicada: ' + instructions.join('\n');
      if (options.executionSessionKey) activeTurns.delete(options.executionSessionKey);
      options.onOutput?.(
        text + (options.officeRole === 'chief' ? '' : '\nOFFICE_RESULT {"status":"completed"}'),
      );
      return {
        version: 1,
        id: randomUUID(),
        provider: 'codex',
        billing: 'subscription-only',
        status: unknownReceipt ? 'failed' : 'completed',
        project: options.project,
        requestedModel: options.model!,
        requestedEffort: options.effort!,
        confirmedModel: null,
        sessionId: `fixture-session-${runs}`,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        reasonCode: unknownReceipt ? 'cli_failed' : null,
        inputTokens: unknownReceipt ? null : 20,
        outputTokens: unknownReceipt ? null : 4,
      };
    },
  };
  const services = new OfficeServices(
    path.join(root, 'office-tools'),
    path.resolve(__dirname, '../../..'),
  );
  await services.initialize();
  const team = new TeamCoordinator(
    { codex: executor, claude: new DisabledExecutor('claude') },
    path.join(root, 'settings.json'),
    undefined,
    undefined,
    undefined,
    path.join(root, 'checkpoint.json'),
    new AdaptiveRuntime(
      new UsageHistory(path.join(root, 'usage.json')),
      path.join(root, 'artifacts'),
    ),
    new ConversationLibrary(path.join(root, 'library')),
    services,
  );
  const dist = path.resolve(__dirname, '../../dist');
  const { app, port } = await createHttpServer({
    embedded: false,
    token: 'fixture-only',
    store,
    team,
    // Trusted test-runner override permits validating an isolated UI build
    // without replacing the files served by a running personal office.
    staticDir: process.env.PIXEL_OFFICE_TEST_WEBVIEW ?? path.join(dist, 'webview'),
    assetCache: await buildAssetCache(dist, []),
  });
  process.send?.({ port });
  process.on('message', async (message) => {
    if (message === 'stop') {
      await app.close();
      process.exit(0);
    }
  });
}
void main().catch(() => process.exit(1));
