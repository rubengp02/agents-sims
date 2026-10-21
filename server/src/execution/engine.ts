import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CodexExecutor } from './codexExecutor.js';
import { OrchestratorExecutor } from './orchestratorExecutor.js';
import { ExecutionBlocked, type OfficialExecutor } from './types.js';

export function createOfficeExecutor(root: string, stateDir: string): OfficialExecutor {
  const file = join(root, 'office.config.json');
  const engine: unknown = existsSync(file)
    ? JSON.parse(readFileSync(file, 'utf8')).engine
    : undefined;
  if (engine === 'agent-orchestrator') return new OrchestratorExecutor(root, stateDir);
  if (engine === undefined || engine === 'codex-cli') return new CodexExecutor(stateDir);
  throw new ExecutionBlocked(
    'engine_unknown',
    'El motor configurado no está disponible. No se ha utilizado una alternativa.',
  );
}
