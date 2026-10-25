import type { PendingConversationInput } from '../../../core/src/conversations.js';
import type { TeamTask } from '../../../core/src/team.js';
import type { ConversationLibrary } from './conversationLibrary.js';
import { ExecutionBlocked } from './types.js';

interface DeliveryHost {
  busy(): boolean;
  blocked(): boolean;
  latest(id: string): TeamTask | undefined;
  dispatch(id: string, input: PendingConversationInput): Promise<TeamTask>;
  apply(
    id: string,
    input: PendingConversationInput,
  ): Promise<'accepted' | 'not_running' | 'unknown'>;
}

/** Durable user-message queue, distinct from the chief's internal task queue. */
export class ConversationDelivery {
  private operations: Promise<unknown> = Promise.resolve();
  private scheduled = false;
  private closed = false;
  private pumping = false;
  constructor(
    private library: ConversationLibrary,
    private host: DeliveryHost,
  ) {}
  serial<T>(operation: () => Promise<T> | T): Promise<T> {
    const next = this.operations.then(operation);
    this.operations = next.catch(() => {});
    return next;
  }
  holdAll(): void {
    for (const c of this.library.snapshot().conversations)
      if (c.pendingInputs?.length) this.library.holdPending(c.id, true);
  }
  notify(): void {
    if (this.closed || this.scheduled) return;
    this.scheduled = true;
    setTimeout(() => {
      this.scheduled = false;
      void this.serial(() => this.pump()).catch(() => this.holdAll());
    }, 0);
  }
  settle(task?: TeamTask): void {
    if (task && task.status !== 'completed') this.holdAll();
    this.notify();
  }
  continue(id: string): void {
    if (this.library.pendingInputs(id).some((p) => p.status !== 'queued'))
      throw new ExecutionBlocked(
        'pending_review_required',
        'Hay un envío que necesita revisión. Comprueba su entrega antes de retirar el pendiente o volver a enviarlo.',
      );
    this.library.holdPending(id, false);
    this.notify();
  }
  async apply(id: string, inputId: string, revision: number): Promise<void> {
    const input = this.library.pendingInputs(id).find((p) => p.id === inputId);
    if (!input) {
      if (this.library.conversation(id).messages.some((m) => m.inputId === inputId)) return;
      throw new ExecutionBlocked('pending_unknown', 'El mensaje pendiente ya no existe.');
    }
    if (input.revision !== revision || input.status !== 'queued')
      throw new ExecutionBlocked(
        'pending_changed',
        'El mensaje cambió o necesita revisión. Actualiza la conversación.',
      );
    this.library.setPendingState(id, input.id, 'dispatching');
    try {
      const result = await this.host.apply(id, input);
      if (result === 'accepted') this.library.completePending(id, input.id);
      else if (result === 'unknown') {
        this.library.setPendingState(id, input.id, 'needs_review', 'delivery_unknown');
        this.library.holdPending(id, true);
      } else {
        this.library.setPendingState(id, input.id, 'queued');
        this.notify();
      }
    } catch (error) {
      const safePreflight =
        error instanceof ExecutionBlocked &&
        [
          'team_busy',
          'conversation_pending',
          'steering_unavailable',
          'instruction_limit',
          'invalid_image',
          'image_model_unavailable',
        ].includes(error.code);
      this.library.setPendingState(
        id,
        input.id,
        safePreflight ? 'queued' : 'needs_review',
        safePreflight ? undefined : 'delivery_unknown',
      );
      if (!safePreflight) this.library.holdPending(id, true);
      throw error;
    }
  }
  private async pump(): Promise<void> {
    if (this.closed || this.pumping || this.host.busy() || this.host.blocked()) return;
    const available = this.library
      .snapshot()
      .conversations.filter((c) => !c.pendingHold)
      .flatMap((c) =>
        (c.pendingInputs ?? [])
          .slice(0, 1)
          .filter((p) => p.status === 'queued')
          .map((input) => ({ id: c.id, input })),
      )
      .sort((a, b) => a.input.createdAt - b.input.createdAt);
    const next = available.find(({ id }) => {
      const task = this.host.latest(id);
      return (
        !task ||
        task.status === 'completed' ||
        task.status === 'cancelled' ||
        task.status === 'failed'
      );
    });
    if (!next) return;
    this.pumping = true;
    this.library.setPendingState(next.id, next.input.id, 'dispatching');
    try {
      const task = await this.host.dispatch(next.id, next.input);
      this.library.setPendingState(next.id, next.input.id, 'dispatching', undefined, task.id);
      this.library.completePending(next.id, next.input.id);
    } catch (error) {
      this.library.setPendingState(
        next.id,
        next.input.id,
        'needs_review',
        error instanceof ExecutionBlocked ? error.code : 'queue_dispatch_failed',
      );
      this.library.holdPending(next.id, true);
    } finally {
      this.pumping = false;
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    this.holdAll();
    await this.operations;
  }
}
