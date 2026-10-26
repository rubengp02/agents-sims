import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

import { HOOK_API_PREFIX } from '../../../constants.js';
import { ANTIGRAVITY_POLL_INTERVAL_MS, ANTIGRAVITY_SESSION_STALE_MS } from './constants.js';

interface TrackedSession {
  sessionId: string;
  offset: number;
  lineBuffer: string;
  decoder: StringDecoder;
  lastActivity: number;
  started: boolean;
  ended: boolean;
  openToolIds: Set<string>;
}

type Event = Record<string, unknown>;
export type AntigravityEventSink = (event: Event, signal: AbortSignal) => Promise<void>;

function localSink(serverUrl: string, authToken: string): AntigravityEventSink {
  const url = new URL(HOOK_API_PREFIX + '/antigravity', serverUrl);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw new Error('Antigravity observation requires the local office endpoint.');
  return (event, signal) =>
    new Promise((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const json = JSON.stringify(event);
      const req = http.request(
        url,
        {
          method: 'POST',
          signal,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(json),
            Authorization: 'Bearer ' + authToken,
          },
          timeout: 2000,
        },
        (res) => {
          res.resume();
          res.on('end', resolve);
        },
      );
      req.on('error', () => resolve());
      req.on('timeout', () => {
        req.destroy();
        resolve();
      });
      req.end(json);
    });
}

/** Explicitly enabled observation only. Old transcripts are never replayed as live work. */
export class AntigravityTailer {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly sessions = new Map<string, TrackedSession>();
  private readonly rootDir: string;
  private readonly sink: AntigravityEventSink;
  private controller = new AbortController();
  private polling: Promise<void> | undefined;

  constructor(serverUrl: string, authToken: string, rootDir?: string, sink?: AntigravityEventSink) {
    this.rootDir = rootDir ?? path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
    this.sink = sink ?? localSink(serverUrl, authToken);
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer) return;
    this.controller = new AbortController();
    // Synchronous baseline before scheduling: inspecting the observer never resurrects history.
    for (const file of this.files()) {
      try {
        this.sessions.set(file, this.track(file, fs.statSync(file).size));
      } catch {
        /* removed */
      }
    }
    this.timer = setInterval(() => {
      void this.poll().catch(() => {});
    }, ANTIGRAVITY_POLL_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.controller.abort();
    this.sessions.clear();
  }

  /** One serialized poll, also useful for deterministic local tests. */
  poll(): Promise<void> {
    if (!this.isRunning) return Promise.resolve();
    if (this.polling) return this.polling;
    const signal = this.controller.signal;
    const pending = this.tick(signal);
    this.polling = pending;
    void pending
      .finally(() => {
        if (this.polling === pending) this.polling = undefined;
      })
      .catch(() => {});
    return pending;
  }

  private files(): string[] {
    try {
      return fs
        .readdirSync(this.rootDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) =>
          path.join(this.rootDir, entry.name, '.system_generated', 'logs', 'transcript.jsonl'),
        )
        .filter((file) => fs.existsSync(file));
    } catch {
      return [];
    }
  }

  private track(file: string, offset: number): TrackedSession {
    return {
      sessionId: path.relative(this.rootDir, file).split(path.sep)[0],
      offset,
      lineBuffer: '',
      decoder: new StringDecoder('utf8'),
      lastActivity: 0,
      started: false,
      ended: false,
      openToolIds: new Set(),
    };
  }

  private async tick(signal: AbortSignal): Promise<void> {
    const seen = new Set<string>();
    for (const file of this.files()) {
      if (signal.aborted) return;
      seen.add(file);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      let session = this.sessions.get(file);
      if (!session) {
        session = this.track(file, 0);
        this.sessions.set(file, session);
      }
      if (stat.size < session.offset) {
        // A rotated/truncated transcript is a new byte stream, including its UTF-8 boundaries.
        session.offset = 0;
        session.lineBuffer = '';
        session.decoder = new StringDecoder('utf8');
      }
      if (stat.size > session.offset) {
        session.lastActivity = Date.now();
        await this.read(file, stat.size, session, signal);
      }
    }
    for (const [file, session] of this.sessions) {
      if (signal.aborted) return;
      if (
        (!seen.has(file) || Date.now() - session.lastActivity > ANTIGRAVITY_SESSION_STALE_MS) &&
        session.started &&
        !session.ended
      ) {
        session.ended = true;
        session.openToolIds.clear();
        await this.send(
          { hook_event_name: 'SessionEnd', session_id: session.sessionId, reason: 'inactive' },
          signal,
        );
      }
      // Keep inactive offsets while the file exists. Re-reading them would fabricate new activity.
      if (!seen.has(file)) this.sessions.delete(file);
    }
  }

  private async read(
    file: string,
    size: number,
    session: TrackedSession,
    signal: AbortSignal,
  ): Promise<void> {
    let fd: number;
    try {
      fd = fs.openSync(file, 'r');
    } catch {
      return;
    }
    try {
      const buffer = Buffer.alloc(64 * 1024);
      while (session.offset < size && !signal.aborted) {
        const count = fs.readSync(
          fd,
          buffer,
          0,
          Math.min(buffer.length, size - session.offset),
          session.offset,
        );
        if (!count) break;
        session.offset += count;
        const lines = (session.lineBuffer + session.decoder.write(buffer.subarray(0, count))).split(
          '\n',
        );
        session.lineBuffer = lines.pop() ?? '';
        for (const line of lines) {
          if (signal.aborted) return;
          try {
            const record: unknown = JSON.parse(line);
            if (record && typeof record === 'object' && !Array.isArray(record))
              await this.record(record as Event, session, file, signal);
          } catch {
            /* incomplete/unsupported records do not grant a lifecycle event */
          }
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  }

  private send(event: Event, signal: AbortSignal): Promise<void> {
    return signal.aborted ? Promise.resolve() : this.sink(event, signal);
  }

  private async record(
    raw: Event,
    session: TrackedSession,
    file: string,
    signal: AbortSignal,
  ): Promise<void> {
    const step =
      raw.event === 'step_update' && raw.step_update && typeof raw.step_update === 'object'
        ? (raw.step_update as Event)
        : undefined;
    const result =
      raw.event === 'result' && raw.result && typeof raw.result === 'object'
        ? (raw.result as Event)
        : undefined;
    if (!step && !result && !Array.isArray(raw.tool_calls) && !Array.isArray(raw.tool_results))
      return;
    if (!session.started || session.ended) {
      session.started = true;
      session.ended = false;
      await this.send(
        { hook_event_name: 'SessionStart', session_id: session.sessionId, transcript_path: file },
        signal,
      );
    }
    if (step?.step_type === 'tool' && Number.isSafeInteger(step.step_index)) {
      const id = session.sessionId + '-step-' + step.step_index;
      const info =
        step.tool_info && typeof step.tool_info === 'object' ? (step.tool_info as Event) : {};
      if (step.state === 'ACTIVE' && !session.openToolIds.has(id)) {
        session.openToolIds.add(id);
        await this.send(
          {
            hook_event_name: 'ExecStart',
            session_id: session.sessionId,
            tool_id: id,
            tool_name: step.tool_name ?? info.name ?? 'unknown',
            tool_input: info.parameters,
          },
          signal,
        );
      } else if (step.state === 'DONE' && session.openToolIds.delete(id)) {
        await this.send(
          { hook_event_name: 'ExecEnd', session_id: session.sessionId, tool_id: id },
          signal,
        );
      }
    }
    if (Array.isArray(raw.tool_calls))
      for (const call of raw.tool_calls) {
        if (
          !call ||
          typeof call !== 'object' ||
          typeof call.id !== 'string' ||
          session.openToolIds.has(call.id)
        )
          continue;
        session.openToolIds.add(call.id);
        await this.send(
          {
            hook_event_name: 'ExecStart',
            session_id: session.sessionId,
            tool_id: call.id,
            tool_name: typeof call.name === 'string' ? call.name : 'unknown',
            tool_input: call.args,
          },
          signal,
        );
      }
    if (Array.isArray(raw.tool_results))
      for (const result of raw.tool_results) {
        if (!result || typeof result !== 'object' || typeof result.tool_call_id !== 'string')
          continue;
        if (session.openToolIds.delete(result.tool_call_id))
          await this.send(
            {
              hook_event_name: 'ExecEnd',
              session_id: session.sessionId,
              tool_id: result.tool_call_id,
            },
            signal,
          );
      }
    // A completed model step is not a completed turn.
    if (result && ['SUCCESS', 'ERROR', 'INTERRUPTED'].includes(String(result.status))) {
      for (const id of session.openToolIds)
        await this.send(
          { hook_event_name: 'ExecEnd', session_id: session.sessionId, tool_id: id },
          signal,
        );
      session.openToolIds.clear();
      await this.send({ hook_event_name: 'TurnEnd', session_id: session.sessionId }, signal);
    }
  }
}
