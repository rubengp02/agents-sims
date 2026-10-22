import type { TaskContext, TeamTask } from './team.js';

export interface SavedProject {
  id: string;
  name: string;
  path: string;
  instructions: string;
  context?: TaskContext;
  checksApproval?: { fingerprint: string; ids: string[]; approvedAt: number };
}
export interface ConversationMessage {
  id: string;
  taskId: string;
  kind: 'request' | 'response';
  role: TeamTask['role'];
  content: string;
  createdAt: number;
  status: TeamTask['status'];
  reasonCode: string | null;
}
export interface SavedConversation {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  draft: string;
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
