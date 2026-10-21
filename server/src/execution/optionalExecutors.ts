import {
  type ExecuteOptions,
  ExecutionBlocked,
  type OfficialExecutor,
  type ProviderId,
  type RunRecord,
  type SubscriptionEvidence,
} from './types.js';

/** No token import, SDK, API fallback or Google implementation is present. */
export class DisabledExecutor implements OfficialExecutor {
  constructor(readonly provider: Exclude<ProviderId, 'codex'>) {}
  async diagnose(): Promise<SubscriptionEvidence> {
    throw new ExecutionBlocked(
      this.provider === 'claude' ? 'claude_disabled' : 'antigravity_not_implemented',
      this.provider === 'claude'
        ? 'Claude Code está desactivado. Se habilitará cuando su CLI, sesión y ausencia de consumo adicional sean verificables.'
        : 'Antigravity no está implementado. No se ha contactado con Google.',
    );
  }
  async execute(_options: ExecuteOptions): Promise<RunRecord> {
    await this.diagnose();
    throw new Error('Unreachable');
  }
}
