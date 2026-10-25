import { useState } from 'react';

import type { TeamTask } from '../../../core/src/team.js';
import { MessageMarkdown } from './MessageMarkdown.js';
export function OfficeQuestion({
  task,
  busy,
  action,
}: {
  task: TeamTask;
  busy: boolean;
  action: (path: string, body: unknown) => Promise<boolean>;
}) {
  const [answer, setAnswer] = useState('');
  const question = task.humanRequest;
  if (!question) return null;
  const send = (value: string) =>
    action('conversations/answer', { taskId: task.id, requestId: question.id, answer: value });
  return (
    <section className="chat-permission-box" aria-label="Pregunta del Jefe">
      <h2>El Jefe necesita tu respuesta</h2>
      <MessageMarkdown>{question.question}</MessageMarkdown>
      {question.responseType === 'approval' ? (
        <div className="chat-actions">
          <button disabled={busy} onClick={() => void send('approve')}>
            Aprobar y continuar
          </button>
          <button disabled={busy} onClick={() => void send('deny')}>
            Denegar
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(answer);
          }}
        >
          <label>
            Tu respuesta a esta pregunta
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              maxLength={7000}
              required
              disabled={busy}
              rows={3}
            />
          </label>
          <button disabled={busy || !answer.trim()} type="submit">
            Responder y continuar
          </button>
        </form>
      )}
      <p>
        La respuesta se guardará en esta conversación. Las acciones externas conservan su
        confirmación específica.
      </p>
    </section>
  );
}
