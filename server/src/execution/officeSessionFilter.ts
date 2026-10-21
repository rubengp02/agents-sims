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
        const terminal = ['completed', 'failed', 'cancelled', 'blocked', 'paused'].includes(
          record.status,
        );
        if (!terminal) return Object.hasOwn(TEAM_ROLES, record.officeRole);
        // A later manual continuation is a real external session. Only suppress
        // replay of the finished office run, not future user work in that chat.
        if (transcript && Number.isFinite(record.updatedAt)) {
          if (statSync(transcript).mtimeMs > record.updatedAt + 2000) return false;
        }
        return true;
      } catch {
        // Invalid/missing receipts cannot classify an unrelated external chat.
      }
    }
    return false;
  }
}
