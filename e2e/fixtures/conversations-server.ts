import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { AgentStateStore } from '../../server/src/agentStateStore.js';
import { buildAssetCache } from '../../server/src/assetReload.js';
import { ConversationLibrary } from '../../server/src/execution/conversationLibrary.js';
import { DisabledExecutor } from '../../server/src/execution/optionalExecutors.js';
import { TeamCoordinator } from '../../server/src/execution/teamCoordinator.js';
import type { OfficialExecutor } from '../../server/src/execution/types.js';
import { createHttpServer } from '../../server/src/httpServer.js';

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
  let runs = 0;
  const executor: OfficialExecutor = {
    provider: 'codex',
    diagnose: async () => ({
      checkedAt: Date.now(),
      plan: 'plus',
      quota: [],
      models: [{ id: 'gpt-6.1-sol', efforts: ['low', 'medium', 'high'] }],
    }),
    execute: async (options) => {
      runs++;
      writeFileSync(path.join(root, 'runs.txt'), String(runs));
      const text = options.prompt.includes('Segunda pregunta')
        ? options.prompt.includes('Respuesta guardada de la primera pregunta') &&
          options.prompt.includes('Conserva mis instrucciones')
          ? 'Seguimiento con contexto conservado'
          : 'CONTEXTO_PERDIDO'
        : 'Respuesta guardada de la primera pregunta';
      options.onOutput?.(text + '\nOFFICE_RESULT {"status":"completed"}');
      return {
        version: 1,
        id: `fixture-${runs}`,
        provider: 'codex',
        billing: 'subscription-only',
        status: 'completed',
        project: options.project,
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
    },
  };
  const team = new TeamCoordinator(
    { codex: executor, claude: new DisabledExecutor('claude') },
    path.join(root, 'settings.json'),
    undefined,
    undefined,
    undefined,
    path.join(root, 'checkpoint.json'),
    undefined,
    new ConversationLibrary(path.join(root, 'library')),
  );
  const dist = path.resolve(__dirname, '../../dist');
  const { app, port } = await createHttpServer({
    embedded: false,
    token: 'fixture-only',
    store,
    team,
    staticDir: path.join(dist, 'webview'),
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
