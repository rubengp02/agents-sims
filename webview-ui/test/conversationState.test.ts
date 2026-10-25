import { describe, expect, it } from 'vitest';

import type { TeamTask } from '../../core/src/team.js';
import {
  conversationTask,
  executionState,
  stateText,
} from '../src/components/conversationState.js';

describe('recorded conversation states', () => {
  it('uses the latest objective, ignoring older pauses, child deliveries and other conversations', () => {
    const tasks = [
      { id: 'old', conversationId: 'chat', status: 'paused' },
      { id: 'current', conversationId: 'chat', status: 'running' },
      { id: 'child', conversationId: 'chat', status: 'completed', officeParentId: 'current' },
      { id: 'other', conversationId: 'another-chat', status: 'failed' },
    ] as TeamTask[];
    expect(conversationTask(tasks, 'chat')?.id).toBe('current');
    expect(conversationTask(tasks, undefined)).toBeUndefined();
  });
  it.each(['project_changed_during_read', 'review_changed_files'])(
    'describes %s as observed changes without identifying an author',
    (reason) => {
      const state = executionState('paused', reason);
      expect(state.detail).toContain('no permite identificar quién');
      expect(state.next).toContain('estado actualizado');
      expect(state.detail).not.toContain('Un empleado');
    },
  );
  it('corrects the legacy attribution in display without changing unrelated model text', () => {
    const text = 'Un empleado de solo lectura modificó archivos. Se necesita revisión.';
    expect(stateText(text, 'review_changed_files')).not.toContain('Un empleado');
    expect(stateText(text, 'server_restarted')).not.toContain('Un empleado');
    expect(stateText(text, null)).toBe(text);
  });
  it('does not invent a cause for an unknown reason or equate completion with human approval', () => {
    expect(
      executionState('paused', 'unknown-code', 'Motivo comunicado por el servidor').detail,
    ).toBe('Motivo comunicado por el servidor');
    expect(executionState('completed').next).toContain('aprobación final');
    expect(executionState('running').title).toBe('Trabajo en curso');
  });
});
