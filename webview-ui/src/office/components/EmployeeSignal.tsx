import './employeeSignal.css';

import { useState } from 'react';

import type { OfficePresence } from '../../../../core/src/officePresence.js';

export function EmployeeSignal({
  employee,
  disconnected,
  onOpenConversation,
}: {
  employee: OfficePresence;
  disconnected?: boolean;
  onOpenConversation?: () => void;
}) {
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  const signal = employee.signal;
  const label = disconnected ? 'Sin conexión' : (signal?.label ?? employee.status);
  const tone = disconnected ? 'paused' : (signal?.tone ?? 'neutral');
  const open = async () => {
    if (!signal?.conversationId || !onOpenConversation || opening) return;
    setOpening(true);
    setError('');
    try {
      const state = await fetch('/api/team', { cache: 'no-store' });
      if (!state.ok) throw new Error();
      const { controlToken } = await state.json();
      if (typeof controlToken !== 'string') throw new Error();
      const response = await fetch('/api/team/conversations/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Office-Control': controlToken },
        body: JSON.stringify({ id: signal.conversationId }),
      });
      if (!response.ok) throw new Error();
      onOpenConversation();
    } catch {
      setError('No se pudo abrir la conversación.');
    } finally {
      setOpening(false);
    }
  };
  return (
    <div
      className="employee-signal"
      data-tone={tone}
      data-active={!disconnected && signal?.active === true}
    >
      <span className="employee-signal-name">{employee.name}</span>
      {signal?.conversationId && onOpenConversation ? (
        <button
          type="button"
          disabled={opening || disconnected}
          onClick={() => void open()}
          title="Abrir conversación y evidencias"
          aria-label={`${employee.name}: ${label}. Abrir conversación y evidencias`}
        >
          <span className="employee-signal-dot" aria-hidden="true" />
          {label}
        </button>
      ) : (
        <span>
          <span className="employee-signal-dot" aria-hidden="true" />
          {label}
        </span>
      )}
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
