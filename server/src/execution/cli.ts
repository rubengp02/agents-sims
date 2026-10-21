import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { ClaudeExecutor } from './claudeExecutor.js';
import { CodexExecutor } from './codexExecutor.js';
import { DisabledExecutor } from './optionalExecutors.js';
import { ExecutionBlocked, type OfficialExecutor } from './types.js';

export function parseExecutionArgs(args: string[]): {
  action: string;
  flags: Record<string, string | boolean>;
} {
  const [action = 'check', ...rest] = args;
  if (!['check', 'run'].includes(action))
    throw new ExecutionBlocked('invalid_arguments', 'Usa check o run.');
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < rest.length; index++) {
    const name = rest[index];
    if (
      !['--project', '--task-file', '--model', '--effort', '--provider', '--write'].includes(
        name,
      ) ||
      name in flags
    )
      throw new ExecutionBlocked('invalid_arguments', 'Argumento desconocido o repetido.');
    if (name === '--write') flags[name] = true;
    else {
      const value = rest[++index];
      if (!value || value.startsWith('--'))
        throw new ExecutionBlocked('invalid_arguments', 'Falta un valor de configuración.');
      flags[name] = value;
    }
  }
  return { action, flags };
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const { action, flags } = parseExecutionArgs(args);
  const provider = flags['--provider'] ?? 'codex';
  let executor: OfficialExecutor;
  if (provider === 'codex') executor = new CodexExecutor(resolve('.local-office', 'executions'));
  else if (provider === 'claude') executor = new ClaudeExecutor(() => true);
  else if (provider === 'antigravity') executor = new DisabledExecutor(provider);
  else throw new ExecutionBlocked('provider_unknown', 'Proveedor no permitido.');
  if (action === 'check') {
    const evidence = await executor.diagnose();
    console.log(
      `Codex: sesión de ChatGPT ${evidence.plan}. Comprobación actual correcta; sin créditos adicionales comunicados. Cada tarea volverá a verificarse.`,
    );
    console.log('Modelos y razonamientos anunciados:');
    for (const model of evidence.models) console.log(`  ${model.id}: ${model.efforts.join(', ')}`);
    console.log('Claude: desactivado. Antigravity: no implementado.');
    return;
  }
  // Check before asking the user to type a task; execute checks again before start.
  await executor.diagnose();
  let project = typeof flags['--project'] === 'string' ? flags['--project'] : '';
  let prompt =
    typeof flags['--task-file'] === 'string'
      ? readFileSync(resolve(flags['--task-file']), 'utf8')
      : '';
  if ((!project || !prompt) && process.stdin.isTTY) {
    const input = createInterface({ input: process.stdin, output: process.stdout });
    try {
      if (!project)
        project = (await input.question('Carpeta del proyecto (ruta completa): '))
          .trim()
          .replace(/^"(.*)"$/, '$1');
      if (!prompt) prompt = await input.question('Tarea que quieres realizar: ');
    } finally {
      input.close();
    }
  }
  if (!project || !prompt)
    throw new ExecutionBlocked(
      'invalid_task',
      'Indica --project y --task-file, o abre el lanzador interactivo.',
    );
  const abort = new AbortController();
  const cancel = () => abort.abort();
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  try {
    const result = await executor.execute({
      project: resolve(project),
      prompt,
      model: typeof flags['--model'] === 'string' ? flags['--model'] : undefined,
      effort: typeof flags['--effort'] === 'string' ? flags['--effort'] : undefined,
      allowWrites: flags['--write'] === true,
      signal: abort.signal,
      onOutput: (text) => console.log(text),
      onState: (state) =>
        console.log(
          `[${state.status}] ${state.reasonCode ?? state.requestedModel + ' · ' + state.requestedEffort}`,
        ),
    });
    console.log(
      `Registro local: ${result.id}. Modelo confirmado por el CLI: ${result.confirmedModel ?? 'no comunicado'}.`,
    );
    if (result.status !== 'completed') process.exitCode = 2;
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(
      error instanceof ExecutionBlocked
        ? `${error.code}: ${error.message}`
        : 'No se pudo completar la operación. No se ha habilitado ninguna alternativa de pago.',
    );
    process.exitCode = 2;
  });
