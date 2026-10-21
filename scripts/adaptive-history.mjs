import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadTools, root } from './optimization-tools.mjs';

// Imports public measured counters only, never transcripts or credentials.
// Missing historical context size stays unknown; these are not promotion evidence.
const { UsageHistory, adaptiveStateDirectory } = await loadTools();
const history = new UsageHistory(path.join(adaptiveStateDirectory(root), 'usage-history.json'));
const before = history.list().length;
for (const suffix of ['', '/revalidacion-20261021-b', '/revalidacion-20261021-c']) {
  const file = path.join(root, `reports/agent-orchestrator${suffix}/PILOTO_REAL.json`);
  if (!fs.existsSync(file)) continue;
  const bytes = fs.readFileSync(file),
    digest = createHash('sha256').update(bytes).digest('hex');
  const report = JSON.parse(bytes);
  for (const [index, run] of report.runs.entries()) {
    // No metadata denial is promoted into an inferred zero-cost model call.
    if (!run.subscriptionVerified) continue;
    history.add({
      id: `historical-${digest}-${index}`,
      at: 0,
      engine: run.method === 'office' ? 'agent-orchestrator' : 'codex-cli',
      provider: 'codex',
      model: report.model,
      effort: report.effort,
      role: run.role,
      workload: 'cross-module',
      contextCharacters: 0,
      input: run.inputTokens,
      output: run.outputTokens,
      cached: run.cachedInputTokens ?? null,
      durationMs: run.durationMs,
      status: run.status,
      accepted: null,
      censored: run.status !== 'completed',
      estimate: null,
      sessionMode: run.sessionMode ?? 'new',
    });
  }
}
console.log(
  JSON.stringify({
    inferenceCalls: 0,
    added: history.list().length - before,
    totalSamples: history.list().length,
    historicalContextSizeUnknown: true,
    promotedModels: [],
  }),
);
