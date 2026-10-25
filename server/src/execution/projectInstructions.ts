import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';

import { ExecutionBlocked } from './types.js';

function guides(directory: string): Array<{ file: string; text: string }> {
  let root = directory;
  try {
    root = realpathSync(
      execFileSync('git', ['-C', directory, 'rev-parse', '--show-toplevel'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim(),
    );
  } catch {
    /* Without a Git root, Codex only discovers the current directory. */
  }
  const rel = relative(root, directory);
  if (rel.startsWith('..') || isAbsolute(rel)) root = directory;
  const chain = [directory];
  while (relative(root, chain[0]) !== '') chain.unshift(dirname(chain[0]));
  const result: Array<{ file: string; text: string }> = [];
  let bytes = 0;
  for (const folder of chain) {
    for (const name of ['AGENTS.override.md', 'AGENTS.md']) {
      const file = join(folder, name);
      let stat;
      try {
        stat = lstatSync(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      if (!stat.isFile() || stat.size > 32_768)
        throw new ExecutionBlocked(
          'project_instructions_unreadable',
          'Revisa las instrucciones AGENTS del proyecto: deben ser archivos locales de hasta 32 KiB.',
        );
      const text = readFileSync(file, 'utf8');
      if (!text.trim()) continue;
      bytes += Buffer.byteLength(text);
      if (bytes > 32_768)
        throw new ExecutionBlocked(
          'project_instructions_too_large',
          'Las instrucciones AGENTS superan 32 KiB. Revísalas antes de ejecutar para evitar perder reglas.',
        );
      result.push({ file, text });
      break;
    }
  }
  return result;
}

/** Native discovery handles normal runs. Only hand off guidance lost by isolation. */
export function isolatedProjectInstructions(project: string, workspace: string): string {
  project = realpathSync(project);
  workspace = realpathSync(workspace);
  if (project === workspace) return '';
  const native = new Set(guides(workspace).map((guide) => guide.text));
  const missing = guides(project).filter((guide) => !native.has(guide.text));
  if (!missing.length) return '';
  return (
    'Instrucciones aplicables del proyecto original que no están en esta copia aislada. Respeta su orden y alcance; complementan las instrucciones que Codex carga normalmente.\n' +
    missing
      .map(
        (guide) =>
          `# AGENTS.md instructions for ${dirname(guide.file)}\n<INSTRUCTIONS>\n${guide.text}\n</INSTRUCTIONS>`,
      )
      .join('\n\n') +
    '\n\n'
  );
}
