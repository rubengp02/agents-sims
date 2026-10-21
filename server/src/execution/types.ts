import type { TeamRole } from '../../../core/src/team.js';
import type { ExecutionMetrics } from './executionMetrics.js';
import type { OwnedWorkspace, WorkflowWorkspaceManager } from './workflowWorkspace.js';

export type ProviderId = 'codex' | 'claude' | 'antigravity';
export type RunStatus =
  'checking' | 'running' | 'completed' | 'paused' | 'cancelled' | 'failed' | 'blocked';

export class ExecutionBlocked extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ExecutionBlocked';
  }
}

export interface ModelCapability {
  id: string;
  efforts: string[];
}

export interface SubscriptionEvidence {
  checkedAt: number;
  plan: 'plus' | 'pro';
  quota: Array<{ id: string; usedPercent: number; resetsAt: number }>;
  models: ModelCapability[];
}

export interface RunRecord {
  officeRole?: TeamRole;
  version: 1;
  id: string;
  provider: 'codex' | 'claude';
  billing: 'subscription-only';
  status: RunStatus;
  project: string;
  requestedModel: string;
  requestedEffort: string;
  confirmedModel: string | null;
  sessionId: string | null;
  startedAt: number;
  updatedAt: number;
  reasonCode: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Absent on legacy receipts; null means not communicated or invalid. */
  cachedInputTokens?: number | null;
  /** Last communicated counters on interruption; a lower bound, never a final total. */
  observedUsage?: { inputTokens: number; outputTokens: number; cachedInputTokens: number | null };
  cliVersion?: string;
  subscriptionCheckedAt?: number;
  contextFingerprint?: string;
  sessionMode?: 'new' | 'resume';
  engine?: 'codex-cli' | 'agent-orchestrator';
  executionProject?: string;
  toolCalls?: number;
  /** Safe aggregates, absent on historical receipts. No raw event payloads. */
  metrics?: ExecutionMetrics;
}

export interface ExecuteOptions {
  /** In-process capability. Never reconstructed from request JSON. */
  ownedWorkspace?: OwnedWorkspace;
  officeRole?: TeamRole;
  project: string;
  prompt: string;
  model?: string;
  effort?: string;
  allowWrites?: boolean;
  /** Only independently scheduled read-only work may share the two Codex slots. */
  parallelReadOnly?: boolean;
  timeoutMs?: number;
  /** Observed CLI usage, checked at turn completion; not a provider generation cap. */
  maxReportedTokens?: number;
  contextFingerprint?: string;
  /** Stable ownership key; continuing a character alone never resumes a conversation. */
  executionSessionKey?: string;
  /** Workspace returned by a completed dependency, never a caller-chosen extra root. */
  inheritedWorkspace?: string;
  signal?: AbortSignal;
  onOutput?: (text: string) => void;
  onState?: (record: Readonly<RunRecord>) => void;
  /** Sanitized activity only: never tool arguments, commands or file contents. */
  onActivity?: (activity: 'thinking' | 'reading' | 'working') => void;
}

/** Only local official CLIs may implement this contract. No Google client exists. */
export interface OfficialExecutor {
  readonly workspaceManager?: WorkflowWorkspaceManager;
  readonly provider: ProviderId;
  readonly engine?: 'codex-cli' | 'agent-orchestrator';
  readonly maxConcurrentReadOnly?: 1 | 2;
  diagnose(): Promise<SubscriptionEvidence>;
  execute(options: ExecuteOptions): Promise<RunRecord>;
}
