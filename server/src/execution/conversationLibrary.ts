import { createHash, randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { type OfficeArtifact, validateArtifactReference } from '../../../core/src/artifacts.js';
import type {
  ConversationLibrarySnapshot,
  PendingConversationInput,
  ProjectCheckCatalog,
  SavedConversation,
  SavedProject,
} from '../../../core/src/conversations.js';
import { validObjectiveBudget } from '../../../core/src/objectiveBudget.js';
import type { TaskContext, TeamTask } from '../../../core/src/team.js';
import { type LocalCheckCommand, LocalChecks } from './localChecks.js';
import { validateContext } from './taskContext.js';
import { ExecutionBlocked } from './types.js';

interface LibraryData {
  version: 1;
  projects: SavedProject[];
  conversations: SavedConversation[];
  selectedId: string | null;
  selectedProjectId: string | null;
}
const empty = (): LibraryData => ({
  version: 1,
  projects: [],
  conversations: [],
  selectedId: null,
  selectedProjectId: null,
});
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const scriptIds = ['check-types', 'lint', 'test', 'package'] as const;
const MAX_BYTES = 64 * 1024 * 1024;
const inputIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
type NewPendingInput = Pick<PendingConversationInput, 'id' | 'content' | 'officeMode'> &
  Partial<Pick<PendingConversationInput, 'attachments' | 'allowWrites' | 'budgetMode'>>;

function validateInputId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !inputIdPattern.test(id))
    throw new ExecutionBlocked(
      'invalid_pending_input',
      'El identificador del mensaje no es válido.',
    );
}
function validateAttachments(
  attachments: unknown,
  conversationId: string,
): asserts attachments is OfficeArtifact[] | undefined {
  if (attachments === undefined) return;
  if (
    !Array.isArray(attachments) ||
    attachments.length > 10 ||
    attachments.some((a) => !validateArtifactReference(a) || a.conversationId !== conversationId) ||
    new Set(attachments.map((a: OfficeArtifact) => a.id)).size !== attachments.length
  )
    throw new ExecutionBlocked('invalid_pending_attachments', 'Revisa las imágenes del mensaje.');
}
function validatePending(input: PendingConversationInput, conversationId: string): void {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) =>
        ![
          'id',
          'content',
          'attachments',
          'officeMode',
          'allowWrites',
          'budgetMode',
          'createdAt',
          'updatedAt',
          'status',
          'revision',
          'reason',
          'taskId',
        ].includes(key),
    )
  )
    throw new ExecutionBlocked('invalid_pending_input', 'Revisa el mensaje pendiente.');
  validateInputId(input.id);
  text(input.content, 12000, 'el mensaje');
  validateAttachments(input.attachments, conversationId);
  if (
    typeof input.officeMode !== 'boolean' ||
    (input.allowWrites !== undefined && typeof input.allowWrites !== 'boolean') ||
    (input.budgetMode !== undefined && !['codex', 'manual'].includes(input.budgetMode)) ||
    !Number.isSafeInteger(input.createdAt) ||
    input.createdAt < 0 ||
    !Number.isSafeInteger(input.updatedAt) ||
    input.updatedAt < input.createdAt ||
    !['queued', 'dispatching', 'needs_review'].includes(input.status) ||
    !Number.isSafeInteger(input.revision) ||
    input.revision < 1
  )
    throw new ExecutionBlocked('invalid_pending_input', 'Revisa el mensaje pendiente.');
  if (input.reason !== undefined) text(input.reason, 2000, 'el motivo', true);
  if (input.taskId !== undefined) text(input.taskId, 100, 'la tarea');
}

function text(value: unknown, limit: number, label: string, blank = false): string {
  if (typeof value !== 'string' || (!blank && !value.trim()) || value.length > limit)
    throw new ExecutionBlocked('invalid_library_input', `Revisa ${label}.`);
  return value;
}

/** Local, independent conversation archive. Neither HTTP nor a model supplies commands. */
export class ConversationLibrary {
  private data = empty();
  private warning: string | null = null;
  private writable = true;
  private damaged = false;
  private dirty = false;
  private readonly file: string;
  private readonly runners = new Map<string, LocalChecks>();
  get canWrite() {
    return this.writable;
  }
  constructor(
    private readonly directory: string,
    private readonly npmCli = process.env.npm_execpath ??
      join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
  ) {
    this.file = join(directory, 'conversations.json');
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
    } catch {
      this.writable = false;
      this.warning =
        'No se puede abrir la carpeta del historial. Revisa los permisos; la oficina no iniciará nuevos encargos.';
      return;
    }
    if (!existsSync(this.file) && !existsSync(this.file + '.bak')) return;
    try {
      this.data = this.read(this.file);
    } catch {
      try {
        this.data = this.read(this.file + '.bak');
        this.damaged = existsSync(this.file);
        this.warning =
          'Se ha recuperado la copia de seguridad. El archivo dañado se conserva; revisa los últimos mensajes.';
      } catch {
        this.writable = false;
        this.warning =
          'No se puede leer el historial ni su copia de seguridad. Se conservan los archivos; no se guardarán cambios hasta recuperarlos.';
      }
    }
    for (const conversation of this.data.conversations) {
      if (conversation.pendingInputs?.length) {
        conversation.pendingHold = true;
        for (const input of conversation.pendingInputs) {
          if (input.status === 'dispatching') {
            input.status = 'needs_review';
            input.reason =
              'La oficina se reinició durante el envío. Revisa su resultado antes de continuar.';
            input.updatedAt = Math.max(Date.now(), input.createdAt);
            input.revision++;
          }
        }
      }
      for (const message of conversation.messages)
        if (['running', 'checking', 'queued', 'planned'].includes(message.status)) {
          message.status = 'paused';
          message.reasonCode = 'server_restarted';
        }
    }
  }

  private read(file: string): LibraryData {
    if (statSync(file).size > MAX_BYTES) throw new Error('archive_too_large');
    const data: LibraryData = JSON.parse(readFileSync(file, 'utf8'));
    if (data.version !== 1 || !Array.isArray(data.projects) || !Array.isArray(data.conversations))
      throw new Error('invalid_archive');
    const ids = new Set<string>();
    for (const project of data.projects) {
      if (!/^[\w-]{1,100}$/.test(project.id)) throw new Error('invalid_id');
      if (ids.has(project.id) || !isAbsolute(project.path)) throw new Error('invalid_project');
      ids.add(project.id);
      text(project.name, 160, 'el nombre');
      text(project.instructions, 8000, 'las instrucciones', true);
      if (project.turbo !== undefined && typeof project.turbo !== 'boolean')
        throw new Error('invalid_turbo');
      if (project.autonomy !== undefined && typeof project.autonomy !== 'boolean')
        throw new Error('invalid_autonomy');
      if (project.context) validateContext(project.context);
      if (
        project.checksApproval &&
        (!/^[a-f0-9]{64}$/.test(project.checksApproval.fingerprint) ||
          !Array.isArray(project.checksApproval.ids) ||
          project.checksApproval.ids.some(
            (id) => !scriptIds.includes(id as (typeof scriptIds)[number]),
          ) ||
          !Number.isSafeInteger(project.checksApproval.approvedAt))
      )
        throw new Error('invalid_approval');
    }
    const conversationIds = new Set<string>();
    const inputOwners = new Map<string, string>();
    const inputOwner = (inputId: string, conversationId: string) => {
      if (inputOwners.has(inputId) && inputOwners.get(inputId) !== conversationId)
        throw new Error('invalid_input_owner');
      inputOwners.set(inputId, conversationId);
    };
    for (const conversation of data.conversations) {
      if (!/^[\w-]{1,100}$/.test(conversation.id)) throw new Error('invalid_id');
      if (
        conversationIds.has(conversation.id) ||
        !ids.has(conversation.projectId) ||
        !Array.isArray(conversation.messages)
      )
        throw new Error('invalid_conversation');
      conversationIds.add(conversation.id);
      text(conversation.title, 160, 'el título');
      text(conversation.draft, 12000, 'el borrador', true);
      if (conversation.pendingHold !== undefined && typeof conversation.pendingHold !== 'boolean')
        throw new Error('invalid_pending_hold');
      if (conversation.pendingInputs !== undefined) {
        if (!Array.isArray(conversation.pendingInputs) || conversation.pendingInputs.length > 100)
          throw new Error('invalid_pending');
        const pendingIds = new Set<string>();
        for (const input of conversation.pendingInputs) {
          validatePending(input, conversation.id);
          inputOwner(input.id, conversation.id);
          if (pendingIds.has(input.id)) throw new Error('duplicate_pending');
          pendingIds.add(input.id);
        }
      }
      if (
        conversation.draftAttachments !== undefined &&
        (!Array.isArray(conversation.draftAttachments) ||
          conversation.draftAttachments.length > 10 ||
          conversation.draftAttachments.some(
            (a) => !validateArtifactReference(a) || a.conversationId !== conversation.id,
          ))
      )
        throw new Error('invalid_artifact');
      for (const message of conversation.messages) {
        if (
          !['request', 'response'].includes(message.kind) ||
          !['chief', 'developer', 'designer', 'architect', 'tester'].includes(message.role) ||
          ![
            'planned',
            'queued',
            'checking',
            'running',
            'completed',
            'paused',
            'blocked',
            'failed',
            'cancelled',
          ].includes(message.status)
        )
          throw new Error('invalid_message');
        text(message.id, 120, 'el mensaje');
        if (message.autonomyBudget !== undefined && !validObjectiveBudget(message.autonomyBudget))
          throw new Error('invalid_objective_budget');
        text(message.taskId, 100, 'la tarea');
        text(message.content, MAX_BYTES, 'el contenido', true);
        if (message.origin !== undefined && !['user', 'internal'].includes(message.origin))
          throw new Error('invalid_message_origin');
        if (message.inputId !== undefined) {
          validateInputId(message.inputId);
          inputOwner(message.inputId, conversation.id);
        }
        for (const key of ['attachments', 'artifacts'] as const)
          if (
            message[key] !== undefined &&
            (!Array.isArray(message[key]) ||
              message[key]!.some(
                (a) => !validateArtifactReference(a) || a.conversationId !== conversation.id,
              ))
          )
            throw new Error('invalid_artifact');
        if (message.officeAssignment !== undefined)
          text(message.officeAssignment, 160, 'el encargo');
      }
    }
    if (data.selectedId !== null && !conversationIds.has(data.selectedId))
      throw new Error('invalid_selection');
    if (data.selectedProjectId !== null && !ids.has(data.selectedProjectId))
      throw new Error('invalid_selection');
    return data;
  }

  private save(next: LibraryData): void {
    if (!this.writable) throw new ExecutionBlocked('history_unavailable', this.warning!);
    const serialized = JSON.stringify(next);
    if (Buffer.byteLength(serialized) > MAX_BYTES)
      throw new ExecutionBlocked(
        'history_full',
        'El historial ha alcanzado su límite local. Exporta una copia antes de continuar. No se han borrado mensajes.',
      );
    try {
      if (this.damaged) {
        copyFileSync(this.file, this.file + `.damaged-${randomUUID()}`);
      } else if (existsSync(this.file)) copyFileSync(this.file, this.file + '.bak');
      writeFileSync(this.file + '.tmp', serialized, { mode: 0o600 });
      renameSync(this.file + '.tmp', this.file);
      this.data = next;
      this.damaged = false;
      this.dirty = false;
      if (this.warning?.startsWith('No se ha podido guardar')) this.warning = null;
    } catch {
      this.data = next;
      this.dirty = true;
      this.warning =
        'No se ha podido guardar el último cambio. Se conserva en memoria; no cierres la oficina hasta resolver el error de espacio o permisos.';
      throw new ExecutionBlocked(
        'history_write_failed',
        'No se ha podido guardar la conversación. Revisa el espacio y los permisos de la carpeta local.',
      );
    }
  }

  project(id: string): SavedProject {
    const project = this.data.projects.find((p) => p.id === id);
    if (!project) throw new ExecutionBlocked('project_unknown', 'Elige un proyecto guardado.');
    return structuredClone(project);
  }
  projectAt(path: string): SavedProject | undefined {
    return structuredClone(this.data.projects.find((p) => p.path === path));
  }
  conversation(id: string): SavedConversation {
    const conversation = this.data.conversations.find((c) => c.id === id);
    if (!conversation)
      throw new ExecutionBlocked('conversation_unknown', 'La conversación no existe.');
    return structuredClone(conversation);
  }
  register(
    path: string,
    name?: string,
    instructions?: string,
    context?: TaskContext,
  ): SavedProject {
    let canonical: string;
    try {
      canonical = realpathSync(text(path, 4000, 'la carpeta'));
      if (!statSync(canonical).isDirectory()) throw new Error();
    } catch {
      throw new ExecutionBlocked(
        'invalid_project',
        'La carpeta del proyecto no existe. El historial anterior sigue disponible.',
      );
    }
    const archiveRelative = relative(canonical, realpathSync(this.directory));
    if (!archiveRelative || (!archiveRelative.startsWith('..') && !isAbsolute(archiveRelative)))
      throw new ExecutionBlocked(
        'project_contains_history',
        'Elige la carpeta concreta del proyecto, sin incluir el almacén privado de conversaciones.',
      );
    const previous = this.projectAt(canonical);
    const project: SavedProject = {
      ...previous,
      id: previous?.id ?? randomUUID(),
      name:
        name === undefined
          ? (previous?.name ?? basename(canonical))
          : text(name, 160, 'el nombre').trim(),
      path: canonical,
      instructions:
        instructions === undefined
          ? (previous?.instructions ?? '')
          : text(instructions, 8000, 'las instrucciones', true),
      context: context === undefined ? previous?.context : validateContext(context),
    };
    const next = structuredClone(this.data);
    next.projects = [...next.projects.filter((p) => p.id !== project.id), project];
    next.selectedProjectId = project.id;
    if (!next.conversations.some((c) => c.id === next.selectedId && c.projectId === project.id))
      next.selectedId =
        next.conversations.filter((c) => c.projectId === project.id).at(-1)?.id ?? null;
    this.save(next);
    return structuredClone(project);
  }
  create(projectId: string, title = 'Nueva conversación'): SavedConversation {
    this.project(projectId);
    const conversation: SavedConversation = {
      id: randomUUID(),
      projectId,
      title: text(title, 160, 'el título').trim(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      draft: '',
      messages: [],
    };
    const next = structuredClone(this.data);
    next.conversations.push(conversation);
    next.selectedId = conversation.id;
    next.selectedProjectId = projectId;
    this.save(next);
    return structuredClone(conversation);
  }
  setTurbo(projectId: string, enabled: boolean): void {
    this.project(projectId);
    if (typeof enabled !== 'boolean')
      throw new ExecutionBlocked(
        'invalid_turbo',
        'Indica si quieres activar o desactivar TURBO para este proyecto.',
      );
    const next = structuredClone(this.data);
    next.projects.find((p) => p.id === projectId)!.turbo = enabled;
    this.save(next);
  }
  setAutonomy(projectId: string, enabled: boolean): void {
    this.project(projectId);
    if (typeof enabled !== 'boolean')
      throw new ExecutionBlocked(
        'invalid_autonomy',
        'Indica si quieres autonomía en este proyecto.',
      );
    const next = structuredClone(this.data);
    next.projects.find((p) => p.id === projectId)!.autonomy = enabled;
    this.save(next);
  }
  selectProject(projectId: string): void {
    this.project(projectId);
    const conversation = this.data.conversations
      .filter((c) => c.projectId === projectId)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (conversation) this.select(conversation.id);
    else this.create(projectId);
  }
  select(id: string): void {
    const conversation = this.conversation(id);
    this.save({ ...this.data, selectedId: id, selectedProjectId: conversation.projectId });
  }
  draft(id: string, draft: string, attachments?: OfficeArtifact[]): void {
    const next = structuredClone(this.data);
    const conversation = next.conversations.find((c) => c.id === id);
    if (!conversation)
      throw new ExecutionBlocked('conversation_unknown', 'La conversación no existe.');
    conversation.draft = text(draft, 12000, 'el mensaje', true);
    if (attachments !== undefined) conversation.draftAttachments = structuredClone(attachments);
    this.save(next);
  }
  enqueue(id: string, input: NewPendingInput): PendingConversationInput {
    const current = this.conversation(id);
    if (
      !input ||
      typeof input !== 'object' ||
      Object.keys(input).some(
        (key) =>
          !['id', 'content', 'officeMode', 'attachments', 'allowWrites', 'budgetMode'].includes(
            key,
          ),
      )
    )
      throw new ExecutionBlocked('invalid_pending_input', 'Revisa el mensaje pendiente.');
    const now = Date.now();
    const candidate: PendingConversationInput = {
      ...structuredClone(input),
      createdAt: now,
      updatedAt: now,
      status: 'queued',
      revision: 1,
    };
    validatePending(candidate, id);
    const payload = (value: NewPendingInput) =>
      JSON.stringify({
        id: value.id,
        content: value.content,
        officeMode: value.officeMode,
        attachments: value.attachments ?? [],
        allowWrites: value.allowWrites,
        budgetMode: value.budgetMode,
      });
    const previous = current.pendingInputs?.find((p) => p.id === input.id);
    if (previous) {
      if (payload(previous) !== payload(input))
        throw new ExecutionBlocked(
          'pending_conflict',
          'Este mensaje ya existe con otro contenido. Actualiza la conversación.',
        );
      if (this.dirty) this.save(this.data);
      return previous;
    }
    if (
      current.messages.some((m) => m.inputId === input.id) ||
      this.data.conversations.some(
        (c) =>
          c.id !== id &&
          (c.pendingInputs?.some((p) => p.id === input.id) ||
            c.messages.some((m) => m.inputId === input.id)),
      )
    )
      throw new ExecutionBlocked(
        'pending_already_delivered',
        'Este mensaje ya se ha entregado o pertenece a otra conversación.',
      );
    if ((current.pendingInputs?.length ?? 0) >= 100)
      throw new ExecutionBlocked(
        'pending_full',
        'Hay 100 mensajes pendientes. Retira alguno antes de añadir otro.',
      );
    const next = structuredClone(this.data);
    const conversation = next.conversations.find((c) => c.id === id)!;
    (conversation.pendingInputs ??= []).push(candidate);
    conversation.updatedAt = now;
    this.save(next);
    return structuredClone(candidate);
  }
  updatePending(
    id: string,
    inputId: string,
    revision: number,
    patch: {
      content?: string;
      attachments?: OfficeArtifact[];
    },
  ): PendingConversationInput {
    const next = structuredClone(this.data);
    const input = this.pendingForUpdate(next, id, inputId, revision);
    if (input.status === 'dispatching' || input.taskId)
      throw new ExecutionBlocked(
        'pending_busy',
        'El mensaje ya está siendo enviado o necesita revisar su entrega.',
      );
    if (
      !patch ||
      typeof patch !== 'object' ||
      Object.keys(patch).some((key) => !['content', 'attachments'].includes(key))
    )
      throw new ExecutionBlocked('invalid_pending_input', 'Revisa el mensaje pendiente.');
    if (patch.content !== undefined) input.content = text(patch.content, 12000, 'el mensaje');
    if (patch.attachments !== undefined) {
      validateAttachments(patch.attachments, id);
      input.attachments = structuredClone(patch.attachments);
    }
    this.touchPending(input);
    this.save(next);
    return structuredClone(input);
  }
  removePending(id: string, inputId: string, revision: number): void {
    const next = structuredClone(this.data);
    const input = this.pendingForUpdate(next, id, inputId, revision);
    if (input.status === 'dispatching')
      throw new ExecutionBlocked('pending_busy', 'El mensaje ya está siendo enviado.');
    const conversation = next.conversations.find((c) => c.id === id)!;
    conversation.pendingInputs = conversation.pendingInputs!.filter((p) => p.id !== inputId);
    this.save(next);
  }
  pendingInputs(conversationId?: string): PendingConversationInput[] {
    if (conversationId) return this.conversation(conversationId).pendingInputs ?? [];
    return structuredClone(this.data.conversations.flatMap((c) => c.pendingInputs ?? []));
  }
  setPendingState(
    id: string,
    inputId: string,
    status: PendingConversationInput['status'],
    reason?: string,
    taskId?: string,
  ): PendingConversationInput {
    const next = structuredClone(this.data);
    const input = this.pendingForUpdate(next, id, inputId);
    input.status = status;
    input.reason = reason;
    // Retain the task association while an uncertain dispatch is under review.
    if (taskId !== undefined) input.taskId = taskId;
    this.touchPending(input);
    validatePending(input, id);
    this.save(next);
    return structuredClone(input);
  }
  holdPending(id: string, held: boolean): void {
    this.conversation(id);
    if (typeof held !== 'boolean')
      throw new ExecutionBlocked(
        'invalid_pending_input',
        'Revisa el estado de los mensajes pendientes.',
      );
    const next = structuredClone(this.data);
    next.conversations.find((c) => c.id === id)!.pendingHold = held;
    this.save(next);
  }
  completePending(id: string, inputId: string): void {
    const next = structuredClone(this.data);
    const conversation = next.conversations.find((c) => c.id === id);
    if (!conversation)
      throw new ExecutionBlocked('conversation_unknown', 'La conversación no existe.');
    const input = conversation.pendingInputs?.find((p) => p.id === inputId);
    if (!input) {
      if (conversation.messages.some((m) => m.kind === 'request' && m.inputId === inputId)) return;
      throw new ExecutionBlocked('pending_unknown', 'El mensaje pendiente ya no existe.');
    }
    const request = conversation.messages.find(
      (m) =>
        m.kind === 'request' &&
        m.content === input.content &&
        JSON.stringify((m.attachments ?? []).map((a) => a.id)) ===
          JSON.stringify((input.attachments ?? []).map((a) => a.id)) &&
        (m.inputId === inputId || (m.taskId === input.taskId && m.inputId === undefined)),
    );
    if (!request)
      throw new ExecutionBlocked(
        'pending_not_delivered',
        'El mensaje aún no se ha guardado en la conversación.',
      );
    request.inputId = inputId;
    conversation.pendingInputs = conversation.pendingInputs!.filter((p) => p.id !== inputId);
    this.save(next);
  }
  recordUserInstruction(
    task: TeamTask,
    inputId: string,
    content: string,
    attachments?: OfficeArtifact[],
  ): void {
    validateInputId(inputId);
    text(content, 12000, 'el mensaje');
    if (!task.conversationId)
      throw new ExecutionBlocked('conversation_unknown', 'La conversación no existe.');
    validateAttachments(attachments, task.conversationId);
    if (
      this.data.conversations.some(
        (c) =>
          c.id !== task.conversationId &&
          (c.messages.some((m) => m.inputId === inputId) ||
            c.pendingInputs?.some((p) => p.id === inputId)),
      )
    )
      throw new ExecutionBlocked('pending_conflict', 'El mensaje pertenece a otra conversación.');
    const next = structuredClone(this.data);
    const conversation = next.conversations.find((c) => c.id === task.conversationId);
    if (!conversation)
      throw new ExecutionBlocked('conversation_unknown', 'La conversación no existe.');
    const existing = conversation.messages.find((m) => m.inputId === inputId);
    if (existing) {
      if (
        existing.content !== content ||
        existing.taskId !== task.id ||
        JSON.stringify(existing.attachments ?? []) !== JSON.stringify(attachments ?? [])
      )
        throw new ExecutionBlocked(
          'pending_conflict',
          'Este mensaje ya se ha guardado con otros datos.',
        );
      if (this.dirty) this.save(this.data);
      return;
    }
    conversation.messages.push({
      id: `${inputId}-instruction`,
      inputId,
      origin: 'user',
      taskId: task.id,
      kind: 'request',
      role: task.role,
      content,
      attachments: structuredClone(attachments),
      createdAt: Date.now(),
      status: task.status,
      reasonCode: task.reasonCode,
    });
    conversation.updatedAt = Date.now();
    this.save(next);
  }
  private pendingForUpdate(
    data: LibraryData,
    id: string,
    inputId: string,
    revision?: number,
  ): PendingConversationInput {
    const conversation = data.conversations.find((c) => c.id === id);
    if (!conversation)
      throw new ExecutionBlocked('conversation_unknown', 'La conversación no existe.');
    validateInputId(inputId);
    const input = conversation.pendingInputs?.find((p) => p.id === inputId);
    if (!input) throw new ExecutionBlocked('pending_unknown', 'El mensaje pendiente ya no existe.');
    if (revision !== undefined && (!Number.isSafeInteger(revision) || input.revision !== revision))
      throw new ExecutionBlocked(
        'pending_conflict',
        'El mensaje ha cambiado. Actualiza la conversación antes de editarlo.',
      );
    return input;
  }
  private touchPending(input: PendingConversationInput): void {
    input.updatedAt = Math.max(Date.now(), input.createdAt);
    input.revision++;
  }
  ensure(projectPath: string, title: string, id?: string): string {
    if (id) {
      if (this.project(this.conversation(id).projectId).path !== projectPath)
        throw new ExecutionBlocked(
          'conversation_project_mismatch',
          'La conversación pertenece a otro proyecto.',
        );
      return id;
    }
    const project = this.projectAt(projectPath) ?? this.register(projectPath);
    const selected = this.data.conversations.find(
      (c) => c.id === this.data.selectedId && c.projectId === project.id,
    );
    return selected?.id ?? this.create(project.id, title.slice(0, 160)).id;
  }
  record(task: TeamTask, chunk?: string): void {
    if (!task.conversationId) return;
    const current = this.data.conversations.find((c) => c.id === task.conversationId);
    if (!current) throw new ExecutionBlocked('conversation_unknown', 'La conversación no existe.');
    const existing = current.messages.find((m) => m.id === `${task.id}-response`);
    // Do not rewrite the archive on polling, or replace full output with the card's excerpt.
    if (
      existing &&
      chunk === undefined &&
      existing.status === task.status &&
      existing.reasonCode === task.reasonCode &&
      current.messages
        .filter((m) => m.taskId === task.id && m.kind === 'request')
        .every((m) => m.status === task.status && m.reasonCode === task.reasonCode) &&
      existing.role === task.role &&
      JSON.stringify(existing.autonomyBudget) === JSON.stringify(task.autonomyBudget) &&
      JSON.stringify(existing.artifacts ?? []) === JSON.stringify(task.artifacts ?? []) &&
      JSON.stringify(
        current.messages.find((m) => m.id === `${task.id}-request`)?.attachments ?? [],
      ) === JSON.stringify(task.attachments ?? []) &&
      existing.officeAssignment === (task.officeParentId ? task.title : undefined) &&
      (!task.office || existing.content === task.output)
    ) {
      if (this.dirty) this.save(this.data);
      return;
    }
    const next = structuredClone(this.data);
    const conversation = next.conversations.find((c) => c.id === task.conversationId)!;
    if (!conversation.messages.some((m) => m.id === `${task.id}-request`)) {
      conversation.messages.push({
        id: `${task.id}-request`,
        inputId: task.inputId,
        origin: task.officeParentId ? 'internal' : 'user',
        taskId: task.id,
        kind: 'request',
        role: task.role,
        content: task.prompt,
        createdAt: Date.now(),
        status: task.status,
        reasonCode: task.reasonCode,
      });
      if (conversation.title === 'Nueva conversación')
        conversation.title = task.title.slice(0, 160);
      if (!task.officeParentId && (!task.inputId || conversation.draft === task.prompt)) {
        conversation.draft = '';
        conversation.draftAttachments = [];
      }
    }
    let response = conversation.messages.find((m) => m.id === `${task.id}-response`);
    const request = conversation.messages.find((m) => m.id === `${task.id}-request`)!;
    for (const message of conversation.messages.filter(
      (m) => m.taskId === task.id && m.kind === 'request',
    )) {
      message.status = task.status;
      message.reasonCode = task.reasonCode;
    }
    request.role = task.role;
    request.origin = task.officeParentId ? 'internal' : 'user';
    request.attachments = task.attachments ? structuredClone(task.attachments) : undefined;
    request.officeAssignment = task.officeParentId ? task.title : undefined;
    if (!response) {
      response = {
        id: `${task.id}-response`,
        origin: task.officeParentId ? 'internal' : 'user',
        taskId: task.id,
        kind: 'response',
        role: task.role,
        content: chunk === undefined ? task.output : '',
        createdAt: Date.now(),
        status: task.status,
        reasonCode: task.reasonCode,
      };
      conversation.messages.push(response);
    }
    if (chunk !== undefined) response.content += chunk;
    else if (task.office) response.content = task.output;
    response.role = task.role;
    response.autonomyBudget = task.autonomyBudget
      ? structuredClone(task.autonomyBudget)
      : undefined;
    response.origin = task.officeParentId ? 'internal' : 'user';
    response.artifacts = task.artifacts ? structuredClone(task.artifacts) : undefined;
    response.officeAssignment = task.officeParentId ? task.title : undefined;
    response.status = task.status;
    response.reasonCode = task.reasonCode;
    conversation.updatedAt = Date.now();
    this.save(next);
  }

  contextFor(task: TeamTask) {
    const conversation = this.data.conversations.find((c) => c.id === task.conversationId);
    if (!conversation)
      throw new ExecutionBlocked('conversation_unknown', 'La conversación no existe.');
    const index = conversation.messages.findIndex((m) => m.id === `${task.id}-request`);
    return {
      instructions: this.project(conversation.projectId).instructions,
      recent: conversation.messages.slice(Math.max(0, index - 8), Math.max(0, index)).map((m) => ({
        kind: m.kind,
        content: m.content.slice(-1500),
        shortened: m.content.length > 1500,
      })),
    };
  }

  private catalog(project: SavedProject): {
    public: ProjectCheckCatalog;
    commands: Record<string, LocalCheckCommand>;
  } {
    const unavailable = (message: string) => ({
      public: { fingerprint: '', checks: [], available: false, message },
      commands: {},
    });
    try {
      if (!isAbsolute(this.npmCli) || !existsSync(this.npmCli))
        return unavailable('No se encuentra npm para ejecutar las comprobaciones locales.');
      const manifestPath = join(project.path, 'package.json');
      if (statSync(manifestPath).size > 1_000_000)
        return unavailable('El archivo de configuración del proyecto es demasiado grande.');
      const manifest = readFileSync(manifestPath, 'utf8');
      const scripts = JSON.parse(manifest).scripts ?? {};
      const fingerprint = hash(project.path + '\n' + resolve(this.npmCli) + '\n' + manifest);
      const approved =
        project.autonomy === true
          ? scriptIds
          : project.checksApproval?.fingerprint === fingerprint
            ? project.checksApproval.ids
            : [];
      const ids = scriptIds.filter((id) => typeof scripts[id] === 'string' && scripts[id].trim());
      return {
        public: {
          fingerprint,
          available: true,
          message: ids.length
            ? 'Aprobar permite ejecutar estas pruebas; no garantiza que cubran todos los requisitos del encargo.'
            : 'No se han encontrado pruebas compatibles. Puedes conversar; la aceptación seguirá necesitando revisión.',
          checks: ids.map((id) => ({
            id,
            description: [scripts[`pre${id}`], scripts[id], scripts[`post${id}`]]
              .filter(Boolean)
              .join('\n'),
            approved: approved.includes(id),
          })),
        },
        commands: Object.fromEntries(
          ids
            .filter((id) => approved.includes(id))
            .map((id) => [
              id,
              {
                executable: process.execPath,
                args: [this.npmCli, 'run', id],
                timeoutMs: 180000,
                acceptance: id === 'test',
              },
            ]),
        ),
      };
    } catch {
      return unavailable(
        'La carpeta no está disponible o no contiene package.json. El historial sigue accesible.',
      );
    }
  }
  approve(projectId: string, fingerprint: string, ids: string[]): void {
    const project = this.project(projectId);
    const catalog = this.catalog(project).public;
    if (
      !catalog.available ||
      !fingerprint ||
      catalog.fingerprint !== fingerprint ||
      !Array.isArray(ids) ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !catalog.checks.some((c) => c.id === id))
    )
      throw new ExecutionBlocked(
        'checks_changed',
        'Las pruebas han cambiado. Vuelve a revisarlas antes de aprobarlas.',
      );
    const next = structuredClone(this.data);
    next.projects.find((p) => p.id === projectId)!.checksApproval = {
      fingerprint,
      ids: [...ids],
      approvedAt: Date.now(),
    };
    this.save(next);
  }
  checksFor(projectPath: string): LocalChecks | undefined {
    const project = this.projectAt(projectPath);
    if (!project) return undefined;
    const catalog = this.catalog(project);
    const key = project.id + catalog.public.fingerprint + JSON.stringify(catalog.commands);
    let runner = this.runners.get(key);
    if (!runner) {
      runner = new LocalChecks(
        catalog.commands,
        join(this.directory, 'check-logs', project.id),
        project.path,
      );
      const run = runner.run.bind(runner);
      runner.run = async (ids, directory, signal) => {
        const current = this.catalog(this.project(project.id));
        // Approval of root scripts never approves a changed manifest in an isolated copy.
        if (
          readFileSync(join(directory, 'package.json'), 'utf8') !==
            readFileSync(join(project.path, 'package.json'), 'utf8') ||
          current.public.fingerprint !== catalog.public.fingerprint ||
          ids.some((id) => !Object.hasOwn(current.commands, id))
        )
          throw new ExecutionBlocked(
            'checks_changed',
            'La configuración de las pruebas ha cambiado. Revisa y aprueba de nuevo antes de ejecutarlas.',
          );
        return run(ids, directory, signal);
      };
      this.runners.set(key, runner);
    }
    return runner;
  }
  snapshot(): ConversationLibrarySnapshot {
    const project = this.data.projects.find((p) => p.id === this.data.selectedProjectId);
    return structuredClone({
      projects: this.data.projects,
      conversations: this.data.conversations
        .map(({ messages: _messages, draft: _draft, ...summary }) => summary)
        .sort((a, b) => b.updatedAt - a.updatedAt),
      selected: this.data.conversations.find((c) => c.id === this.data.selectedId) ?? null,
      selectedProjectId: this.data.selectedProjectId,
      checks: project ? this.catalog(project).public : null,
      warning: this.warning,
      writable: this.writable,
    });
  }
}
