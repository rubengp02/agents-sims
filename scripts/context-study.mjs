/** Offline audit only: reads selected receipts/session history, never invokes a CLI or model. */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function summarizeContext(events) {
  let latestUsage = null;
  const instructions = [];
  const toolCalls = new Set();
  const usageSnapshots = new Set();
  let toolSeen = false;
  for (const event of events) {
    const p = event.payload ?? {};
    if (event.type === 'session_meta' && typeof p.base_instructions?.text === 'string')
      instructions.push({ kind: 'cli_base', characters: p.base_instructions.text.length });
    if (event.type === 'response_item') {
      if (['function_call', 'custom_tool_call'].includes(p.type)) {
        toolSeen = true;
        if (typeof p.call_id === 'string') toolCalls.add(p.call_id);
      }
      if (!toolSeen && ['developer', 'user'].includes(p.role)) {
        for (const part of p.content ?? []) {
          if (typeof part.text !== 'string') continue;
          const text = part.text;
          const kind = text.includes('AjudesClares')
            ? 'other_project_instructions'
            : text.startsWith('<skills_instructions>')
              ? 'skills_catalog'
              : text.startsWith('<permissions')
                ? 'permissions'
                : text.startsWith('<environment_context>')
                  ? 'environment'
                  : p.role === 'developer'
                    ? 'other_cli_instructions'
                    : 'task_or_project';
          instructions.push({ kind, characters: text.length });
        }
      }
    }
    if (event.type === 'event_msg' && p.type === 'token_count' && p.info?.total_token_usage) {
      latestUsage = p.info.total_token_usage;
      usageSnapshots.add(JSON.stringify(latestUsage));
    }
  }
  if (latestUsage) {
    for (const key of ['input_tokens', 'output_tokens', 'cached_input_tokens'])
      assert.ok(Number.isSafeInteger(latestUsage[key]) && latestUsage[key] >= 0, 'Invalid usage');
    assert.ok(latestUsage.cached_input_tokens <= latestUsage.input_tokens, 'Invalid cached usage');
  }
  return {
    instructions,
    toolCalls: toolCalls.size,
    distinctUsageSnapshots: usageSnapshots.size,
    usage: latestUsage
      ? {
          inputTokens: latestUsage.input_tokens,
          cachedInputTokens: latestUsage.cached_input_tokens,
          nonCachedInputTokens: latestUsage.input_tokens - latestUsage.cached_input_tokens,
          outputTokens: latestUsage.output_tokens,
        }
      : null,
  };
}

function findSession(directory, id, depth = 0) {
  if (depth > 4) return null;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isFile() && entry.name.endsWith('.jsonl') && entry.name.includes(id)) return file;
    if (entry.isDirectory()) {
      const found = findSession(file, id, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

export function auditRuns(repo, sessions) {
  const baseline = JSON.parse(
    readFileSync(join(repo, 'reports/validacion-real/reintento-verification.json'), 'utf8'),
  );
  const runs = baseline.runs.map((run) => {
    assert.match(run.id, /^[\da-f-]{36}$/i);
    const receipt = JSON.parse(
      readFileSync(join(repo, '.local-office/executions', `${run.id}.json`), 'utf8'),
    );
    assert.match(receipt.sessionId, /^[\da-f-]{36}$/i);
    const file = findSession(sessions, receipt.sessionId);
    assert.ok(file, 'Missing official session history');
    const events = readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const context = summarizeContext(events);
    assert.ok(context.usage, 'Unknown usage cannot be treated as zero');
    assert.equal(context.usage.inputTokens, run.inputTokens);
    assert.equal(context.usage.outputTokens, run.outputTokens);
    return {
      role: run.role,
      requestedModel: run.requestedModel,
      effort: run.requestedEffort,
      durationMs: run.updatedAt - run.startedAt,
      ...context,
    };
  });
  const totals = runs.reduce(
    (sum, run) => {
      for (const key of [
        'inputTokens',
        'cachedInputTokens',
        'nonCachedInputTokens',
        'outputTokens',
      ])
        sum[key] += run.usage[key];
      sum.durationMs += run.durationMs;
      sum.toolCalls += run.toolCalls;
      return sum;
    },
    {
      inputTokens: 0,
      cachedInputTokens: 0,
      nonCachedInputTokens: 0,
      outputTokens: 0,
      durationMs: 0,
      toolCalls: 0,
    },
  );
  return {
    inferenceCallsMadeByAudit: 0,
    baselineCliRuns: runs.length,
    quality: 'previously-validated-small-fixture',
    units: {
      instructions: 'characters, not exact model tokens',
      durations: 'CLI elapsed time, not human review gaps',
      quota: 'unknown conversion to subscription percentage',
    },
    totals: {
      ...totals,
      reportedTokens: totals.inputTokens + totals.outputTokens,
      inputCacheRatio: totals.cachedInputTokens / totals.inputTokens,
    },
    runs,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const report = auditRuns(
    repo,
    join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions'),
  );
  const destination = join(repo, 'reports/contexto');
  mkdirSync(destination, { recursive: true });
  writeFileSync(join(destination, 'baseline.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify(
      {
        ...report,
        runs: report.runs.map(({ instructions, ...run }) => ({
          ...run,
          instructionCharacters: instructions.reduce((sum, item) => sum + item.characters, 0),
          otherProjectInstructionCharacters: instructions
            .filter((item) => item.kind === 'other_project_instructions')
            .reduce((sum, item) => sum + item.characters, 0),
        })),
      },
      null,
      2,
    ),
  );
}
