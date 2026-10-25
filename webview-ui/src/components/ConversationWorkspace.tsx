import './conversationWorkspace.css';

import { type ReactNode, useEffect, useRef, useState } from 'react';

import {
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_MESSAGE,
  type OfficeArtifact,
} from '../../../core/src/artifacts.js';
import type {
  ConversationLibrarySnapshot,
  ConversationMessage,
  SavedProject,
} from '../../../core/src/conversations.js';
import type { OfficeToolApproval } from '../../../core/src/officeTools.js';
import { TEAM_ROLES, type TeamSnapshot, type TeamTask } from '../../../core/src/team.js';
import { ArtifactGallery } from './ArtifactGallery.js';
import { AutonomyBudget } from './AutonomyBudget.js';
import {
  conversationDisplayMessages,
  conversationMessageGroups,
  conversationTask,
  executionState,
  isOfficeFinalDelivery,
  reasons,
  stateText,
} from './conversationState.js';
import { DeliveryEvidence } from './DeliveryEvidence.js';
import { ImageAttachments } from './ImageAttachments.js';
import { LiveOfficeActivity } from './LiveOfficeActivity.js';
import { MessageMarkdown } from './MessageMarkdown.js';
import { OfficeAuthentication } from './OfficeAuthentication.js';
import { OfficeQuestion } from './OfficeQuestion.js';
import { OfficeToolApprovals, OfficeToolsPanel } from './OfficeToolsPanel.js';
import { PendingConversationInputs } from './PendingConversationInputs.js';
import { ProjectChecksApproval } from './SavedConversations.js';
import { TaskBudgetControl } from './TeamWorkflowCard.js';
import { Button } from './ui/Button.js';

type Action = (path: string, body?: unknown) => Promise<boolean>;
const field = 'w-full bg-bg border border-border p-8 text-text';
function imageData(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.readAsDataURL(file);
  });
}
const currentQuotaRecovery = [
  'server_restarted',
  'server_stopped',
  'usage_unknown',
  'usage_unknown_after_restart',
];
const states: Record<TeamTask['status'], string> = {
  planned: 'Por confirmar',
  queued: 'Preparando el trabajo',
  checking: 'Comprobando la cuota',
  running: 'Trabajando',
  completed: 'Completado',
  paused: 'En pausa',
  blocked: 'Necesita tu revisión',
  failed: 'Error',
  cancelled: 'Cancelado',
};
function ExecutionStatus({ status }: { status: TeamTask['status'] }) {
  const tone =
    status === 'completed'
      ? 'success'
      : status === 'failed'
        ? 'error'
        : ['blocked', 'paused'].includes(status)
          ? 'review'
          : ['checking', 'queued', 'running'].includes(status)
            ? 'working'
            : 'neutral';
  const symbol = { success: '✓', error: '✕', review: '!', working: '◷', neutral: '○' }[tone];
  return (
    <span className={`chat-execution-status chat-execution-${tone}`}>
      <span aria-hidden="true">{symbol}</span> {states[status]}
    </span>
  );
}
function messageContent(message: ConversationMessage): string {
  if (message.kind === 'request')
    return message.officeAssignment
      ? `Encargo del Jefe: ${message.officeAssignment}`
      : message.content;
  return (
    stateText(message.content, message.reasonCode)
      .replace(/^OFFICE_RESULT\s+\{[^\n]*\}\s*$/gm, '')
      .replace(/^OFFICE_REVIEW\s+\{[^\n]*\}\s*$/gm, '')
      .trim()
      .replace(/^OFFICE_DECISION\s+(\{[^\n]*\})\s*$/gm, (_line, value: string) => {
        try {
          return String(JSON.parse(value).message ?? 'Decisión del Jefe registrada.');
        } catch {
          return 'El Jefe devolvió una decisión que necesita revisión.';
        }
      }) ||
    (message.status === 'running' ? 'Preparando la respuesta…' : 'Todavía no hay respuesta.')
  );
}

function ProjectForm({
  project,
  disabled,
  action,
  onSaved,
}: {
  project?: SavedProject;
  disabled: boolean;
  action: Action;
  onSaved?: () => void;
}) {
  const [path, setPath] = useState(project?.path ?? '');
  const [name, setName] = useState(project?.name ?? '');
  const [instructions, setInstructions] = useState(project?.instructions ?? '');
  const [picking, setPicking] = useState(false);
  const [pickerError, setPickerError] = useState('');
  async function chooseFolder() {
    setPicking(true);
    setPickerError('');
    try {
      const stateResponse = await fetch('/api/team');
      if (!stateResponse.ok) throw new Error('No se puede conectar con la oficina.');
      if (!stateResponse.headers.get('content-type')?.includes('application/json'))
        throw new Error(
          'No se puede conectar con el servidor local. Cierra y vuelve a abrir la oficina.',
        );
      const state = await stateResponse.json();
      const response = await fetch('/api/team/projects/pick-folder', {
        method: 'POST',
        headers: { 'X-Office-Control': state.controlToken, 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!response.headers.get('content-type')?.includes('application/json'))
        throw new Error(
          'El servidor de la oficina necesita actualizarse. Cierra la oficina con CERRAR-OFICINA y vuelve a abrirla con ABRIR-OFICINA.',
        );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.message ?? 'No se pudo abrir el selector de carpetas.');
      if (result.path) setPath(result.path);
    } catch (error) {
      setPickerError(
        error instanceof Error ? error.message : 'No se pudo abrir el selector de carpetas.',
      );
    } finally {
      setPicking(false);
      pathInput.current?.focus();
    }
  }
  const pathInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!project) pathInput.current?.focus();
  }, [project]);
  return (
    <form
      className="chat-project-form"
      onSubmit={(e) => {
        e.preventDefault();
        void action('projects', {
          project: path,
          name: name.trim() || undefined,
          instructions,
          openConversation: !project,
        }).then((ok) => {
          if (ok) onSaved?.();
        });
      }}
    >
      {!project && (
        <>
          <Button type="button" disabled={disabled || picking} onClick={() => void chooseFolder()}>
            {picking ? 'Esperando a Windows…' : 'Elegir carpeta…'}
          </Button>
          {pickerError && <p role="alert">{pickerError}</p>}
          {picking && (
            <p role="status">
              Selecciona la carpeta en la ventana de Windows. Si queda detrás del navegador, búscala
              con Alt + Tab. Solo se abrirá una ventana.
            </p>
          )}
        </>
      )}
      <label>
        Carpeta del proyecto
        <input
          ref={pathInput}
          aria-label="Carpeta del proyecto"
          required
          className={field}
          value={path}
          disabled={disabled || picking || !!project}
          onChange={(e) => setPath(e.target.value)}
          placeholder="Pega la ruta completa de la carpeta"
        />
      </label>
      <label>
        Nombre
        <input
          aria-label="Nombre del proyecto"
          className={field}
          value={name}
          maxLength={160}
          disabled={disabled}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <details className="chat-project-settings">
        <summary>Ajustes avanzados</summary>
        <label>
          Instrucciones adicionales
          <textarea
            aria-label="Instrucciones adicionales"
            className={field}
            rows={3}
            value={instructions}
            maxLength={8000}
            placeholder="Opcional: preferencias adicionales que no estén en AGENTS.md"
            disabled={disabled}
            onChange={(e) => setInstructions(e.target.value)}
          />
          <span>Codex lee los AGENTS.md aplicables. No necesitas repetir aquí sus reglas.</span>
        </label>
      </details>
      <Button type="submit" disabled={disabled || picking}>
        Guardar proyecto
      </Button>
    </form>
  );
}

function ProjectSettings({
  project,
  library,
  disabled,
  action,
}: {
  project: SavedProject;
  library: ConversationLibrarySnapshot;
  disabled: boolean;
  action: Action;
}) {
  const [confirmTurbo, setConfirmTurbo] = useState(false);
  const [projectAutonomy, setProjectAutonomy] = useState(project.autonomy !== false);
  useEffect(() => setProjectAutonomy(project.autonomy !== false), [project.id, project.autonomy]);
  return (
    <details className="chat-project-settings" open>
      <summary>Ajustes de {project.name}</summary>
      <ProjectForm project={project} disabled={disabled} action={action} />
      <label className="chat-check">
        <input
          type="checkbox"
          checked={projectAutonomy}
          disabled={disabled}
          onChange={(event) => {
            const enabled = event.target.checked;
            setProjectAutonomy(enabled);
            void action('projects/autonomy', {
              projectId: project.id,
              enabled,
            }).then((ok) => {
              if (!ok) setProjectAutonomy(project.autonomy !== false);
            });
          }}
        />
        Trabajar con autonomía en este proyecto
      </label>
      <p>
        Al enviar, la oficina puede ejecutar y modificar los archivos del proyecto. La preferencia
        se conserva al reiniciar.
      </p>
      <div hidden={project.autonomy !== false}>
        <section aria-label="Permisos TURBO" className="chat-permission-box">
          <strong>TURBO · {project.turbo ? 'activado' : 'desactivado'}</strong>
          <p>
            Permite cambios en los archivos de este proyecto sin pedir ese permiso en cada mensaje.
            Seguirás confirmando el uso de cuota. No aumenta los límites ni reanuda pausas.
          </p>
          {project.turbo ? (
            <Button
              disabled={disabled}
              onClick={() =>
                void action('projects/turbo', { projectId: project.id, enabled: false })
              }
            >
              Desactivar TURBO
            </Button>
          ) : !confirmTurbo ? (
            <Button disabled={disabled} onClick={() => setConfirmTurbo(true)}>
              Activar TURBO
            </Button>
          ) : (
            <div className="chat-permission-box">
              <p>
                ¿Permitir cambios futuros en <strong>{project.name}</strong> hasta que desactives
                TURBO? La preferencia se conservará al reiniciar.
              </p>
              <p className="chat-path">{project.path}</p>
              <div className="chat-actions">
                <Button
                  disabled={disabled}
                  onClick={() =>
                    void action('projects/turbo', { projectId: project.id, enabled: true }).then(
                      (ok) => {
                        if (ok) setConfirmTurbo(false);
                      },
                    )
                  }
                >
                  Sí, activar TURBO en este proyecto
                </Button>
                <Button onClick={() => setConfirmTurbo(false)}>Volver</Button>
              </div>
            </div>
          )}
        </section>
      </div>
      {project.autonomy === true ? (
        <p>Las pruebas locales del proyecto están autorizadas y se ejecutan cuando hacen falta.</p>
      ) : (
        <ProjectChecksApproval
          key={`${project.id}-${library.checks?.fingerprint}`}
          library={library}
          busy={disabled}
          action={action}
        />
      )}
    </details>
  );
}

function Message({
  message,
  finalDelivery = false,
}: {
  message: ConversationMessage;
  finalDelivery?: boolean;
}) {
  return (
    <article
      className={`chat-message chat-message-${message.kind}`}
      aria-label={`${message.kind === 'request' ? 'Petición' : 'Respuesta'} de ${TEAM_ROLES[message.role]}`}
    >
      <header>
        <strong>{message.kind === 'request' ? 'Tú' : TEAM_ROLES[message.role]}</strong>
        {finalDelivery && <span> · Resumen final</span>}
      </header>
      {message.kind === 'response' ? (
        <MessageMarkdown>{messageContent(message)}</MessageMarkdown>
      ) : (
        <pre>{messageContent(message)}</pre>
      )}
      <ArtifactGallery artifacts={message.attachments} label="Imágenes adjuntas" />
      <ArtifactGallery artifacts={message.artifacts} label="Resultados visuales" />
      {message.kind === 'response' && <DeliveryEvidence evidence={message.finalEvidence} />}
      {message.reasonCode && (
        <details className="chat-message-details">
          <summary>Detalles de esta entrega</summary>
          <ExecutionStatus status={message.status} />
          <p>{reasons[message.reasonCode] ?? stateText(message.content, message.reasonCode)}</p>
        </details>
      )}
    </article>
  );
}

function Messages({
  library,
  snapshot,
  busy,
  action,
  controls,
  approvals,
}: {
  library: ConversationLibrarySnapshot;
  snapshot: TeamSnapshot;
  busy: boolean;
  action: Action;
  controls: ReactNode;
  approvals: OfficeToolApproval[];
}) {
  const box = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const messages = library.selected?.messages ?? [];
  const last = conversationDisplayMessages(messages, snapshot.tasks).at(-1);
  useEffect(() => {
    if (follow.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [messages.length, last?.id, last?.content.length, last?.status]);
  return (
    <div
      ref={box}
      className="chat-messages"
      role="log"
      aria-label="Mensajes de la conversación"
      aria-live="polite"
      aria-relevant="additions text"
      onScroll={() => {
        const element = box.current!;
        follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 64;
      }}
    >
      {!messages.length && (
        <div className="chat-empty">
          <h2>¿En qué trabajamos?</h2>
          <p>Selecciona tu proyecto y escribe lo que necesitas. La oficina te responderá aquí.</p>
        </div>
      )}
      {conversationMessageGroups(messages, snapshot.tasks).map((group) =>
        group.internal ? (
          <section className="chat-activity-group" key={group.messages[0].id}>
            <details className="chat-activity">
              <summary>
                Ver actividad de la oficina ·{' '}
                {group.messages.filter((m) => m.kind === 'response').length} entregas
              </summary>
              {group.messages.map((message) => (
                <Message key={message.id} message={message} />
              ))}
            </details>
            <ArtifactGallery
              artifacts={Array.from(
                new Map(
                  group.messages
                    .flatMap((message) => message.artifacts ?? [])
                    .map((artifact) => [artifact.id, artifact]),
                ).values(),
              )}
              label="Resultados visuales de la oficina"
            />
          </section>
        ) : (
          <Message
            key={group.messages[0].id}
            message={group.messages[0]}
            finalDelivery={isOfficeFinalDelivery(group.messages[0], snapshot.tasks)}
          />
        ),
      )}
      {controls}
      <OfficeToolApprovals approvals={approvals} busy={busy} action={action} />
    </div>
  );
}

function Conversation({
  snapshot,
  library,
  busy,
  action,
  error,
  teamMode,
  setTeamMode,
}: {
  snapshot: TeamSnapshot;
  library: ConversationLibrarySnapshot;
  busy: boolean;
  action: Action;
  error: string;
  teamMode: boolean;
  setTeamMode: (value: boolean) => void;
}) {
  const [message, setMessage] = useState(library.selected?.draft ?? '');
  const [allowWrites, setAllowWrites] = useState(false);
  const [manualBudget, setManualBudget] = useState(false);
  const [resume, setResume] = useState(false);
  const [notice, setNotice] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [attachments, setAttachments] = useState<OfficeArtifact[]>(
    library.selected?.draftAttachments ?? [],
  );
  const [uploading, setUploading] = useState(false);
  const [attachmentError, setAttachmentError] = useState('');
  const uploadLock = useRef(false);
  async function attachImages(files: File[]) {
    if (uploadLock.current || busy || !library.selected || !library.writable || !files.length)
      return;
    setAttachmentError('');
    if (attachments.length + files.length > MAX_IMAGES_PER_MESSAGE) {
      setAttachmentError('Puedes adjuntar hasta diez imágenes por mensaje.');
      return;
    }
    if (files.some((file) => !['image/png', 'image/jpeg', 'image/webp'].includes(file.type))) {
      setAttachmentError('Solo se admiten imágenes PNG, JPEG y WebP.');
      return;
    }
    if (files.some((file) => file.size < 1 || file.size > MAX_IMAGE_BYTES)) {
      setAttachmentError('Cada imagen debe ocupar como máximo 20 MB y no estar vacía.');
      return;
    }
    uploadLock.current = true;
    submittedInputId.current = null;
    setUploading(true);
    const next = [...attachments];
    try {
      const stateResponse = await fetch('/api/team');
      if (
        !stateResponse.ok ||
        !stateResponse.headers.get('content-type')?.includes('application/json')
      )
        throw new Error('No se puede conectar con la oficina.');
      const state = await stateResponse.json();
      for (const file of files) {
        const response = await fetch('/api/team/attachments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Office-Control': state.controlToken },
          body: JSON.stringify({
            conversationId: library.selected.id,
            name: file.name,
            data: await imageData(file),
          }),
        });
        if (!response.headers.get('content-type')?.includes('application/json'))
          throw new Error(
            'El servidor no admite todavía los adjuntos. Reinicia la oficina después de actualizarla.',
          );
        const result = await response.json();
        if (!response.ok || !result.artifact)
          throw new Error(result.message ?? 'No se pudo guardar la imagen.');
        next.push(result.artifact);
        setAttachments([...next]);
      }
    } catch (error) {
      setAttachmentError(
        error instanceof Error ? error.message : 'No se pudieron guardar las imágenes.',
      );
    } finally {
      if (next.length !== attachments.length) {
        try {
          const saved = await action('conversations/draft', {
            id: library.selected.id,
            draft: message,
            attachmentIds: next.map((a) => a.id),
          });
          if (!saved)
            setAttachmentError(
              'Las imágenes se han guardado, pero falta guardar el borrador. Conservamos los adjuntos aquí; vuelve a pulsar «Guardar borrador».',
            );
        } catch {
          setAttachmentError(
            'No se pudo guardar el borrador. Conservamos las imágenes aquí para que puedas volver a intentarlo.',
          );
        }
      }
      uploadLock.current = false;
      setUploading(false);
    }
  }
  async function removeAttachment(id: string) {
    if (uploadLock.current || busy || !library.selected) return;
    uploadLock.current = true;
    submittedInputId.current = null;
    setUploading(true);
    setAttachmentError('');
    const next = attachments.filter((a) => a.id !== id);
    try {
      const saved = await action('conversations/draft', {
        id: library.selected.id,
        draft: message,
        attachmentIds: next.map((a) => a.id),
      });
      if (saved) setAttachments(next);
      else
        setAttachmentError('No se pudo quitar la imagen del borrador. Puedes volver a intentarlo.');
    } catch {
      setAttachmentError('No se pudo quitar la imagen del borrador. Puedes volver a intentarlo.');
    } finally {
      uploadLock.current = false;
      setUploading(false);
    }
  }
  const composer = useRef<HTMLTextAreaElement>(null);
  const main = useRef<HTMLElement>(null);
  const project = library.projects.find((p) => p.id === library.selectedProjectId);
  const latestTask = conversationTask(snapshot.tasks, library.selected?.id);
  const officeRoot =
    latestTask?.office && !['completed', 'cancelled'].includes(latestTask.status)
      ? latestTask
      : undefined;
  const task =
    officeRoot ??
    (latestTask && !['completed', 'failed', 'cancelled'].includes(latestTask.status)
      ? latestTask
      : undefined);
  const working = task && ['checking', 'running', 'queued'].includes(task.status);
  const queuedInputs = library.selected?.pendingInputs ?? [];
  const shouldQueue = !!task || snapshot.running || queuedInputs.length > 0;
  const canSteer = snapshot.capabilities?.steering === true;
  const submittedInputId = useRef<string | null>(null);
  const active = busy || snapshot.running;
  const pending = task && !working;
  const autonomous = project?.autonomy !== false && task?.budgetMode !== 'manual';
  const lastResponse = library.selected?.messages.filter((m) => m.kind === 'response').at(-1);
  const status = confirming
    ? 'checking'
    : (task?.status ?? latestTask?.status ?? lastResponse?.status);
  const reason = confirming ? null : latestTask ? latestTask.reasonCode : lastResponse?.reasonCode;
  const recordedState = status
    ? executionState(status, reason, (task ?? latestTask)?.explanation)
    : null;
  const hasEstimate =
    task?.budgetMode === 'codex' ||
    !snapshot.capabilities?.budgetReview ||
    !!task?.budgetReview ||
    (!!task?.estimate && task.estimate.confidence !== 'low' && task.estimate.tokens !== null);
  const executionBlocker = !library.writable
    ? 'No se puede guardar el encargo. Revisa el aviso de almacenamiento.'
    : !task?.choice && !autonomous
      ? 'Comprueba la disponibilidad del modelo antes de ejecutar.'
      : !hasEstimate
        ? 'Falta revisar el presupuesto: completa los tres límites y pulsa «Guardar cotas revisadas». Después podrás confirmar y ejecutar.'
        : snapshot.budgetReason &&
            !resume &&
            !(autonomous && currentQuotaRecovery.includes(snapshot.budgetReason))
          ? 'La oficina está en pausa. Revisa el motivo y marca «He revisado la pausa y quiero continuar con este encargo».'
          : null;
  const taskIds = new Set(library.selected?.messages.map((m) => m.taskId) ?? []);
  for (const t of snapshot.tasks)
    if (library.selected && t.conversationId === library.selected.id) taskIds.add(t.id);
  let size: number;
  do {
    size = taskIds.size;
    for (const t of snapshot.tasks)
      if (t.officeParentId && taskIds.has(t.officeParentId)) taskIds.add(t.id);
  } while (size !== taskIds.size);
  const approvals = (snapshot.toolApprovals ?? []).filter((a) => taskIds.has(a.taskId));
  const toolActivity = snapshot.tasks
    .filter((t) => taskIds.has(t.id) && t.status === 'running')
    .map((t) => t.toolActivity)
    .filter(Boolean)
    .at(-1);
  useEffect(() => {
    const element = composer.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = Math.min(200, Math.max(48, element.scrollHeight)) + 'px';
  }, [message]);
  async function sendMessage(immediate = false) {
    setNotice('');
    if (!message.trim() || !library.selected || uploading || uploadLock.current) return;
    void action(
      immediate
        ? 'conversations/apply-now'
        : shouldQueue
          ? 'conversations/queue'
          : project?.autonomy !== false && !manualBudget
            ? 'conversations/send'
            : 'conversations/prepare',
      {
        id: library.selected.id,
        inputId: (submittedInputId.current ??= crypto.randomUUID()),
        message,
        attachmentIds: attachments.map((a) => a.id),
        allowWrites,
        budgetMode: manualBudget ? 'manual' : 'codex',
        officeMode:
          teamMode && !manualBudget && snapshot.capabilities?.engine !== 'agent-orchestrator',
      },
    ).then((ok) => {
      if (ok) {
        submittedInputId.current = null;
        setMessage('');
        setAttachments([]);
        setAttachmentError('');
        setAllowWrites(false);
        setResume(false);
      }
    });
  }
  const pendingControls = pending && !task.humanRequest && (
    <section className="chat-permission-box" aria-label="Confirmar encargo">
      {autonomous && (
        <>
          <h2>{task.status === 'planned' ? 'Encargo preparado' : 'Revisar el encargo'}</h2>
          <p>La oficina tiene permiso para trabajar en este proyecto.</p>
          {executionBlocker && <p role="status">{executionBlocker}</p>}
          {task.reasonCode && <p>{reasons[task.reasonCode] ?? task.explanation}</p>}
        </>
      )}
      <div hidden={autonomous}>
        <h2>Antes de ejecutar</h2>
        {task.office && (
          <p>
            <strong>Autorización del objetivo:</strong> el Jefe podrá asignar y revisar varias
            subtareas y usar cuota en cada una, hasta terminar este objetivo o encontrar un bloqueo.
            Solo el Programador podrá escribir si autorizas archivos. Puedes detener toda la oficina
            en cualquier momento. No autoriza ampliar el objetivo ni publicar cambios. Las subtareas
            usan la asignación automática de modelos disponibles para cada papel.
          </p>
        )}
        {executionBlocker && (
          <p id="chat-execution-blocker" className="chat-blocker" role="status">
            {executionBlocker}
          </p>
        )}
        {snapshot.running && (
          <p role="status">Hay otro encargo en curso. Podrás ejecutar este cuando termine.</p>
        )}
        <p>
          <strong>Proyecto:</strong> {project?.name}
        </p>
        <p>
          <strong>Archivos:</strong>{' '}
          {task.allowWrites
            ? project?.turbo
              ? 'Cambios permitidos por TURBO en este proyecto.'
              : 'Esta confirmación permitirá modificar archivos en este proyecto, solo para este encargo.'
            : 'Solo lectura. No se permiten cambios en archivos.'}
        </p>
        <p>
          <strong>Cuota:</strong> se usará la incluida en tu suscripción de{' '}
          {task.choice?.provider === 'claude' ? 'Claude' : 'Codex'}. Se comprobará de nuevo antes de
          empezar.
        </p>
        {task.choice && (
          <p>
            Modelo: {task.choice.model} · razonamiento {task.choice.effort}.
          </p>
        )}
        {(task.reasonCode || snapshot.budgetReason) && (
          <p role="status">
            {reasons[task.reasonCode ?? snapshot.budgetReason!] ?? task.explanation}
          </p>
        )}
        {!task.requiresConfirmation && (
          <p>Este es un encargo de la cola anterior. Revísalo desde «Ver cola».</p>
        )}
        {task.requiresConfirmation && !task.choice && (
          <Button disabled={active} onClick={() => void action('assign', { id: task.id })}>
            Volver a comprobar disponibilidad
          </Button>
        )}
        {task.requiresConfirmation && task.budgetMode === 'codex' && (
          <p>
            Codex gestiona el contexto y su compactación. No necesitas introducir límites técnicos.
            Se comprueba la cuota de tu suscripción y se mantiene la cancelación y la supervisión
            del proceso. No hay un corte fijo por duración: puedes detenerlo cuando quieras.
          </p>
        )}
        {task.requiresConfirmation &&
          task.budgetMode !== 'codex' &&
          snapshot.capabilities?.budgetReview && (
            <>
              <p>
                {hasEstimate
                  ? 'El encargo tiene una estimación o una cota revisada. Se mantendrán los límites existentes.'
                  : 'Sin estimación fiable: hace falta revisar una cota. No se enviará el mensaje a un modelo hasta resolverlo.'}
              </p>
              <TaskBudgetControl
                task={task}
                snapshot={snapshot}
                disabled={active}
                action={action}
                defaultOpen={!hasEstimate}
              />
            </>
          )}
      </div>
      {snapshot.budgetReason &&
        !(autonomous && currentQuotaRecovery.includes(snapshot.budgetReason)) && (
          <label className="chat-check">
            <input type="checkbox" checked={resume} onChange={(e) => setResume(e.target.checked)} />
            He revisado la pausa y quiero continuar con este encargo.
          </label>
        )}
      <div className="chat-actions">
        {task.requiresConfirmation && (
          <Button
            variant="accent"
            disabled={active}
            aria-disabled={!!executionBlocker || active}
            aria-describedby={executionBlocker ? 'chat-execution-blocker' : undefined}
            onClick={() => {
              if (executionBlocker) {
                setNotice(executionBlocker);
                return;
              }
              setConfirming(true);
              void action(autonomous ? 'conversations/run-pending' : 'conversations/execute', {
                taskId: task.id,
                fingerprint: task.confirmationFingerprint,
                quotaConfirmed: true,
                writesConfirmed: task.allowWrites && !project?.turbo,
                resumeConfirmed:
                  resume ||
                  (autonomous && currentQuotaRecovery.includes(snapshot.budgetReason ?? '')),
              }).finally(() => {
                setResume(false);
                setConfirming(false);
              });
            }}
          >
            {confirming
              ? 'Comprobando…'
              : executionBlocker
                ? 'Revisar antes de ejecutar'
                : autonomous
                  ? 'Ejecutar'
                  : project?.turbo
                    ? 'Usar cuota y ejecutar'
                    : 'Confirmar y ejecutar'}
          </Button>
        )}
        <Button
          disabled={busy}
          onClick={() =>
            void action('cancel', { id: task.id }).then((ok) => {
              if (ok) {
                setMessage(task.prompt);
                setAttachments(task.attachments ?? []);
                setAttachmentError('');
                setManualBudget(task.budgetMode === 'manual');
                setTeamMode(!!task.office);
                setNotice('Puedes editar el mensaje antes de volver a enviarlo.');
                composer.current?.focus();
              }
            })
          }
        >
          Volver al mensaje
        </Button>
      </div>
    </section>
  );
  return (
    <main ref={main} className="chat-main">
      <Messages
        library={library}
        snapshot={snapshot}
        busy={busy}
        action={action}
        controls={
          <>
            {task?.humanRequest && (
              <OfficeQuestion key={task.humanRequest.id} task={task} busy={busy} action={action} />
            )}
            {pendingControls}
            <OfficeAuthentication
              entries={(snapshot.authentications ?? []).filter((entry) =>
                taskIds.has(entry.taskId),
              )}
              busy={busy}
              action={action}
            />
          </>
        }
        approvals={approvals}
      />
      <LiveOfficeActivity
        tasks={snapshot.tasks.filter(
          (t) => t.id === latestTask?.id || t.officeParentId === latestTask?.id,
        )}
        working={!!working}
        waiting={approvals.length > 0}
      />
      <section className="chat-current-state" aria-label="Estado del encargo" aria-live="polite">
        {(status || error) && (
          <ExecutionStatus status={error ? 'failed' : approvals.length ? 'blocked' : status!} />
        )}
        <span>
          {error
            ? 'La acción no se ha completado.'
            : approvals.length
              ? 'Esperando tu confirmación'
              : toolActivity ||
                (status && ['paused', 'blocked', 'failed'].includes(status)
                  ? recordedState?.detail
                  : !status
                    ? 'Lista para tu próxima petición'
                    : '')}
        </span>
        {approvals.length > 0 && (
          <Button
            onClick={() =>
              main.current
                ?.querySelector('.chat-tool-approvals')
                ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
            }
          >
            Ver confirmación
          </Button>
        )}
        {recordedState && (
          <details>
            <summary>Ver detalles</summary>
            <p>{recordedState.detail}</p>
            <p>{recordedState.next}</p>
            {officeRoot?.office && (
              <p>{stateText(officeRoot.office.summary, officeRoot.reasonCode)}</p>
            )}
            {reason && <code>{reason}</code>}
          </details>
        )}
        {working && (
          <Button disabled={busy} onClick={() => void action('cancel', { id: task.id })}>
            {task.office ? 'Detener la oficina' : 'Detener este encargo'}
          </Button>
        )}
      </section>
      <AutonomyBudget
        budget={
          task?.autonomyBudget ??
          [...(library.selected?.messages ?? [])]
            .reverse()
            .find((message) => message.origin !== 'internal' && message.autonomyBudget)
            ?.autonomyBudget
        }
        quota={snapshot.includedQuota?.find(
          (entry) => entry.provider === (task?.choice?.provider ?? 'codex'),
        )}
      />
      <div className="chat-composer">
        {library.selected && (
          <PendingConversationInputs
            conversationId={library.selected.id}
            inputs={queuedInputs}
            hold={library.selected.pendingHold === true}
            busy={busy}
            canSteer={canSteer}
            working={!!working}
            action={action}
          />
        )}
        {error && (
          <p id="chat-error" role="alert" className="chat-error">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {library.warning && <p role="alert">{library.warning}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendMessage();
          }}
          onDragOver={(e) => {
            if (!busy && !uploading) e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (!busy && !uploading) void attachImages(Array.from(e.dataTransfer.files));
          }}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length && !busy && !uploading) {
              e.preventDefault();
              void attachImages(files);
            }
          }}
        >
          <label className="chat-message-label">
            <span className="chat-sr-only">Tu mensaje</span>
            <textarea
              ref={composer}
              aria-label="Mensaje"
              aria-describedby={error ? 'chat-error' : 'chat-send-help'}
              className={field}
              value={message}
              onChange={(e) => {
                submittedInputId.current = null;
                setMessage(e.target.value);
                setNotice('');
              }}
              rows={1}
              placeholder="Escribe a la oficina…"
              maxLength={12000}
              required
              disabled={busy || uploading || !library.selected || !library.writable}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing &&
                  e.keyCode !== 229
                ) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
          </label>
          <ImageAttachments
            artifacts={attachments}
            disabled={busy || uploading || !library.selected || !library.writable}
            busy={uploading}
            error={attachmentError}
            onFiles={(files) => void attachImages(files)}
            onRemove={(id) => void removeAttachment(id)}
          />
          <details className="chat-composer-options">
            <summary>Opciones del encargo</summary>
            <label className="chat-check">
              <input
                type="checkbox"
                checked={
                  teamMode &&
                  !manualBudget &&
                  snapshot.capabilities?.engine !== 'agent-orchestrator'
                }
                disabled={
                  busy || manualBudget || snapshot.capabilities?.engine === 'agent-orchestrator'
                }
                onChange={(event) => setTeamMode(event.target.checked)}
              />
              El Jefe coordina al equipo hasta completar el objetivo
            </label>
            <p>
              {teamMode && !manualBudget && snapshot.capabilities?.engine !== 'agent-orchestrator'
                ? 'El Jefe organiza el trabajo y revisa las entregas hasta completar tu objetivo.'
                : 'Un encargo individual con Codex.'}
            </p>
            {snapshot.capabilities?.budgetReview && (
              <details className="chat-project-settings">
                <summary>Ajustes avanzados del encargo</summary>
                <label className="chat-check">
                  <input
                    type="checkbox"
                    checked={manualBudget}
                    disabled={busy}
                    onChange={(event) => setManualBudget(event.target.checked)}
                  />
                  Usar presupuesto manual para este encargo
                </label>
                <p>
                  Opcional. Añade cotas de tokens, duración y contexto que tendrás que revisar antes
                  de ejecutar. El modo normal utiliza la cuota de Codex sin pedirte esas cifras.
                </p>
              </details>
            )}
          </details>
          <div className="chat-actions">
            <Button
              type="submit"
              variant="accent"
              disabled={
                busy || uploading || !message.trim() || !library.selected || !library.writable
              }
            >
              {busy ? 'Preparando…' : shouldQueue ? 'Dejar pendiente' : 'Enviar'}
            </Button>
            {working && (
              <Button
                type="button"
                aria-label="Aplicar ahora"
                title={
                  canSteer
                    ? 'Incorporar esta indicación al trabajo actual'
                    : 'Este motor no admite indicaciones durante el trabajo.'
                }
                disabled={busy || uploading || !canSteer || !message.trim() || !library.writable}
                onClick={() => void sendMessage(true)}
              >
                ↑ Aplicar ahora
              </Button>
            )}
            <Button
              type="button"
              disabled={busy || uploading || !library.selected || !library.writable}
              onClick={() =>
                void action('conversations/draft', {
                  id: library.selected!.id,
                  draft: message,
                  attachmentIds: attachments.map((a) => a.id),
                }).then((ok) => {
                  if (ok) setNotice('Borrador guardado en este equipo.');
                })
              }
            >
              Guardar borrador
            </Button>
            {project?.autonomy !== false ? (
              <span>Permiso permanente para trabajar en este proyecto</span>
            ) : project?.turbo ? (
              <span>TURBO activo en {project.name}</span>
            ) : (
              <label className="chat-check">
                <input
                  type="checkbox"
                  checked={allowWrites}
                  onChange={(e) => setAllowWrites(e.target.checked)}
                  disabled={busy}
                />
                Permitir cambios en archivos para este mensaje
              </label>
            )}
          </div>
          <p id="chat-send-help">
            {shouldQueue
              ? 'Enviar guarda el mensaje para después de la entrega completa. Aplicar ahora cambia el trabajo actual.'
              : project?.autonomy !== false && !manualBudget
                ? 'Enviar inicia el trabajo. Recibirás los resultados aquí.'
                : 'Enviar prepara una confirmación de permisos y cuota.'}{' '}
            Enter para enviar · Mayús+Enter para una nueva línea.
          </p>
        </form>
      </div>
    </main>
  );
}

export function ConversationWorkspace({
  snapshot,
  busy,
  error,
  action,
  onClose,
  onQueue,
}: {
  snapshot: TeamSnapshot;
  busy: boolean;
  error: string;
  action: Action;
  onClose: () => void;
  onQueue: () => void;
}) {
  const library = snapshot.library!;
  const [search, setSearch] = useState('');
  const [teamMode, setTeamMode] = useState(true);
  const [addingProject, setAddingProject] = useState(() => !library.projects.length);
  const [navigationOpen, setNavigationOpen] = useState(() => {
    try {
      return localStorage.getItem('office-chat-navigation') !== 'closed' && window.innerWidth > 760;
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('office-chat-navigation', navigationOpen ? 'open' : 'closed');
    } catch {
      /* optional preference */
    }
  }, [navigationOpen]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  function minimizeNavigation() {
    if (window.innerWidth <= 760) setNavigationOpen(false);
    setAddingProject(false);
    requestAnimationFrame(() =>
      shell.current?.querySelector<HTMLTextAreaElement>('textarea[aria-label="Mensaje"]')?.focus(),
    );
  }
  const project = library.projects.find((p) => p.id === library.selectedProjectId);
  const shell = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    shell.current?.focus();
    return () => previous?.focus();
  }, []);
  const conversations = library.conversations.filter(
    (c) =>
      c.projectId === project?.id &&
      c.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  return (
    <section
      ref={shell}
      tabIndex={-1}
      className="chat-workspace"
      role="dialog"
      aria-label="Conversaciones"
      aria-modal="true"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          onClose();
          return;
        }
        if (e.key === 'Tab') {
          const focusable = Array.from(
            shell.current!.querySelectorAll<HTMLElement>(
              'button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), summary',
            ),
          ).filter((element) => element.getClientRects().length);
          if (!focusable.length) return;
          const first = focusable[0],
            last = focusable.at(-1)!;
          if (
            e.shiftKey &&
            (document.activeElement === first || document.activeElement === shell.current)
          ) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }}
    >
      <header className="chat-workspace-header">
        <Button
          aria-label="Proyecto e historial"
          aria-expanded={navigationOpen}
          aria-controls="chat-sidebar"
          onClick={() => setNavigationOpen((value) => !value)}
        >
          ☰
        </Button>
        <div className="chat-header-title">
          <h1>{library.selected?.title ?? 'Nueva conversación'}</h1>
          <span>{project?.name ?? 'Elige un proyecto'}</span>
        </div>
        <details className="chat-header-menu">
          <summary aria-label="Menú de conversación">•••</summary>
          <div
            onClick={(event) => {
              if ((event.target as HTMLElement).closest('button'))
                event.currentTarget.parentElement?.removeAttribute('open');
            }}
          >
            <Button
              aria-expanded={toolsOpen}
              aria-controls="chat-office-tools"
              onClick={() => {
                setToolsOpen((value) => !value);
              }}
            >
              Herramientas y conexiones
            </Button>
            <Button onClick={onQueue}>Ver cola</Button>
            <Button disabled={!project} onClick={() => setSettingsOpen((value) => !value)}>
              Ajustes del proyecto
            </Button>
            <Button onClick={onClose}>Ver oficina</Button>
            {library.selected && (
              <Button
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob(
                      [JSON.stringify({ conversation: library.selected, project }, null, 2)],
                      { type: 'application/json' },
                    ),
                  );
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = 'conversacion-' + library.selected!.id + '.json';
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                Descargar conversación
              </Button>
            )}
          </div>
        </details>
      </header>
      {toolsOpen && <OfficeToolsPanel snapshot={snapshot} busy={busy} action={action} />}
      {settingsOpen && project && (
        <section className="chat-settings-panel" aria-label="Ajustes del proyecto">
          <Button onClick={() => setSettingsOpen(false)}>Cerrar ajustes</Button>
          <ProjectSettings
            key={project.id}
            project={project}
            library={library}
            disabled={busy || snapshot.running || !library.writable}
            action={action}
          />
        </section>
      )}
      <div className={`chat-workspace-body${navigationOpen ? '' : ' chat-navigation-collapsed'}`}>
        {navigationOpen && (
          <button
            className="chat-sidebar-scrim"
            aria-label="Cerrar historial"
            onClick={() => setNavigationOpen(false)}
          />
        )}
        <aside
          id="chat-sidebar"
          className="chat-sidebar"
          aria-label="Proyectos y conversaciones"
          hidden={!navigationOpen}
        >
          <div className="chat-navigation-content">
            <label>
              Proyecto
              <select
                aria-label="Proyecto"
                className={field}
                value={project?.id ?? ''}
                disabled={busy || !library.writable}
                onChange={(e) =>
                  void action('projects/select', { projectId: e.target.value }).then((ok) => {
                    if (ok) minimizeNavigation();
                  })
                }
              >
                <option value="" disabled>
                  Elige un proyecto
                </option>
                {library.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              disabled={busy || !library.writable}
              aria-expanded={addingProject}
              aria-controls="chat-add-project"
              onClick={() => setAddingProject((value) => !value)}
            >
              {addingProject ? 'Cancelar nuevo proyecto' : 'Añadir proyecto'}
            </Button>
            {addingProject && (
              <div id="chat-add-project">
                <p>
                  Elige una carpeta de este equipo para guardar el proyecto. También puedes pegar su
                  ruta.
                </p>
                <ProjectForm
                  disabled={busy || snapshot.running || !library.writable}
                  action={action}
                  onSaved={minimizeNavigation}
                />
              </div>
            )}
            <Button
              disabled={busy || !project || !library.writable}
              onClick={() =>
                void action('conversations', { projectId: project!.id }).then((ok) => {
                  if (ok) minimizeNavigation();
                })
              }
            >
              Nueva conversación
            </Button>
            <label>
              Buscar conversación
              <input
                aria-label="Buscar conversación"
                className={field}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <nav aria-label="Conversaciones guardadas" className="chat-history">
              {conversations.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  aria-pressed={c.id === library.selected?.id}
                  disabled={busy || !library.writable}
                  onClick={() =>
                    void action('conversations/select', { id: c.id }).then((ok) => {
                      if (ok) minimizeNavigation();
                    })
                  }
                >
                  {c.title}
                  {!!c.pendingInputs?.length && (
                    <span className="chat-history-pending">
                      {' '}
                      · {c.pendingInputs.length} pendientes
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </div>
        </aside>
        <Conversation
          key={library.selected?.id ?? library.selectedProjectId ?? 'empty'}
          snapshot={snapshot}
          library={library}
          busy={busy}
          action={action}
          error={error}
          teamMode={teamMode}
          setTeamMode={setTeamMode}
        />
      </div>
    </section>
  );
}
