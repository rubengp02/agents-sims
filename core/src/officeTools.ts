export type OfficeCapabilityState =
  'unverified' | 'available' | 'needs_connection' | 'incompatible' | 'blocked';
export interface OfficeConnectionOperation {
  id: string;
  connectionId: string;
  tool: string;
  status: 'dispatching' | 'completed' | 'failed' | 'review_required' | 'not_sent';
  createdAt: number;
  updatedAt: number;
  argumentsHash: string;
  toolDefinitionHash: string;
  resultHash?: string;
  taskId?: string;
  conversationId?: string;
  approval?: { id: string; fingerprint: string; approvedAt: number };
  review?: { acknowledgedAt: number; outcome: 'not_determined' };
}
export interface OfficeConnectionOperationLog {
  recordingStartedAt: number;
  historicalCoverage: string;
  operations: OfficeConnectionOperation[];
}
export interface OfficeCapability {
  id: string;
  name: string;
  state: OfficeCapabilityState;
  reason: string;
  lastCheckedAt: string | null;
}

/** Authorization URLs are transient UI data, never credentials or persisted task context. */
export interface OfficeAuthentication {
  kind?: 'oauth' | 'application';
  id: string;
  taskId: string;
  service: string;
  status: 'awaiting_user' | 'verifying' | 'authenticated' | 'failed' | 'cancelled' | 'expired';
  reason: string;
  expiresAt: number;
  authorizationUrl?: string;
}
export interface OfficeToolApproval {
  id: string;
  taskId: string;
  tool: string;
  destination: string;
  content: string;
  createdAt: string;
  fields?: OfficeToolApprovalField[];
}
export interface OfficeOperationReview {
  id: string;
  receiptId: string;
  taskId?: string;
  conversationId?: string;
  description?: string;
  diagnostic?: string;
  failureStage?: 'request' | 'verification';
  kind: 'plugin' | 'plugin_mcp' | 'integration' | 'authentication' | 'mcp_registration';
  action: string;
  destination: string;
  occurredAt: string | null;
  reference: string;
  status: 'pending' | 'reviewed';
  originalStatus: string;
  review?: { outcome: 'completed' | 'not_completed'; reviewedAt: string };
}

export interface OfficeToolApprovalField {
  name: string;
  label: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  options?: string[];
}
export type OfficeToolApprovalValues = Record<string, string | number | boolean>;
