import { existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { captureRevision, type FileRevision } from './reviewPacket.js';
import { captureFiles, gitFileNames } from './revisionStore.js';
import { ExecutionBlocked } from './types.js';

// Dependencies, credentials, VCS metadata and local runtime state are outside the source review.
const excludedDirectories = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  '.vscode-test',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.local-office',
  'allure-results',
  'allure-report',
  'playwright-report',
  'test-results',
  'coverage',
  '.next',
  '.nuxt',
  '.cache',
  'dist',
  'out',
]);
const excludedFile = (name: string) =>
  (name === '.env' || name.startsWith('.env.')) &&
  !['.env.example', '.env.sample', '.env.template'].includes(name);

/** Content snapshots for ordinary folders. Never creates or changes a repository. */
export function captureDirectoryRevision(project: string): FileRevision {
  const root = realpathSync(project);
  const names: string[] = [];
  const visit = (directory: string, depth: number) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (excludedDirectories.has(entry.name) || excludedFile(entry.name)) continue;
      const file = join(directory, entry.name);
      if (
        relative(root, file)
          .replaceAll('\\', '/')
          .split('/')
          .some((part, i, parts) => part === 'generated_images' && parts[i - 1] === '.codex')
      )
        continue;
      const stat = lstatSync(file);
      if (stat.isSymbolicLink())
        throw new ExecutionBlocked(
          'review_symlink',
          'Un enlace necesita revisión antes de inspeccionar archivos fuera del proyecto.',
        );
      if (stat.isDirectory() && existsSync(join(file, '.git'))) {
        // A folder can contain existing repositories. Respect their tracked files
        // and ignore rules instead of copying their generated artifacts as source.
        let repositoryNames: string[];
        try {
          repositoryNames = gitFileNames(file);
        } catch {
          throw new ExecutionBlocked(
            'review_git_unreadable',
            'No se puede verificar un repositorio dentro de la carpeta del proyecto.',
          );
        }
        for (const name of repositoryNames) {
          if (
            name
              .split('/')
              .some(
                (part, i, parts) =>
                  excludedDirectories.has(part) ||
                  excludedFile(part) ||
                  (part === 'generated_images' && parts[i - 1] === '.codex'),
              )
          )
            continue;
          const nested = join(file, name);
          let nestedStat;
          try {
            nestedStat = lstatSync(nested);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
            throw error;
          }
          if (nestedStat.isSymbolicLink())
            throw new ExecutionBlocked(
              'review_symlink',
              'Un enlace necesita revisión antes de inspeccionar archivos fuera del proyecto.',
            );
          if (nestedStat.isFile()) names.push(relative(root, nested).replaceAll('\\', '/'));
        }
      } else if (stat.isDirectory()) visit(file, depth + 1);
      else if (stat.isFile()) {
        names.push(relative(root, file).replaceAll('\\', '/'));
      }
    }
  };
  try {
    visit(root, 0);
    return captureFiles(root, names);
  } catch (error) {
    if (error instanceof ExecutionBlocked) throw error;
    throw new ExecutionBlocked(
      'review_file_unreadable',
      'No se ha podido leer la carpeta completa para revisar sus cambios.',
    );
  }
}

/** Freeze the capture method for this objective, even if tools initialize Git later. */
export function projectRevisionCapture(project: string): () => FileRevision {
  const root = realpathSync(project);
  try {
    gitFileNames(root);
    return () => captureRevision(root);
  } catch (error) {
    // An existing broken repository must not silently become a directory review.
    for (let directory = root; ; directory = dirname(directory)) {
      if (existsSync(join(directory, '.git')))
        throw new ExecutionBlocked(
          'review_git_required',
          'La revisión por cambios necesita un repositorio Git verificable.',
        );
      if (dirname(directory) === directory) break;
    }
    if (error instanceof ExecutionBlocked) throw error;
    return () => captureDirectoryRevision(root);
  }
}
