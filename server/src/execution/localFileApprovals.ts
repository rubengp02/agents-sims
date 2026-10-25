import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { object } from './subscriptionPolicy.js';

/** A local write permission covers one observed patch, never a new writable root. */
export class LocalFileApprovals {
  private readonly pending = new Map<
    string,
    { threadId: unknown; turnId: unknown; paths: string[] }
  >();

  constructor(
    private readonly project: string,
    private readonly allowWrites: boolean,
  ) {}

  clear(): void {
    this.pending.clear();
  }

  observe(method: string, params: Record<string, unknown>): void {
    const item = object(params.item);
    if (item.type !== 'fileChange' || typeof item.id !== 'string') return;
    this.pending.delete(item.id);
    if (method !== 'item/started' || item.status !== 'inProgress' || !Array.isArray(item.changes))
      return;
    const paths: string[] = [];
    for (const raw of item.changes) {
      const change = object(raw),
        kind = object(change.kind);
      if (
        typeof change.path !== 'string' ||
        !['add', 'delete', 'update'].includes(String(kind.type)) ||
        Object.keys(kind).some((key) => !['type', 'move_path'].includes(key))
      )
        return;
      paths.push(change.path);
      if (kind.move_path !== null && kind.move_path !== undefined) {
        if (kind.type !== 'update' || typeof kind.move_path !== 'string') return;
        paths.push(kind.move_path);
      }
    }
    if (paths.length)
      this.pending.set(item.id, { threadId: params.threadId, turnId: params.turnId, paths });
  }

  accept(
    params: Record<string, unknown>,
    threadId: string | null,
    turnId: string | undefined,
  ): boolean {
    const item = typeof params.itemId === 'string' ? this.pending.get(params.itemId) : undefined;
    if (typeof params.itemId === 'string') this.pending.delete(params.itemId);
    if (
      !this.allowWrites ||
      (params.grantRoot !== null && params.grantRoot !== undefined) ||
      !item ||
      !threadId ||
      !turnId ||
      params.threadId !== threadId ||
      params.turnId !== turnId ||
      item.threadId !== threadId ||
      item.turnId !== turnId
    )
      return false;
    return item.paths.every((path) => this.localPath(path));
  }

  private localPath(path: string): boolean {
    try {
      const root = realpathSync(this.project),
        target = resolve(root, path),
        rel = relative(root, target);
      if (
        !rel ||
        isAbsolute(rel) ||
        rel === '..' ||
        rel.startsWith('..' + sep) ||
        rel.includes(':')
      )
        return false;
      const parts = rel.split(sep);
      if (
        parts.some((part) =>
          /^(?:\.git|\.hg|\.svn|\.local-office|\.env(?:\..*)?|\.npmrc|\.git-credentials|credentials(?:\..*)?|auth\.(?:json|toml)|secrets(?:\..*)?|id_rsa|id_ed25519)$|\.(?:pem|key|pfx|p12)$/i.test(
            part,
          ),
        )
      )
        return false;
      let cursor = root;
      for (const part of parts) {
        cursor = resolve(cursor, part);
        try {
          if (lstatSync(cursor).isSymbolicLink()) return false;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  }
}
