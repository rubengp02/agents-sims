import type { OfficeArtifact } from './artifacts.js';
import type { TaskContext, TeamTask } from './team.js';

export interface SavedProject {
  id: string;
  name: string;
  path: string;
  instructions: string;
  /** Explicit project-scoped permission for file changes; never a quota bypass. */
  turbo?: boolean;
  /** Sending a normal message authorizes project work and included quota. Default on. */
  autonomy?: boolean;
  context?: TaskContext;
  checksApproval?: { fingerprint: string; ids: string[]; approvedAt: number };
}
export interface ConversationMessage {
  id: string;
  origin?: 'user' | 'internal';
  inputId?: string;
  attachments?: OfficeArtifact[];
  artifacts?: OfficeArtifact[];
  taskId: string;
  kind: 'request' | 'response';
  role: TeamTask['role'];
  content: string;
  /** Friendly persisted label for a server-generated internal assignment. */
  officeAssignment?: string;
  createdAt: number;
  status: TeamTask['status'];
  reasonCode: string | null;
}
export interface PendingConversationInput {
  id: string;
  content: string;
  attachments?: OfficeArtifact[];
  officeMode: boolean;
  allowWrites?: boolean;
  budgetMode?: 'codex' | 'manual';
  createdAt: number;
  updatedAt: number;
  status: 'queued' | 'dispatching' | 'needs_review';
  revision: number;
  reason?: string;
  taskId?: string;
}
export interface SavedConversation {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  draft: string;
  draftAttachments?: OfficeArtifact[];
  pendingInputs?: PendingConversationInput[];
  pendingHold?: boolean;
  messages: ConversationMessage[];
}
export interface ProjectCheckCatalog {
  fingerprint: string;
  checks: Array<{ id: string; description: string; approved: boolean }>;
  available: boolean;
  message: string;
}
export interface ConversationLibrarySnapshot {
  projects: SavedProject[];
  conversations: Array<Omit<SavedConversation, 'messages' | 'draft'>>;
  selected: SavedConversation | null;
  selectedProjectId: string | null;
  checks: ProjectCheckCatalog | null;
  warning: string | null;
  writable: boolean;
}
