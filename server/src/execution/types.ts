import type { ProviderInspection, TeamRole } from '../../../core/src/team.js';
import type { ExecutionMetrics } from './executionMetrics.js';
import type { OwnedWorkspace, WorkflowWorkspaceManager } from './workflowWorkspace.js';

export type ProviderId = 'codex' | 'claude' | 'antigravity';
export type RunStatus =
  'checking' | 'running' | 'completed' | 'paused' | 'cancelled' | 'failed' | 'blocked';

export class ExecutionBlocked extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly inspection?: ProviderInspection,
  ) {
    super(message);
    this.name = 'ExecutionBlocked';
  }
}

export interface ModelCapability {
  id: string;
  efforts: string[];
  inputModalities?: string[];
}

export interface SubscriptionEvidence {
  inspection?: ProviderInspection;
  checkedAt: number;
  plan: 'plus' | 'pro' | 'google-included';
  quota: Array<{ id: string; usedPercent: number; resetsAt: number }>;
  models: ModelCapability[];
}

export interface RunRecord {
  officeRole?: TeamRole;
  version: 1;
  id: string;
  provider: 'codex' | 'claude' | 'antigravity';
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
  engine?: 'codex-cli' | 'codex-app-server' | 'agent-orchestrator' | 'antigravity-cli';
  executionProject?: string;
  toolCalls?: number;
  /** Set before any tool/approval begins, including operations without a receipt. */
  workStarted?: boolean;
  /** Safe aggregates, absent on historical receipts. No raw event payloads. */
  metrics?: ExecutionMetrics;
}

export interface ExecuteOptions {
  /** Trusted paths resolved from private attachment IDs, never accepted from HTTP. */
  imagePaths?: string[];
  artifactDirectory?: string;
  toolServer?: { url: string; token: string };
  onToolActivity?: (activity: string) => void;
  onArtifact?: (path: string) => void;
  onCapabilityVerified?: (capability: 'images' | 'web-search') => void;
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
  /** null: no wall-clock cutoff for a user-authorized normal chat/office objective. */
  timeoutMs?: number | null;
  /** Observed CLI usage, checked at turn completion; not a provider generation cap. */
  maxReportedTokens?: number;
  contextFingerprint?: string;
  /** Stable ownership key; continuing a character alone never resumes a conversation. */
  executionSessionKey?: string;
  /** Server-owned objective identity. Only the Chief may reuse this conversation. */
  objectiveSessionKey?: string;
  /** Workspace returned by a completed dependency, never a caller-chosen extra root. */
  inheritedWorkspace?: string;
  signal?: AbortSignal;
  /** Backend-owned interruption reason, never taken directly from request JSON. */
  interruptionReason?: () => string;
  onOutput?: (text: string) => void;
  /** Backend-owned tool lifecycle. A model turn ending does not settle pending approvals or OAuth. */
  waitForTools?: (signal: AbortSignal) => Promise<void>;
  onProgress?: (event: { id: string; title: string; detail?: string; completed: boolean }) => void;
  onState?: (record: Readonly<RunRecord>) => void;
  /** Sanitized activity only: never tool arguments, commands or file contents. */
  onActivity?: (activity: 'thinking' | 'reading' | 'working') => void;
}

/** Only local official CLIs may implement this contract. No Google client exists. */
export interface OfficialExecutor {
  readonly executionEvidence?: import('../../../core/src/deliveryEvidence.js').ExecutionEvidenceKind;
  readonly workspaceManager?: WorkflowWorkspaceManager;
  readonly provider: ProviderId;
  readonly engine?: 'codex-cli' | 'codex-app-server' | 'agent-orchestrator' | 'antigravity-cli';
  readonly maxConcurrentReadOnly?: 1 | 2;
  readonly supportsSteering?: boolean;
  /** A controlled office interruption; never claims native in-turn steering. */
  readonly supportsOfficeRedirect?: boolean;
  steer?(executionSessionKey: string, input: SteeringInput): Promise<SteeringResult>;
  releaseObjectiveSession?(key: string): void;
  openIntegrations?(
    project: string,
    signal: AbortSignal,
  ): Promise<import('../tools/officialIntegrations.js').IntegrationClient>;
  openPluginMcp?(
    project: string,
    selection: import('../tools/pluginMcpSession.js').PluginMcpSelection,
    signal: AbortSignal,
  ): Promise<import('../tools/pluginMcpSession.js').PluginMcpClient>;
  openAuthentication?(
    signal: AbortSignal,
  ): Promise<import('../tools/officialAuthentication.js').AuthenticationClient>;
  openApplications?(
    signal: AbortSignal,
  ): Promise<import('../tools/officialApplications.js').ApplicationClient>;
  openMcpRegistration?(
    signal: AbortSignal,
  ): Promise<import('../tools/officialMcpRegistration.js').ManagedMcpRegistrationClient>;
  openManagedMcp?(
    project: string,
    target: import('../tools/officialMcpRegistration.js').ManagedMcpTarget,
    signal: AbortSignal,
  ): Promise<import('../tools/connectionManager.js').RemoteClient>;
  openManagedAuthentication?(
    target: import('../tools/officialMcpRegistration.js').ManagedMcpTarget,
    signal: AbortSignal,
  ): Promise<import('../tools/officialAuthentication.js').AuthenticationClient>;
  openPluginManagement?(
    signal: AbortSignal,
  ): Promise<import('../tools/officialPlugins.js').PluginClient>;
  diagnose(): Promise<SubscriptionEvidence>;
  execute(options: ExecuteOptions): Promise<RunRecord>;
}

export interface SteeringInput {
  id: string;
  text: string;
  imagePaths?: string[];
}

export interface SteeringResult {
  status: 'accepted' | 'not_running' | 'unknown';
  turnId?: string;
}
