import type { OfficeArtifact } from './artifacts.js';
import type { ConversationLibrarySnapshot } from './conversations.js';
import type { OfficeAuthentication, OfficeCapability, OfficeToolApproval } from './officeTools.js';

/** Shared wire contract. No provider credentials or shell commands cross this boundary. */
export type TeamProvider = 'codex' | 'claude';
export type TeamRole = 'chief' | 'designer' | 'architect' | 'developer' | 'tester';
export type TeamMode = 'auto' | 'manual' | 'mixed';
export const TEAM_ROLES: Record<TeamRole, string> = {
  chief: 'Jefe',
  designer: 'Diseñador',
  architect: 'Arquitecto',
  developer: 'Programador',
  tester: 'Tester',
};
export interface TeamSettings {
  mode: TeamMode;
  claudeEnabled: boolean;
  maxRuns: number;
  maxParallel: number;
  /** Explicit opt-in for experimental decompositions with two isolated writers. */
  experimentalParallelWriters?: boolean;
  maxMinutes: number;
  maxTokens: number;
}
export interface TeamChoice {
  provider: TeamProvider;
  model: string;
  effort: string;
}
/** Explicit evidence supplied by the caller; missing evidence stays unknown. */
export interface TaskAssessment {
  scope: 'explanation' | 'bounded' | 'cross-module';
  risk: 'low' | 'high' | 'unknown';
  uncertainty: 'low' | 'high' | 'unknown';
  modules: string[];
  tests: 'available' | 'missing' | 'unknown';
  visualDecision?: boolean;
  /** Claims are verified against the locally configured acceptance registry. */
  acceptanceCoverage?: 'complete' | 'partial' | 'unknown';
}
export interface TaskContext {
  objective: string;
  files: string[];
  decisions: string[];
  acceptance: string[];
  checks: string[];
}
export interface WorkflowPart {
  title: string;
  objective: string;
  ownedFiles: string[];
  dependsOn?: number[];
  context: TaskContext;
  assessment: TaskAssessment;
}
export interface WorkflowDecomposition {
  parts: WorkflowPart[];
  sharedFiles: string[];
}
export interface TeamWorkflow {
  id: string;
  project: string;
  taskIds: string[];
  context: TaskContext;
  assessment: TaskAssessment;
  sharedFiles: string[];
  mode: 'parallel' | 'serial';
  reason: string;
  status: 'planned' | 'preparing' | 'working' | 'integrating' | 'accepted' | 'paused';
  baseSHA?: string;
  candidateProject?: string;
  candidateHash?: string;
  reasonCode?: string;
  localChecks?: TeamTask['localChecks'];
  preparationMs?: number;
  integrationMs?: number;
  budgetReview?: {
    profileKey: string;
    preparationMs: number;
    integrationMs: number;
    sequentialMs: number;
  };
}
export interface TeamTask {
  inputId?: string;
  objectiveRevision?: number;
  userInstructions?: Array<{ id: string; content: string; createdAt: number }>;
  id: string;
  attachments?: OfficeArtifact[];
  referenceImages?: OfficeArtifact[];
  artifacts?: OfficeArtifact[];
  toolActivity?: string;
  humanRequest?: { id: string; question: string; responseType: 'text' | 'approval' };
  liveActivity?: { id: string; title: string; detail?: string; at: number; completed: boolean }[];
  selfWorkspaceReceipt?: string;
  conversationId?: string;
  requiresConfirmation?: boolean;
  /** Only explicit chat preparation selects provider-managed budgeting; queue tasks stay bounded. */
  budgetMode?: 'codex' | 'manual';
  office?: {
    memory?: OfficeObjectiveMemory;
    phase:
      'prepared' | 'coordinating' | 'working' | 'reviewing' | 'paused' | 'completed' | 'cancelled';
    rounds: number;
    summary: string;
    currentTaskId?: string;
    lastActivityAt?: number;
  };
  /** Server-created link. Never accepted as authority from HTTP task input. */
  officeParentId?: string;
  /** Digest of the current summary, not execution authority. */
  confirmationFingerprint?: string;
  workerId?: string;
  workflowId?: string;
  workspaceId?: string;
  ownedFiles?: string[];
  role: TeamRole;
  title: string;
  prompt: string;
  context?: TaskContext;
  assessment?: TaskAssessment;
  proposedChoice?: TeamChoice;
  reviewMode?: 'none' | 'focused' | 'deep';
  checkedRevision?: string;
  reviewFindings?: Array<{
    file: string;
    line: number;
    severity: 'low' | 'medium' | 'high';
    criterion: string;
    evidence: string;
  }>;
  /** Explicit human estimate, bound to the selected execution profile. */
  budgetReview?: {
    choiceKey: string;
    tokens: number;
    durationMs: number;
    maxContextCharacters: number;
  };
  estimate?: {
    tokens: number | null;
    durationMs: number | null;
    confidence: string;
    samples: number;
    reason: string;
  };
  localChecks?: Array<{ id: string; exitCode: number | null; durationMs: number; passed: boolean }>;
  project: string;
  executionProject?: string;
  executionSessionKey?: string;
  dependsOn: string[];
  allowWrites: boolean;
  parallelSafe: boolean;
  scheduleReason: string;
  status:
    | 'planned'
    | 'queued'
    | 'checking'
    | 'running'
    | 'completed'
    | 'paused'
    | 'blocked'
    | 'failed'
    | 'cancelled';
  choice: TeamChoice | null;
  override: TeamChoice | null;
  approved: boolean;
  difficulty: 'simple' | 'normal' | 'complex';
  explanation: string;
  reasonCode: string | null;
  output: string;
  runId: string | null;
  confirmedModel: string | null;
  agentId: number | null;
}

export interface OfficeObjectiveMemory {
  version: 1;
  objectiveId: string;
  objective: string;
  revision: number;
  instructions: Array<{ id: string; content: string; createdAt: number }>;
  team: { size: 'small' | 'standard' | 'extended'; reason: string; guidance: string };
  deliveries: Array<{
    taskId: string;
    role: TeamRole;
    status: TeamTask['status'];
    title: string;
    summary: string;
    shortened: boolean;
    decision?: { action: string; message: string; task?: string; role?: TeamRole };
    reason?: string;
  }>;
  checks: NonNullable<TeamTask['localChecks']>;
}
export interface TeamAvailability {
  provider: TeamProvider;
  enabled: boolean;
  available: boolean;
  reasonCode: string | null;
  message: string;
  models: Array<{ id: string; efforts: string[] }>;
}
export interface TeamSnapshot {
  toolCapabilities?: OfficeCapability[];
  toolApprovals?: OfficeToolApproval[];
  authentications?: OfficeAuthentication[];
  connections?: Array<{
    engine?: 'sdk' | 'codex';
    id: string;
    name: string;
    url: string;
    enabled: boolean;
    uncertain?: { tool: string; at: string };
    state: OfficeCapability['state'];
    reason: string;
  }>;
  library?: ConversationLibrarySnapshot;
  /** Server-derived capabilities; settings and model output never grant them. */
  capabilities?: {
    steering?: boolean;
    engine: 'codex-cli' | 'codex-app-server' | 'agent-orchestrator';
    isolatedWriters: boolean;
    budgetReview: boolean;
    checks?: Array<{ id: string; acceptance: boolean }>;
  };
  settings: TeamSettings;
  tasks: TeamTask[];
  providers: TeamAvailability[];
  running: boolean;
  runsUsed: number;
  tokensUsed: number;
  /** Conservative sum of dispatched work durations, including planning/checks. */
  timeUsedMs?: number;
  elapsedMs?: number;
  usageKnown?: boolean;
  workflows?: TeamWorkflow[];
  budgetReason: string | null;
}
