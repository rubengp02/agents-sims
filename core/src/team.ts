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
}
export interface TaskContext {
  objective: string;
  files: string[];
  decisions: string[];
  acceptance: string[];
  checks: string[];
}
export interface TeamTask {
  id: string;
  role: TeamRole;
  title: string;
  prompt: string;
  context?: TaskContext;
  assessment?: TaskAssessment;
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
export interface TeamAvailability {
  provider: TeamProvider;
  enabled: boolean;
  available: boolean;
  reasonCode: string | null;
  message: string;
  models: Array<{ id: string; efforts: string[] }>;
}
export interface TeamSnapshot {
  settings: TeamSettings;
  tasks: TeamTask[];
  providers: TeamAvailability[];
  running: boolean;
  runsUsed: number;
  tokensUsed: number;
  budgetReason: string | null;
}
