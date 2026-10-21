import { lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { TEAM_ROLES } from '../../../core/src/team.js';

/** Execution receipts are local metadata, never authentication or transcript content. */
export class OfficeSessionFilter {
  private readonly transcripts = new Map<string, string>();
  constructor(private readonly directory: string) {}

  shouldIgnore(provider: string, sessionId: string, transcript?: string): boolean {
    if (provider !== 'codex' || !sessionId) return false;
    if (transcript) this.transcripts.set(sessionId, transcript);
    transcript ??= this.transcripts.get(sessionId);
    let names: string[];
    try {
      names = readdirSync(this.directory);
    } catch {
      return false;
    }
    let latest: { updatedAt: number; status: string; officeRole: string } | null = null;
    for (const name of names) {
      if (!/^[\da-f-]{36}\.json$/i.test(name)) continue;
      try {
        const file = join(this.directory, name);
        const stat = lstatSync(file);
        if (!stat.isFile() || stat.size > 32_768) continue;
        const record = JSON.parse(readFileSync(file, 'utf8'));
        if (
          record.version !== 1 ||
          record.provider !== provider ||
          record.billing !== 'subscription-only' ||
          record.sessionId !== sessionId
        )
          continue;
        if (!Number.isFinite(record.updatedAt)) continue;
        if (!latest || record.updatedAt >= latest.updatedAt) latest = record;
      } catch {
        // Invalid/missing receipts cannot classify an unrelated external chat.
      }
    }
    if (latest) {
      const terminal = ['completed', 'failed', 'cancelled', 'blocked', 'paused'].includes(
        latest.status,
      );
      if (!terminal) return Object.hasOwn(TEAM_ROLES, latest.officeRole);
      // A native conversation can have multiple receipts. Decide from its latest
      // turn, so an older terminal receipt cannot duplicate a resumed character.
      try {
        if (transcript && statSync(transcript).mtimeMs > latest.updatedAt + 2000) return false;
      } catch {
        return false;
      }
      return true;
    }
    return false;
  }
}
