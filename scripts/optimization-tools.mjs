import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export function sourceFingerprint() {
  const hash = createHash('sha256');
  function visit(relative) {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (
        ['node_modules', 'dist', 'allure-results', 'allure-report', 'test-results'].includes(
          entry.name,
        )
      )
        continue;
      const file = join(relative, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.(ts|tsx|mjs|cjs|json)$/.test(file))
        hash.update(file).update(readFileSync(join(root, file)));
    }
  }
  for (const dir of [
    'server/src',
    'server/__tests__',
    'core/src',
    'webview-ui/src',
    'webview-ui/test',
    'scripts',
  ])
    visit(dir);
  for (const file of [
    'package.json',
    'package-lock.json',
    'AGENTS.md',
    'reports/contexto/casos-clasificacion.json',
  ])
    hash.update(file).update(readFileSync(join(root, file)));
  return hash.digest('hex');
}
export async function loadTools() {
  const destination = join(root, '.local-office/optimization/tools.cjs');
  mkdirSync(dirname(destination), { recursive: true });
  await build({
    stdin: {
      contents: [
        'export * from "./server/src/execution/taskContext.ts";',
        'export * from "./server/src/execution/taskAssessment.ts";',
        'export * from "./server/src/execution/localChecks.ts";',
        'export * from "./server/src/execution/codexExecutor.ts";',
        'export * from "./server/src/execution/orchestratorExecutor.ts";',
        'export * from "./server/src/execution/cliProcess.ts";',
        'export * from "./server/src/execution/teamCoordinator.ts";',
        'export * from "./server/src/execution/optionalExecutors.ts";',
        'export * from "./server/src/execution/taskOutcome.ts";',
      ].join('\n'),
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: destination,
  });
  return createRequire(import.meta.url)(destination);
}
