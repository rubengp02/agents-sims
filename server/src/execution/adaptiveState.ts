import { createHash } from 'node:crypto';
import { mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Trusted evidence is outside the repository a coding agent may edit. */
export function adaptiveStateDirectory(project: string): string {
  const key = createHash('sha256').update(realpathSync(project)).digest('hex').slice(0, 32);
  const dir = join(
    process.env.LOCALAPPDATA ?? join(homedir(), '.local', 'share'),
    'AgentsSims',
    'adaptive',
    key,
  );
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return realpathSync(dir);
}
