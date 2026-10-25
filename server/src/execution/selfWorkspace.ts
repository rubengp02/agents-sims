import { createHash, randomUUID } from 'node:crypto';
import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { type FileRevision, gitFileNames, hashFile, revisionFile } from './revisionStore.js';

const excluded = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  '.vscode-test',
  '.local-office',
  '.codex',
  '.venv',
  'venv',
  '__pycache__',
  '.cache',
  '.next',
  '.nuxt',
  'coverage',
  'test-results',
  'playwright-report',
  'allure-results',
  'allure-report',
  'dist',
  'out',
]);
const forbidden = (name: string) =>
  name
    .split('/')
    .some(
      (part, index, parts) =>
        (part === 'generated_images' && parts[index - 1] === '.codex') ||
        excluded.has(part) ||
        (/^\.env(?:\.|$)/i.test(part) && !/^\.env\.(example|sample|template)$/i.test(part)) ||
        /^(credentials|auth|secrets)(?:\.(json|toml|ya?ml|ini))?$/i.test(part) ||
        /^(\.npmrc|\.git-credentials|id_rsa|id_ed25519)$/i.test(part) ||
        /\.(pem|key|pfx|p12)$/i.test(part),
    );
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export interface SelfWorkspaceReceipt {
  version: 1;
  id: string;
  sourceRoot: string;
  workspaceRoot: string;
  receiptPath: string;
  createdAt: string;
  status: 'review_required' | 'integrated';
  previewPort: number;
  base: Record<string, string>;
  integratedPaths: string[];
}
export interface SelfWorkspaceChange {
  path: string;
  kind: 'added' | 'modified' | 'deleted';
}

function safeName(name: string): boolean {
  return (
    !!name &&
    !isAbsolute(name) &&
    !name.includes('\\') &&
    !name.includes(':') &&
    !name.split('/').some((p) => !p || p === '.' || p === '..') &&
    !forbidden(name)
  );
}
function contained(root: string, file: string): boolean {
  const rel = relative(root, file);
  return (
    !!rel &&
    rel !== '..' &&
    !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
    !isAbsolute(rel)
  );
}
/** Reject links in every existing component, including a newly introduced parent. */
function safeFile(root: string, name: string): string {
  if (!safeName(name)) throw new Error('Ruta fuera del alcance de la copia.');
  if (lstatSync(root).isSymbolicLink() || realpathSync(root) !== root)
    throw new Error('La raíz de trabajo ha cambiado.');
  let cursor = root;
  for (const part of name.split('/')) {
    cursor = join(cursor, part);
    if (!contained(root, cursor)) throw new Error('Ruta fuera del alcance de la copia.');
    try {
      if (lstatSync(cursor).isSymbolicLink())
        throw new Error('No se permiten enlaces en la copia de trabajo.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return cursor;
}
function fileBytes(root: string, name: string): Buffer | undefined {
  const file = safeFile(root, name);
  if (!existsSync(file)) return undefined;
  if (!lstatSync(file).isFile()) throw new Error('Un archivo fue sustituido por una carpeta.');
  return readFileSync(file);
}
function names(root: string, useGit: boolean): string[] {
  if (useGit) {
    try {
      return [...new Set(gitFileNames(root).filter((name) => safeName(name)))].sort();
    } catch {
      // Ordinary folders have no repository. A broken existing repository must fail closed.
      for (let cursor = root; ; cursor = dirname(cursor)) {
        if (existsSync(join(cursor, '.git')))
          throw new Error('No se puede verificar el repositorio para crear la copia.');
        if (dirname(cursor) === cursor) break;
      }
    }
  }
  const found: string[] = [];
  const visit = (directory: string, depth: number) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const name = relative(root, join(directory, entry.name)).replaceAll('\\', '/');
      if (!safeName(name)) continue;
      if (entry.isSymbolicLink()) throw new Error('No se permiten enlaces en la copia de trabajo.');
      if (entry.isDirectory()) visit(join(directory, entry.name), depth + 1);
      else if (entry.isFile()) found.push(name);
    }
  };
  visit(root, 0);
  return found.sort();
}
function saveReceipt(receipt: SelfWorkspaceReceipt): void {
  const temp = `${receipt.receiptPath}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 });
  renameSync(temp, receipt.receiptPath);
}
function loadReceipt(receiptPath: string): SelfWorkspaceReceipt {
  if (lstatSync(receiptPath).isSymbolicLink()) throw new Error('Recibo de copia no seguro.');
  const r = JSON.parse(readFileSync(receiptPath, 'utf8')) as SelfWorkspaceReceipt;
  const legacyTestRuntime = (name: string) =>
    name.split('/').includes('.vscode-test') &&
    !isAbsolute(name) &&
    !name.includes('\\') &&
    !name.includes(':') &&
    name.split('/').every((part) => !!part && part !== '.' && part !== '..');
  if (
    r.version !== 1 ||
    r.receiptPath !== resolve(receiptPath) ||
    !r.base ||
    !['review_required', 'integrated'].includes(r.status) ||
    !Array.isArray(r.integratedPaths) ||
    r.workspaceRoot !== join(dirname(r.receiptPath), 'project') ||
    Object.entries(r.base).some(
      ([name, hash]) =>
        (!safeName(name) && !legacyTestRuntime(name)) || !/^[a-f0-9]{64}$/.test(hash),
    )
  )
    throw new Error('Recibo de copia inválido.');
  // Older copies included downloaded VS Code runtimes. Keep their receipt readable;
  // those generated files are no longer source candidates and are never integrated.
  r.base = Object.fromEntries(Object.entries(r.base).filter(([name]) => !legacyTestRuntime(name)));
  if (
    realpathSync(r.sourceRoot) !== r.sourceRoot ||
    realpathSync(r.workspaceRoot) !== r.workspaceRoot
  )
    throw new Error('La copia cambió de ubicación.');
  return r;
}

export function isSelfProject(project: string, hostRoot: string): boolean {
  try {
    const candidate = realpathSync(project),
      host = realpathSync(hostRoot);
    return candidate === host || contained(candidate, host) || contained(host, candidate);
  } catch {
    return false;
  }
}

export async function createSelfWorkspace(input: {
  sourceRoot: string;
  workspacesRoot: string;
  previewPort?: number;
}): Promise<SelfWorkspaceReceipt> {
  const sourceRoot = realpathSync(input.sourceRoot);
  const requestedRoot = resolve(input.workspacesRoot);
  if (requestedRoot === sourceRoot || contained(sourceRoot, requestedRoot))
    throw new Error('La copia debe guardarse fuera del proyecto activo.');
  mkdirSync(input.workspacesRoot, { recursive: true });
  const privateRoot = realpathSync(input.workspacesRoot);
  if (privateRoot === sourceRoot || contained(sourceRoot, privateRoot))
    throw new Error('La copia debe guardarse fuera del proyecto activo.');
  const id = randomUUID(),
    directory = join(privateRoot, id),
    workspaceRoot = join(directory, 'project');
  const previewPort = input.previewPort ?? 4174;
  if (
    !Number.isInteger(previewPort) ||
    previewPort < 1024 ||
    previewPort > 65535 ||
    previewPort === 4173
  )
    throw new Error('El puerto de vista previa debe ser distinto del de la oficina.');
  mkdirSync(workspaceRoot, { recursive: true });
  const base: Record<string, string> = Object.create(null);
  for (const name of names(sourceRoot, true)) {
    const source = safeFile(sourceRoot, name);
    if (!existsSync(source)) continue; // Tracked deletion.
    base[name] = hashFile(source);
    const destination = safeFile(workspaceRoot, name);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination, constants.COPYFILE_EXCL);
    if (hashFile(destination) !== base[name])
      throw new Error(
        'El proyecto cambió durante la copia. Los archivos parciales se conservan para revisión.',
      );
  }
  // Refuse a mixed snapshot if another actor edited the source while copying it.
  for (const [name, hash] of Object.entries(base)) {
    const current = safeFile(sourceRoot, name);
    if (!existsSync(current) || hashFile(current) !== hash)
      throw new Error(
        'El proyecto cambió durante la copia. Los archivos parciales se conservan para revisión.',
      );
  }
  const finalNames = names(sourceRoot, true).filter((name) =>
    existsSync(safeFile(sourceRoot, name)),
  );
  if (JSON.stringify(finalNames) !== JSON.stringify(Object.keys(base)))
    throw new Error(
      'El proyecto cambió durante la copia. Los archivos parciales se conservan para revisión.',
    );
  const receipt: SelfWorkspaceReceipt = {
    version: 1,
    id,
    sourceRoot,
    workspaceRoot,
    receiptPath: join(directory, 'receipt.json'),
    createdAt: new Date().toISOString(),
    status: 'review_required',
    previewPort,
    base,
    integratedPaths: [],
  };
  saveReceipt(receipt);
  return receipt;
}

export async function inspectSelfWorkspace(
  receiptPath: string,
): Promise<{ receipt: SelfWorkspaceReceipt; changes: SelfWorkspaceChange[] }> {
  const receipt = loadReceipt(receiptPath),
    changes: SelfWorkspaceChange[] = [];
  for (const name of [
    ...new Set([...Object.keys(receipt.base), ...names(receipt.workspaceRoot, false)]),
  ].sort()) {
    const file = safeFile(receipt.workspaceRoot, name),
      bytes = existsSync(file),
      before = receipt.base[name];
    if (!bytes && before) changes.push({ path: name, kind: 'deleted' });
    else if (bytes && !before) changes.push({ path: name, kind: 'added' });
    else if (bytes && hashFile(file) !== before) changes.push({ path: name, kind: 'modified' });
  }
  return { receipt, changes };
}

/** Copy an old workspace to a sandbox-readable location without losing its original baseline. */
export async function rehomeSelfWorkspace(
  receiptPath: string,
  workspacesRoot: string,
): Promise<SelfWorkspaceReceipt> {
  const original = loadReceipt(receiptPath);
  if (original.status !== 'review_required') throw new Error('Esta copia ya fue integrada.');
  const relocated = await createSelfWorkspace({
    sourceRoot: original.workspaceRoot,
    workspacesRoot,
    previewPort: original.previewPort,
  });
  relocated.sourceRoot = original.sourceRoot;
  relocated.base = original.base;
  saveReceipt(relocated);
  return relocated;
}

/** Explicit reviewed file integration; no automatic apply or resumption. */
export async function integrateSelfWorkspace(input: {
  receiptPath: string;
  reviewedPaths: string[];
  /** Exact files from the independently verified candidate snapshot; undefined entry means deletion. */
  reviewedFiles?: Record<string, string>;
  reviewedSnapshot?: FileRevision;
}): Promise<{ receipt: SelfWorkspaceReceipt; applied: string[]; conflicts: string[] }> {
  const { receipt, changes } = await inspectSelfWorkspace(input.receiptPath);
  if (receipt.status === 'integrated') throw new Error('Esta copia ya fue integrada.');
  if (
    !input.reviewedPaths.length ||
    new Set(input.reviewedPaths).size !== input.reviewedPaths.length
  )
    throw new Error('Selecciona los archivos revisados.');
  const changed = new Set(changes.map((c) => c.path)),
    conflicts: string[] = [];
  if (input.reviewedSnapshot) {
    const snapshot = input.reviewedSnapshot;
    if (
      createHash('sha256').update(JSON.stringify(snapshot.files)).digest('hex') !== snapshot.digest
    )
      throw new Error('La captura revisada no coincide con su huella.');
    for (const name of new Set([
      ...Object.keys(receipt.base),
      ...names(receipt.workspaceRoot, false),
      ...Object.keys(snapshot.files),
    ])) {
      if (forbidden(name)) continue;
      const file = safeFile(receipt.workspaceRoot, name);
      const actual = existsSync(file) ? hashFile(file) : undefined;
      const expected =
        snapshot.format === 'sha256-v1'
          ? snapshot.files[name]
          : snapshot.files[name] === undefined
            ? undefined
            : digest(Buffer.from(snapshot.files[name], 'base64'));
      if (actual !== expected) conflicts.push(name);
      if (expected !== undefined && snapshot.format === 'sha256-v1') revisionFile(snapshot, name);
    }
  }
  const reviewed = input.reviewedFiles === undefined ? undefined : new Map<string, string>();
  if (reviewed) {
    for (const [name, value] of Object.entries(input.reviewedFiles!)) {
      // Build outputs can exist in a full review snapshot but are never integrated as source.
      if (forbidden(name)) continue;
      if (
        !safeName(name) ||
        typeof value !== 'string' ||
        Buffer.from(value, 'base64').toString('base64') !== value
      )
        throw new Error('La captura revisada contiene archivos inválidos.');
      reviewed.set(name, value);
    }
    for (const name of new Set([
      ...Object.keys(receipt.base),
      ...names(receipt.workspaceRoot, false),
      ...reviewed.keys(),
    ])) {
      if (fileBytes(receipt.workspaceRoot, name)?.toString('base64') !== reviewed.get(name))
        conflicts.push(name);
    }
  }
  const pending = input.reviewedPaths.map((name) => {
    if (!changed.has(name))
      throw new Error('Un archivo seleccionado no forma parte de los cambios revisables.');
    const current = fileBytes(receipt.sourceRoot, name),
      bytes = fileBytes(receipt.workspaceRoot, name);
    const currentHash = current ? digest(current) : undefined;
    if (currentHash !== receipt.base[name]) conflicts.push(name);
    // Keep these exact reviewed bytes for writing, even if the candidate changes later.
    if (reviewed && bytes?.toString('base64') !== reviewed.get(name)) conflicts.push(name);
    if (input.reviewedSnapshot) {
      const snapshot = input.reviewedSnapshot,
        value = snapshot.files[name];
      const expected =
        snapshot.format === 'sha256-v1'
          ? value
          : value === undefined
            ? undefined
            : digest(Buffer.from(value, 'base64'));
      if ((bytes ? digest(bytes) : undefined) !== expected) conflicts.push(name);
    }
    return { name, current, bytes };
  });
  if (conflicts.length) return { receipt, applied: [], conflicts: [...new Set(conflicts)].sort() };
  // Persist an exact backup of all overwritten/deleted bytes before changing the live source.
  const backupRoot = join(dirname(receipt.receiptPath), 'integration-backup');
  for (const { name, current } of pending)
    if (current) {
      const target = join(backupRoot, name);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, current, { flag: 'wx', mode: 0o600 });
    }
  const applied: string[] = [];
  for (const { name, current, bytes } of pending) {
    const latest = fileBytes(receipt.sourceRoot, name);
    if ((latest ? digest(latest) : undefined) !== (current ? digest(current) : undefined))
      throw new Error(
        'El proyecto cambió durante la integración. Revisa los archivos y el respaldo.',
      );
    const target = safeFile(receipt.sourceRoot, name);
    if (bytes) {
      mkdirSync(dirname(target), { recursive: true });
      const temp = `${target}.${randomUUID()}.office-tmp`;
      writeFileSync(temp, bytes, { flag: 'wx' });
      renameSync(temp, target);
    } else if (current) unlinkSync(target);
    applied.push(name);
    receipt.integratedPaths = [...applied];
    saveReceipt(receipt);
  }
  receipt.status = 'integrated';
  saveReceipt(receipt);
  return { receipt, applied, conflicts: [] };
}
