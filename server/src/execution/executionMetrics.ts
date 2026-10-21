/** Fixed counters only. Never retain commands, paths, output, identifiers or errors. */
export interface ExecutionMetrics {
  version: 1;
  source: 'codex-json' | 'ao-activity';
  promptCharacters: number;
  promptUtf8Bytes: number;
  submittedCharacters: number;
  submittedUtf8Bytes: number;
  activityEvents: number;
  completedToolEvents: number | null;
  commandEvents: number | null;
  fileChangeEvents: number | null;
  observedToolOutputUtf8Bytes: number | null;
  toolOutputMissing: number | null;
  duplicateToolEvents: number;
  counterSaturated: boolean;
  completedTurns: number;
  failedTurns: number;
  usageEvents: number;
  /** Neither protocol proves which shell commands read files or internal model calls. */
  fileReads: null;
  internalModelRequests: null;
}

export function createExecutionMetrics(
  source: ExecutionMetrics['source'],
  prompt: string,
  submitted: string = prompt,
): ExecutionMetrics {
  const available = source === 'codex-json' ? 0 : null;
  return {
    version: 1,
    source,
    promptCharacters: prompt.length,
    promptUtf8Bytes: Buffer.byteLength(prompt),
    submittedCharacters: submitted.length,
    submittedUtf8Bytes: Buffer.byteLength(submitted),
    activityEvents: 0,
    completedToolEvents: available,
    commandEvents: available,
    fileChangeEvents: available,
    observedToolOutputUtf8Bytes: available,
    toolOutputMissing: available,
    duplicateToolEvents: 0,
    counterSaturated: false,
    completedTurns: 0,
    failedTurns: 0,
    usageEvents: 0,
    fileReads: null,
    internalModelRequests: null,
  };
}

/** Item IDs are kept only in a bounded, ephemeral set, never serialized. */
export function cliMetricsObserver(metrics: ExecutionMetrics) {
  const seen = new Set<string>();
  return (event: Record<string, unknown>) => {
    if (event.type === 'turn.completed') {
      metrics.completedTurns++;
      metrics.usageEvents++;
    }
    if (event.type === 'turn.failed') metrics.failedTurns++;
    if (event.type === 'item.started') metrics.activityEvents++;
    if (event.type !== 'item.completed') return;
    const item = event.item as Record<string, unknown> | undefined;
    if (
      !item ||
      ![
        'command_execution',
        'file_change',
        'web_search',
        'mcp_tool_call',
        'collab_tool_call',
      ].includes(String(item.type))
    )
      return;
    if (typeof item.id === 'string') {
      if (seen.has(item.id)) {
        metrics.duplicateToolEvents++;
        return;
      }
      if (seen.size >= 10000 || item.id.length > 256) {
        metrics.counterSaturated = true;
        return;
      }
      seen.add(item.id);
    }
    metrics.completedToolEvents!++;
    if (item.type === 'command_execution') {
      metrics.commandEvents!++;
      if (typeof item.aggregated_output === 'string')
        metrics.observedToolOutputUtf8Bytes! += Buffer.byteLength(item.aggregated_output);
      else metrics.toolOutputMissing!++;
    }
    if (item.type === 'file_change') metrics.fileChangeEvents!++;
  };
}
