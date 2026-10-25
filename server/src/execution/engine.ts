import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type AppServerDependencies, CodexAppServerExecutor } from './codexAppServerExecutor.js';
import { CodexExecutor } from './codexExecutor.js';
import { OrchestratorExecutor } from './orchestratorExecutor.js';
import { ExecutionBlocked, type OfficialExecutor } from './types.js';

export function createOfficeExecutor(
  root: string,
  stateDir: string,
  dependencies?: AppServerDependencies,
): OfficialExecutor {
  const file = join(root, 'office.config.json');
  const engine: unknown = existsSync(file)
    ? JSON.parse(readFileSync(file, 'utf8')).engine
    : undefined;
  if (engine === 'agent-orchestrator') return new OrchestratorExecutor(root, stateDir);
  if (engine === 'codex-cli') return new CodexExecutor(stateDir);
  if (engine === undefined || engine === 'codex-app-server')
    return new CodexAppServerExecutor(stateDir, dependencies);
  throw new ExecutionBlocked(
    'engine_unknown',
    'El motor configurado no está disponible. No se ha utilizado una alternativa.',
  );
}
