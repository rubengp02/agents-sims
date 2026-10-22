import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

import {
  type TaskAssessment,
  type TaskContext,
  TEAM_ROLES,
  type TeamAvailability,
  type TeamChoice,
  type TeamRole,
  type TeamSettings,
  type TeamSnapshot,
  type TeamTask,
  type TeamWorkflow,
  type WorkflowDecomposition,
} from '../../../core/src/team.js';
import type { AdaptiveRuntime } from './adaptiveRuntime.js';
import type { CheckRunner } from './localChecks.js';
import { captureRevision, parseReviewFindings, type ReviewPacket } from './reviewPacket.js';
import { object } from './subscriptionPolicy.js';
import { assessTask, validateAssessment } from './taskAssessment.js';
import { prepareTaskContext, validateContext } from './taskContext.js';
import { parseTaskOutcome } from './taskOutcome.js';
import { chooseModel, DEFAULT_TEAM_SETTINGS, validateSettings } from './teamPolicy.js';
import { ExecutionBlocked, type OfficialExecutor, type RunRecord } from './types.js';
import { normalizeWorkflowPlan } from './workflowPlan.js';
import {
  chooseWorkflowSchedule,
  ownershipOverlaps,
  validateDecomposition,
} from './workflowPolicy.js';
import type { OwnedWorkspace, WorkspaceResult } from './workflowWorkspace.js';

type Executors = Record<'codex' | 'claude', OfficialExecutor>;
type TaskInput = {
  role: TeamRole;
  title: string;
  prompt: string;
  project: string;
  dependsOn?: string[];
  allowWrites?: boolean;
  parallelSafe?: boolean;
  context?: TaskContext;
  assessment?: TaskAssessment;
  continueTaskId?: string;
  proposedChoice?: TeamChoice;
  reviewMode?: 'none' | 'focused' | 'deep';
};
export interface TeamObserver {
  state(task: TeamTask, record: Readonly<RunRecord>): number | null;
  activity(task: TeamTask, activity: 'thinking' | 'reading' | 'working'): void;
}

const activeStates = new Set(['checking', 'running']);
const failureCode = (error: unknown) =>
  error instanceof ExecutionBlocked ? error.code : 'operation_failed';
const failureMessage = (error: unknown) =>
  error instanceof ExecutionBlocked ? error.message : 'No se pudo completar la operación.';

/**
 * Task/agent separation follows Claw-Empire's workflow architecture, with a small
 * local queue instead of its OAuth/API/meetings stack. Every run uses a guarded
 * OfficialExecutor. Prompts/results stay in memory; only settings are persisted.
 */
export class TeamCoordinator {
  private settings: TeamSettings = { ...DEFAULT_TEAM_SETTINGS };
  private readonly tasks: TeamTask[] = [];
  private providers: TeamAvailability[] = [];
  private readonly controllers = new Map<string, AbortController>();
  private draining = false;
  private running = false;
  private runsUsed = 0;
  private tokensUsed = 0;
  private timeUsedMs = 0;
  private elapsedUsedMs = 0;
  private activeClock = 0;
  private usageKnown = true;
  private readonly workflows: TeamWorkflow[] = [];
  private readonly workspaces = new Map<string, OwnedWorkspace>();
  private readonly workspaceResults = new Map<string, WorkspaceResult>();
  private operation: Promise<void> | undefined;
  private operationController: AbortController | undefined;
  private budgetReason: string | null = null;
  private deadline = 0;
  private maxObservedInput = 0;
  private starting = false;
  private planning = false;
  private readonly assigning = new Set<string>();
  private generation = 0;
  private readonly cancelled = new Set<string>();
  private readonly pendingRuns = new Set<Promise<void>>();
  private reservedRuns = 0;
  private reservedTokens = 0;
  private closed = false;
  private readonly pendingChecks = new Set<Promise<import('./types.js').SubscriptionEvidence>>();

  constructor(
    private readonly executors: Executors,
    private readonly settingsFile?: string,
    private readonly observer?: TeamObserver,
    private readonly checks?: CheckRunner,
    /** Optional local scheduling estimate; actual usage and maxTokens still govern. */
    private readonly startupTokenReserve?: number,
    private readonly checkpointFile?: string,
    private readonly adaptive?: AdaptiveRuntime,
  ) {
    if (
      startupTokenReserve !== undefined &&
      (!Number.isSafeInteger(startupTokenReserve) ||
        startupTokenReserve < 1 ||
        startupTokenReserve > 200_000)
    )
      throw new ExecutionBlocked(
        'invalid_reservation',
        'La reserva de inicio debe ser un entero positivo hasta 200.000.',
      );
    if (settingsFile && existsSync(settingsFile)) {
      // Invalid configuration never enables Claude or automatic execution.
      try {
        this.settings = validateSettings(JSON.parse(readFileSync(settingsFile, 'utf8')));
      } catch {
        this.budgetReason = 'settings_invalid';
      }
    }
    if (checkpointFile && existsSync(checkpointFile)) {
      try {
        const saved = JSON.parse(readFileSync(checkpointFile, 'utf8'));
        if (
          ![1, 2].includes(saved.version) ||
          !Array.isArray(saved.tasks) ||
          saved.tasks.length > 100 ||
          ![saved.runsUsed, saved.tokensUsed, saved.maxObservedInput].every(
            (n) => Number.isSafeInteger(n) && n >= 0,
          )
        )
          throw new Error();
        let interrupted = false;
        for (const raw of saved.tasks as TeamTask[]) {
          if (
            typeof raw.id !== 'string' ||
            !/^[\w-]{1,100}$/.test(raw.id) ||
            typeof raw.output !== 'string' ||
            raw.output.length > 20_000 ||
            this.tasks.some((t) => t.id === raw.id)
          )
            throw new Error();
          this.addTask({ ...raw, continueTaskId: undefined });
          const task = this.tasks.at(-1)!;
          task.id = raw.id;
          task.workerId = raw.workerId ?? `role-${raw.role}`;
          task.workflowId = raw.workflowId;
          task.workspaceId = raw.workspaceId;
          task.ownedFiles = raw.ownedFiles;
          task.output = raw.output;
          task.executionProject = raw.executionProject;
          task.executionSessionKey = raw.executionSessionKey;
          task.runId = raw.runId;
          const settled = ['completed', 'failed', 'cancelled'].includes(raw.status);
          if (settled && raw.choice) {
            if (
              !['codex', 'claude'].includes(raw.choice.provider) ||
              typeof raw.choice.model !== 'string' ||
              !raw.choice.model ||
              raw.choice.model.length > 160 ||
              typeof raw.choice.effort !== 'string' ||
              !raw.choice.effort ||
              raw.choice.effort.length > 40
            )
              throw new Error();
            task.choice = { ...raw.choice };
          }
          interrupted ||= ['running', 'checking'].includes(raw.status);
          task.status = settled ? raw.status : 'paused';
          task.reasonCode = settled ? raw.reasonCode : 'server_restarted';
          task.localChecks = raw.localChecks;
          task.checkedRevision = raw.checkedRevision;
        }
        this.runsUsed = saved.runsUsed;
        this.tokensUsed = saved.tokensUsed;
        if (
          saved.timeUsedMs !== undefined &&
          (!Number.isSafeInteger(saved.timeUsedMs) || saved.timeUsedMs < 0)
        )
          throw new Error();
        this.timeUsedMs = saved.timeUsedMs ?? 0;
        this.elapsedUsedMs = saved.elapsedMs ?? this.timeUsedMs;
        if (!Number.isSafeInteger(this.elapsedUsedMs) || this.elapsedUsedMs < 0) throw new Error();
        this.usageKnown = saved.usageKnown !== false && !interrupted;
        if (saved.version === 2 && Array.isArray(saved.workflows)) {
          for (const w of saved.workflows as TeamWorkflow[]) {
            if (
              !/^[\w-]{1,100}$/.test(w.id) ||
              !Array.isArray(w.taskIds) ||
              w.taskIds.some((id) => !this.tasks.some((t) => t.id === id))
            )
              throw new Error();
            this.workflows.push({
              ...w,
              budgetReview: undefined,
              // A checkpoint records past acceptance, not a current workspace
              // capability. The manager's handles are not restored, so even an
              // accepted candidate needs recovery before it can be trusted again.
              status: 'paused',
              reasonCode: 'workflow_recovery_required',
            });
          }
        }
        this.maxObservedInput = saved.maxObservedInput;
        this.budgetReason = interrupted
          ? 'usage_unknown_after_restart'
          : (saved.budgetReason ?? 'server_restarted');
      } catch {
        this.tasks.length = 0;
        this.workflows.length = 0;
        this.budgetReason = 'checkpoint_invalid';
      }
    }
  }

  private persist(): void {
    if (!this.checkpointFile || this.budgetReason === 'checkpoint_invalid') return;
    mkdirSync(dirname(this.checkpointFile), { recursive: true, mode: 0o700 });
    const value = {
      version: 2,
      tasks: this.tasks,
      runsUsed: this.runsUsed,
      tokensUsed: this.tokensUsed,
      timeUsedMs: this.timeUsedMs,
      maxObservedInput: this.maxObservedInput,
      budgetReason: this.budgetReason,
      elapsedMs: this.elapsed(),
      usageKnown: this.usageKnown,
      workflows: this.workflows,
    };
    writeFileSync(this.checkpointFile + '.tmp', JSON.stringify(value), { mode: 0o600 });
    renameSync(this.checkpointFile + '.tmp', this.checkpointFile);
  }

  snapshot(): TeamSnapshot {
    this.persist();
    return structuredClone({
      capabilities: {
        engine: this.executors.codex.engine ?? 'codex-cli',
        isolatedWriters: !!this.executors.codex.workspaceManager,
        budgetReview: !!this.adaptive,
        ...(this.checks?.describe ? { checks: this.checks.describe() } : {}),
      },
      settings: this.settings,
      tasks: this.tasks,
      providers: this.providers,
      running: this.running,
      runsUsed: this.runsUsed,
      tokensUsed: this.tokensUsed,
      timeUsedMs: this.timeUsedMs,
      elapsedMs: this.elapsed(),
      usageKnown: this.usageKnown,
      workflows: this.workflows,
      budgetReason: this.budgetReason,
    });
  }

  private elapsed() {
    return this.elapsedUsedMs + (this.activeClock ? Math.max(0, Date.now() - this.activeClock) : 0);
  }
  private stopClock() {
    this.elapsedUsedMs = this.elapsed();
    this.activeClock = 0;
  }

  private taskPacket(task: TeamTask, estimate = false) {
    const packet = prepareTaskContext(
      task.role,
      task.prompt,
      task.context,
      task.dependsOn.map((id) => {
        const dep = this.task(id);
        return {
          title: dep.title,
          output: estimate && dep.status !== 'completed' ? 'x'.repeat(4000) : dep.output,
        };
      }),
    );
    if (task.ownedFiles) {
      packet.prompt +=
        '\nPropiedad de escritura exclusiva: ' +
        JSON.stringify(task.ownedFiles) +
        '. Los demás archivos, incluidos contratos compartidos, son de solo lectura. No hagas commits ni cambies ramas. La integración y aceptación conjunta las ejecuta la aplicación.';
      packet.fingerprint = createHash('sha256').update(packet.prompt).digest('hex');
      packet.characters = packet.prompt.length;
    }
    return packet;
  }

  private diagnose(provider: 'codex' | 'claude') {
    if (this.closed)
      return Promise.reject(new ExecutionBlocked('server_stopped', 'La oficina se está cerrando.'));
    const pending = this.executors[provider].diagnose();
    this.pendingChecks.add(pending);
    void pending.then(
      () => this.pendingChecks.delete(pending),
      () => this.pendingChecks.delete(pending),
    );
    return pending;
  }

  configure(settings: TeamSettings): void {
    if (this.controllers.size || this.starting || this.planning || this.assigning.size)
      throw new ExecutionBlocked('team_busy', 'Pausa las tareas antes de cambiar los límites.');
    const next = validateSettings(settings);
    if (this.settingsFile) {
      mkdirSync(dirname(this.settingsFile), { recursive: true, mode: 0o700 });
      writeFileSync(this.settingsFile + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 });
      renameSync(this.settingsFile + '.tmp', this.settingsFile);
    }
    this.settings = next;
    if (this.budgetReason === 'settings_invalid') this.budgetReason = null;
    for (const task of this.tasks)
      if (task.status === 'planned' || task.status === 'queued') {
        task.choice = null;
        task.approved = false;
        task.status = 'planned';
      }
  }

  async refresh(): Promise<TeamSnapshot> {
    this.providers = await Promise.all(
      (['codex', 'claude'] as const).map(async (provider) => {
        const enabled = provider === 'codex' || this.settings.claudeEnabled;
        if (!enabled)
          return {
            provider,
            enabled: false,
            available: false,
            reasonCode: 'claude_disabled',
            message: 'Claude está desactivado.',
            models: [],
          };
        try {
          const evidence = await this.diagnose(provider);
          return {
            provider,
            enabled: true,
            available: true,
            reasonCode: null,
            message:
              'Suscripción verificada en esta comprobación. Se revisará de nuevo antes de ejecutar.',
            models: evidence.models,
          };
        } catch (error) {
          return {
            provider,
            enabled: true,
            available: false,
            reasonCode: failureCode(error),
            message: failureMessage(error),
            models: [],
          };
        }
      }),
    );
    return this.snapshot();
  }

  addTask(input: TaskInput): TeamTask {
    if (this.tasks.length >= 100)
      throw new ExecutionBlocked('queue_full', 'La cola admite hasta 100 tareas por sesión.');
    if (
      !input ||
      !Object.hasOwn(TEAM_ROLES, input.role) ||
      typeof input.title !== 'string' ||
      !input.title.trim() ||
      input.title.length > 160 ||
      typeof input.prompt !== 'string' ||
      !input.prompt.trim() ||
      input.prompt.length > 20_000 ||
      typeof input.project !== 'string' ||
      (input.allowWrites !== undefined && typeof input.allowWrites !== 'boolean') ||
      (input.parallelSafe !== undefined && typeof input.parallelSafe !== 'boolean')
    )
      throw new ExecutionBlocked(
        'invalid_task',
        'Revisa el personaje, título, proyecto y tarea (hasta 20.000 caracteres).',
      );
    let project: string;
    try {
      project = realpathSync(input.project);
      if (!statSync(project).isDirectory()) throw new Error();
    } catch {
      throw new ExecutionBlocked('invalid_project', 'La carpeta de proyecto no existe.');
    }
    const deps = input.dependsOn ?? [];
    if (
      !Array.isArray(deps) ||
      deps.length > 8 ||
      deps.some((id) => !this.tasks.some((task) => task.id === id && task.project === project))
    )
      throw new ExecutionBlocked(
        'invalid_dependencies',
        'Las dependencias deben ser tareas anteriores del mismo proyecto.',
      );
    const previous = input.continueTaskId ? this.task(input.continueTaskId) : null;
    if (previous && input.role === 'tester')
      throw new ExecutionBlocked(
        'review_session_independent',
        'La revisión necesita una sesión nueva de solo lectura.',
      );
    if (input.role !== 'developer' && input.allowWrites)
      throw new ExecutionBlocked('role_write_forbidden', 'Solo el Programador puede escribir.');
    if (input.reviewMode !== undefined && !['none', 'focused', 'deep'].includes(input.reviewMode))
      throw new ExecutionBlocked('invalid_review', 'Modo de revisión incorrecto.');
    if (
      input.assessment?.acceptanceCoverage === 'complete' &&
      (!input.context || !this.checks?.covers?.(input.context.checks, input.context.acceptance))
    )
      throw new ExecutionBlocked(
        'coverage_unverified',
        'La cobertura completa requiere evidencia del registro local.',
      );
    if (
      previous &&
      (previous.status !== 'completed' ||
        previous.project !== project ||
        previous.role !== input.role ||
        previous.allowWrites !== (input.allowWrites === true))
    )
      throw new ExecutionBlocked(
        'continuation_scope',
        'Solo se puede continuar explícitamente una tarea terminada del mismo papel y alcance.',
      );
    const task: TeamTask = {
      id: randomUUID(),
      workerId: previous?.workerId ?? `role-${input.role}`,
      role: input.role,
      title: input.title.trim(),
      prompt: input.prompt,
      context: input.context === undefined ? undefined : validateContext(input.context),
      assessment: input.assessment === undefined ? undefined : validateAssessment(input.assessment),
      proposedChoice: input.proposedChoice,
      reviewMode: input.reviewMode ?? (input.role === 'tester' ? 'focused' : undefined),
      project,
      executionSessionKey: previous?.executionSessionKey ?? previous?.id,
      executionProject: previous?.executionProject,
      dependsOn: [...new Set(deps)],
      allowWrites: input.allowWrites === true,
      parallelSafe: input.parallelSafe === true && input.allowWrites !== true,
      scheduleReason: deps.length
        ? `Depende de: ${deps.map((id) => this.task(id).title).join(', ')}.`
        : input.parallelSafe === true && input.allowWrites !== true
          ? 'Independiente y de solo lectura; pendiente de una plaza libre.'
          : 'Por orden: escritura o independencia no declarada.',
      status: 'planned',
      choice: null,
      override: null,
      approved: false,
      difficulty: 'normal',
      explanation: 'Pendiente de asignación.',
      reasonCode: null,
      output: '',
      runId: null,
      confirmedModel: null,
      agentId: null,
    };
    this.tasks.push(task);
    return structuredClone(task);
  }

  private task(id: string): TeamTask {
    const task = this.tasks.find((item) => item.id === id);
    if (!task) throw new ExecutionBlocked('task_unknown', 'La tarea no existe.');
    return task;
  }

  /** Local routing is opt-in with explicit scope evidence. No planning inference. */
  addScopedWorkflow(
    project: string,
    context: TaskContext,
    assessment: TaskAssessment,
    allowWrites = false,
    decomposition?: WorkflowDecomposition,
  ): TeamTask[] {
    const packet = validateContext(context);
    let evidence = validateAssessment(assessment);
    if (decomposition)
      return this.addDecomposedWorkflow(project, packet, evidence, allowWrites, decomposition);
    if (
      evidence.acceptanceCoverage === 'complete' &&
      !this.checks?.covers?.(packet.checks, packet.acceptance)
    )
      throw new ExecutionBlocked(
        'coverage_unverified',
        'No se ha acreditado la aceptación completa con comprobaciones locales.',
      );
    if (this.adaptive)
      evidence = {
        ...evidence,
        acceptanceCoverage: this.checks?.covers?.(packet.checks, packet.acceptance)
          ? 'complete'
          : 'partial',
      };
    const routing = assessTask(packet.objective, evidence);
    if (this.adaptive) evidence = { ...evidence, risk: routing.effectiveRisk };
    if (
      this.adaptive &&
      evidence.scope !== 'explanation' &&
      !routing.roles.includes('tester') &&
      !this.checks?.covers?.(packet.checks, packet.acceptance)
    ) {
      routing.roles.push('tester');
      routing.reason += ' Cobertura no acreditada: conservar revisión independiente.';
    }
    if (typeof allowWrites !== 'boolean')
      throw new ExecutionBlocked('invalid_task', 'Permiso incorrecto.');
    if (evidence.scope === 'explanation' && allowWrites)
      throw new ExecutionBlocked(
        'invalid_assessment',
        'Una explicación directa debe ser de solo lectura.',
      );
    if (this.tasks.length + routing.roles.length > 100)
      throw new ExecutionBlocked('queue_full', 'La cola está llena.');
    // Available tests alone are not enough: a local executable registry must exist.
    if (
      packet.checks.some((id) => !this.checks?.has(id)) ||
      (!routing.roles.includes('tester') &&
        evidence.scope !== 'explanation' &&
        !this.checks?.hasAcceptance(packet.checks))
    )
      throw new ExecutionBlocked(
        'check_unconfigured',
        'Configura comprobaciones locales antes de reducir la revisión.',
      );
    const tasks: TeamTask[] = [];
    for (const role of routing.roles) {
      tasks.push(
        this.addTask({
          project,
          role,
          title: `${TEAM_ROLES[role]}: encargo acotado`,
          prompt:
            role === 'architect'
              ? 'Analiza riesgos y contrato; entrega decisiones concretas para la implementación.'
              : role === 'tester'
                ? 'Verifica de forma independiente los criterios de aceptación y los cambios realizados.'
                : role === 'designer'
                  ? 'Analiza únicamente las decisiones visuales solicitadas para revisión humana.'
                  : packet.objective,
          context: packet,
          assessment: evidence,
          reviewMode:
            role === 'tester' ? (routing.reviewMode === 'deep' ? 'deep' : 'focused') : undefined,
          dependsOn: tasks.map((task) => task.id),
          allowWrites: allowWrites && role === 'developer',
        }),
      );
    }
    return tasks;
  }

  private addDecomposedWorkflow(
    project: string,
    context: TaskContext,
    assessment: TaskAssessment,
    allowWrites: boolean,
    raw: WorkflowDecomposition,
  ): TeamTask[] {
    const decomposition = validateDecomposition(raw, context);
    if (!allowWrites)
      throw new ExecutionBlocked(
        'invalid_decomposition',
        'El reparto de implementación requiere permiso de escritura.',
      );
    if (!this.settings.experimentalParallelWriters) {
      const packet = validateContext({
        ...context,
        decisions: [
          ...new Set([
            ...context.decisions,
            ...decomposition.parts.flatMap((p) => p.context.decisions),
          ]),
        ],
      });
      const suffix =
        '\nSubtareas que debe cubrir la implementación única:\n' +
        JSON.stringify(decomposition.parts.map((p) => ({ objective: p.objective })));
      if (context.objective.length + suffix.length > 20000)
        throw new ExecutionBlocked(
          'invalid_context',
          'El reparto completo no cabe en un encargo; conserva las instrucciones y acota su contexto.',
        );
      const levels = (values: Array<'low' | 'high' | 'unknown'>) =>
        values.includes('high') ? 'high' : values.includes('unknown') ? 'unknown' : 'low';
      const tasks = this.addScopedWorkflow(
        project,
        packet,
        {
          ...assessment,
          risk: levels([assessment.risk, ...decomposition.parts.map((p) => p.assessment.risk)]),
          uncertainty: levels([
            assessment.uncertainty,
            ...decomposition.parts.map((p) => p.assessment.uncertainty),
          ]),
        },
        allowWrites,
      );
      for (const task of tasks) {
        const stored = this.task(task.id);
        stored.prompt += suffix;
        stored.scheduleReason =
          'Un solo Programador por defecto; dos escritores requieren activación experimental explícita.';
      }
      this.persist();
      return tasks.map((t) => structuredClone(this.task(t.id)));
    }
    const overlap = decomposition.parts[0].ownedFiles.some((f) =>
      decomposition.parts[1].ownedFiles.some((other) => ownershipOverlaps(f, other)),
    );
    const coupled = decomposition.parts.some(
      (part, index) =>
        part.dependsOn?.length ||
        part.context.files.some((f) => decomposition.parts[1 - index].ownedFiles.includes(f)),
    );
    if (!this.executors.codex.workspaceManager || overlap || coupled) {
      const tasks = this.addScopedWorkflow(project, context, assessment, allowWrites);
      for (const task of tasks)
        this.task(task.id).scheduleReason =
          overlap || coupled
            ? 'Archivos compartidos o dependencias: un Programador integra el trabajo por orden.'
            : 'Codex CLI conserva la ejecución sin escritores paralelos; AO sigue opcional.';
      this.persist();
      return tasks.map((t) => structuredClone(this.task(t.id)));
    }
    if (
      !this.checks?.hasAcceptance(context.checks) ||
      context.checks.some((id) => !this.checks?.has(id)) ||
      decomposition.parts.some(
        (p) => !p.context.checks.length || p.context.checks.some((id) => !this.checks?.has(id)),
      )
    )
      throw new ExecutionBlocked(
        'check_unconfigured',
        'Configura aceptación conjunta y comprobaciones por parte antes de repartir.',
      );
    for (const part of decomposition.parts)
      part.context = validateContext({
        ...part.context,
        decisions: [...new Set([...context.decisions, ...part.context.decisions])],
      });
    const routing = assessTask(context.objective, assessment);
    const review =
      (routing.roles.includes('tester') &&
        !this.checks.covers?.(context.checks, context.acceptance)) ||
      routing.effectiveRisk !== 'low' ||
      assessment.uncertainty !== 'low';
    if (this.tasks.length + 2 + Number(review) + Number(routing.roles.includes('architect')) > 100)
      throw new ExecutionBlocked('queue_full', 'La cola no admite el flujo completo.');
    const id = randomUUID();
    const workflow: TeamWorkflow = {
      id,
      project: realpathSync(project),
      context,
      assessment,
      sharedFiles: decomposition.sharedFiles,
      taskIds: [],
      mode: 'serial',
      reason: 'Pendiente de asignaciones y estimación del coste de integración.',
      status: 'planned',
    };
    const tasks: TeamTask[] = [];
    if (routing.roles.includes('architect'))
      tasks.push(
        this.addTask({
          role: 'architect',
          project,
          title: 'Contrato del flujo',
          prompt: 'Analiza el contrato compartido y sus riesgos sin editar archivos.',
          context,
          assessment,
        }),
      );
    const prerequisites = tasks.map((t) => t.id);
    for (const part of decomposition.parts) {
      const task = this.addTask({
        role: 'developer',
        project,
        title: part.title,
        prompt: part.objective,
        context: part.context,
        assessment: {
          ...part.assessment,
          risk: routing.effectiveRisk === 'high' ? 'high' : part.assessment.risk,
        },
        allowWrites: true,
        dependsOn: prerequisites,
      });
      const stored = this.task(task.id);
      stored.workerId = randomUUID();
      stored.workflowId = id;
      stored.ownedFiles = part.ownedFiles;
      tasks.push(stored);
      workflow.taskIds.push(task.id);
    }
    if (review) {
      const task = this.addTask({
        role: 'tester',
        project,
        title: 'Revisión del conjunto integrado',
        prompt: 'Revisa el resultado integrado, su contrato y sus pruebas con independencia.',
        context,
        assessment: { ...assessment, risk: routing.effectiveRisk },
        reviewMode: routing.reviewMode === 'deep' ? 'deep' : 'focused',
        dependsOn: [...workflow.taskIds],
      });
      this.task(task.id).workflowId = id;
      tasks.push(this.task(task.id));
    }
    this.workflows.push(workflow);
    this.persist();
    return structuredClone(tasks);
  }

  private workflowKey(workflow: TeamWorkflow): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          base: captureRevision(workflow.project).digest,
          context: workflow.context,
          sharedFiles: workflow.sharedFiles,
          tasks: workflow.taskIds.map((id) => {
            const t = this.task(id);
            return { id, choice: t.choice, context: t.context, ownedFiles: t.ownedFiles };
          }),
        }),
      )
      .digest('hex');
  }
  private operationKey(workflow: TeamWorkflow): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          project: workflow.project,
          context: workflow.context,
          assessment: workflow.assessment,
          sharedFiles: workflow.sharedFiles,
          tasks: workflow.taskIds.map((id) => {
            const task = this.task(id);
            return {
              choice: task.choice,
              context: task.context,
              ownedFiles: task.ownedFiles,
            };
          }),
        }),
      )
      .digest('hex');
  }
  private resolveWorkflowBudget(w: TeamWorkflow): void {
    if (w.budgetReview) return;
    const key = this.operationKey(w);
    const samples = this.workflows.filter(
      (other) => other.id !== w.id && this.operationKey(other) === key,
    );
    // Failed/interrupted operations are retained and prevent optimistic reuse.
    if (
      samples.length < 5 ||
      samples.some((s) => s.status !== 'accepted' || !s.preparationMs || !s.integrationMs)
    )
      return;
    const workers = w.taskIds.map((id) => this.task(id).estimate?.durationMs);
    if (workers.some((n) => !n || !Number.isFinite(n))) return;
    w.budgetReview = {
      profileKey: this.workflowKey(w),
      preparationMs: Math.ceil(Math.max(...samples.map((s) => s.preparationMs!)) * 1.5),
      integrationMs: Math.ceil(Math.max(...samples.map((s) => s.integrationMs!)) * 1.5),
      // Conservative comparator: the same two workers in sequence, without overhead.
      sequentialMs: workers.reduce<number>((sum, n) => sum + n!, 0),
    };
  }
  reviewWorkflowBudget(
    id: string,
    preparationMs: number,
    integrationMs: number,
    sequentialMs: number,
  ): void {
    const w = this.workflows.find((w) => w.id === id);
    if (
      !w ||
      w.status !== 'planned' ||
      this.running ||
      this.starting ||
      this.planning ||
      this.controllers.size ||
      w.taskIds.some((id) => !this.task(id).choice)
    )
      throw new ExecutionBlocked(
        'budget_review_unavailable',
        'Asigna y detén el flujo antes de revisar sus cotas locales.',
      );
    if (
      ![preparationMs, integrationMs, sequentialMs].every(
        (n) => Number.isSafeInteger(n) && n > 0 && n <= this.settings.maxMinutes * 60000,
      )
    )
      throw new ExecutionBlocked(
        'invalid_estimate',
        'Las cotas deben caber en el plazo existente.',
      );
    w.budgetReview = {
      profileKey: this.workflowKey(w),
      preparationMs,
      integrationMs,
      sequentialMs,
    };
    this.persist();
  }

  private async prepareWorkflows(): Promise<void> {
    const manager = this.executors.codex.workspaceManager;
    for (const w of this.workflows.filter((w) => w.status === 'planned')) {
      if (!this.settings.experimentalParallelWriters)
        throw new ExecutionBlocked(
          'experimental_parallel_writers_disabled',
          'El flujo de dos escritores está desactivado. Conserva el plan o prepara un encargo con un Programador.',
        );
      if (this.tasks.filter((t) => t.workflowId === w.id).some((t) => t.status !== 'queued'))
        throw new ExecutionBlocked(
          'workflow_assignment_required',
          'Asigna y aprueba todos los pasos obligatorios antes de iniciar el flujo.',
        );
      if (!manager || !this.adaptive)
        throw new ExecutionBlocked(
          'isolated_engine_required',
          'El flujo requiere AO y el controlador adaptativo.',
        );
      if (w.taskIds.some((id) => this.task(id).choice?.provider !== 'codex'))
        throw new ExecutionBlocked(
          'isolated_engine_required',
          'Los trabajadores aislados requieren Codex en AO.',
        );
      const review = w.budgetReview;
      if (!review || review.profileKey !== this.workflowKey(w))
        throw new ExecutionBlocked(
          'workflow_budget_review_required',
          'Falta una cota de preparación e integración acreditada para este plan.',
        );
      const tasks = w.taskIds.map((id) => this.task(id));
      Object.assign(
        w,
        chooseWorkflowSchedule({
          isolated: true,
          maxParallel: this.settings.maxParallel,
          overlap: false,
          risky: w.assessment.risk !== 'low' || w.assessment.uncertainty !== 'low',
          workersMs: tasks.map((t) => t.estimate?.durationMs ?? 0),
          preparationMs: review.preparationMs,
          integrationMs: review.integrationMs,
          sequentialMs: review.sequentialMs,
        }),
      );
      if (
        Date.now() +
          review.preparationMs +
          review.integrationMs +
          (w.mode === 'parallel'
            ? Math.max(...tasks.map((t) => t.estimate!.durationMs!))
            : tasks.reduce((n, t) => n + t.estimate!.durationMs!, 0)) >
        this.deadline
      )
        throw new ExecutionBlocked(
          'time_budget',
          'El flujo con integración no cabe en el tiempo restante.',
        );
      w.status = 'preparing';
      this.persist();
      const start = Date.now();
      const generation = this.generation;
      this.operationController = new AbortController();
      const timer = setTimeout(
        () => this.operationController?.abort(),
        Math.max(1, Math.min(review.preparationMs, this.deadline - Date.now())),
      );
      try {
        for (const task of tasks) {
          const handle = await manager.prepare(
            w.project,
            w.id,
            task.workerId!,
            w.baseSHA,
            this.operationController.signal,
          );
          w.baseSHA ??= handle.baseSHA;
          task.workspaceId = handle.id;
          task.executionProject = handle.path;
          this.workspaces.set(task.id, handle);
          this.checks?.authorizeWorkspace?.(handle);
          this.persist();
          if (generation !== this.generation)
            throw new ExecutionBlocked(
              'preparation_cancelled',
              'La preparación se detuvo; se conservan sus copias.',
            );
          if (Date.now() - start > review.preparationMs || Date.now() >= this.deadline)
            throw new ExecutionBlocked(
              'preparation_time_budget',
              'La preparación agotó su reserva; no se inicia ningún modelo.',
            );
        }
        w.status = 'working';
      } finally {
        clearTimeout(timer);
        this.operationController = undefined;
        w.preparationMs = Date.now() - start;
        this.timeUsedMs += w.preparationMs;
        this.persist();
      }
    }
  }

  private async integrateWorkflows(): Promise<void> {
    for (const w of this.workflows.filter((w) => w.status === 'working')) {
      const tasks = w.taskIds.map((id) => this.task(id));
      if (
        !tasks.every((t) => t.status === 'completed') ||
        tasks.some((t) => this.controllers.has(t.id))
      )
        continue;
      if (!w.candidateHash) {
        w.status = 'integrating';
        this.operationController = new AbortController();
        this.persist();
        const start = Date.now();
        const timeout = setTimeout(
          () => this.operationController?.abort(),
          Math.max(1, Math.min(w.budgetReview!.integrationMs, this.deadline - Date.now())),
        );
        try {
          await this.executors.codex.workspaceManager!.integrate(
            w,
            tasks.map((t) => {
              const result = this.workspaceResults.get(t.id);
              if (!result)
                throw new ExecutionBlocked(
                  'workspace_result_missing',
                  'Falta un resultado acreditado.',
                );
              return result;
            }),
            this.checks!,
            this.operationController.signal,
          );
          if (
            !this.running ||
            this.operationController.signal.aborted ||
            Date.now() - start > w.budgetReview!.integrationMs ||
            Date.now() >= this.deadline
          )
            throw new ExecutionBlocked(
              'integration_time_budget',
              'Integración pausada al alcanzar su reserva o detener el flujo.',
            );
          w.status = 'working';
        } catch (error) {
          w.status = 'paused';
          w.reasonCode = failureCode(error);
          this.pause(w.reasonCode);
        } finally {
          clearTimeout(timeout);
          w.integrationMs = Date.now() - start;
          this.timeUsedMs += w.integrationMs;
          this.operationController = undefined;
          this.persist();
        }
      }
      const reviewers = this.tasks.filter((t) => t.workflowId === w.id && t.role === 'tester');
      if (
        this.running &&
        w.status !== 'paused' &&
        w.candidateHash &&
        reviewers.every((t) => t.status === 'completed')
      ) {
        this.executors.codex.workspaceManager!.verifyIntegrated(w);
        w.status = 'accepted';
      }
    }
  }

  override(id: string, choice: TeamChoice | null): void {
    const task = this.task(id);
    if (
      this.starting ||
      this.assigning.has(id) ||
      activeStates.has(task.status) ||
      task.status === 'completed' ||
      task.status === 'cancelled'
    )
      throw new ExecutionBlocked(
        'task_locked',
        'Pausa una tarea activa antes de cambiar su asignación.',
      );
    if (
      choice &&
      (!['codex', 'claude'].includes(choice.provider) ||
        typeof choice.model !== 'string' ||
        choice.model.length > 100 ||
        typeof choice.effort !== 'string' ||
        choice.effort.length > 20)
    )
      throw new ExecutionBlocked('invalid_choice', 'Elección de modelo incorrecta.');
    task.override = choice
      ? { provider: choice.provider, model: choice.model, effort: choice.effort }
      : null;
    task.choice = null;
    task.approved = false;
    task.status = 'planned';
    task.reasonCode = null;
  }

  async assign(id: string, assessmentPrompt?: string): Promise<TeamTask> {
    const task = this.task(id);
    if (
      this.assigning.has(id) ||
      !['planned', 'blocked', 'paused', 'queued'].includes(task.status) ||
      this.controllers.has(id)
    )
      throw new ExecutionBlocked('task_locked', 'La tarea está activa o terminada.');
    this.assigning.add(id);
    const provider = task.override?.provider ?? 'codex';
    try {
      if (provider === 'claude' && !this.settings.claudeEnabled)
        throw new ExecutionBlocked('claude_disabled', 'Claude está desactivado.');
      if (this.settings.mode === 'manual' && !task.override)
        throw new ExecutionBlocked(
          'manual_choice_required',
          'Selecciona proveedor, modelo y razonamiento.',
        );
      const evidence = await this.diagnose(provider);
      if (this.cancelled.has(id)) return structuredClone(task);
      Object.assign(
        task,
        chooseModel({ ...task, prompt: assessmentPrompt ?? task.prompt }, evidence),
      );
      if (
        this.adaptive &&
        !task.override &&
        task.role === 'developer' &&
        task.assessment?.scope !== 'explanation' &&
        task.choice?.model === 'gpt-6-luna' &&
        !this.adaptive.allowsLightCode(task, this.executors[provider].engine ?? 'codex-cli')
      )
        throw new ExecutionBlocked(
          'model_evidence_required',
          'Luna para código sigue como candidato: requiere evaluación o elección humana explícita.',
        );
      task.status = 'planned';
      task.reasonCode = null;
    } catch (error) {
      task.choice = null;
      task.status = /^quota_|provider_limit/.test(failureCode(error)) ? 'paused' : 'blocked';
      task.reasonCode = failureCode(error);
      task.explanation = failureMessage(error);
    } finally {
      this.assigning.delete(id);
    }
    return structuredClone(task);
  }

  approve(id: string): void {
    const task = this.task(id);
    if (!task.choice || task.status !== 'planned')
      throw new ExecutionBlocked('assignment_required', 'Primero comprueba la asignación.');
    task.approved = true;
  }

  /** Human-only local control; this value is never accepted from a generated plan. */
  reviewBudget(id: string, tokens: number, durationMs: number, maxContextCharacters: number): void {
    const task = this.task(id);
    if (
      !this.adaptive ||
      !task.choice ||
      this.running ||
      this.controllers.size ||
      this.planning ||
      this.starting ||
      this.assigning.size
    )
      throw new ExecutionBlocked(
        'budget_review_unavailable',
        'Pausa y asigna la tarea antes de revisar su estimación.',
      );
    if (
      ![tokens, durationMs, maxContextCharacters].every((v) => Number.isSafeInteger(v) && v > 0) ||
      tokens > this.settings.maxTokens ||
      durationMs > this.settings.maxMinutes * 60000 ||
      maxContextCharacters > 90000
    )
      throw new ExecutionBlocked(
        'invalid_estimate',
        'La cota revisada debe caber en los límites existentes.',
      );
    task.budgetReview = {
      choiceKey: JSON.stringify(
        this.adaptive.key(task, this.executors[task.choice.provider].engine ?? 'codex-cli'),
      ),
      tokens,
      durationMs,
      maxContextCharacters,
    };
    this.persist();
  }

  private assertAdaptivePlan(current?: TeamTask): void {
    if (!this.adaptive) return;
    const remaining = this.tasks.filter(
      (t) => t === current || ['queued', 'checking', 'running'].includes(t.status),
    );
    let tokens = 0;
    let durationMs = 0;
    for (const task of remaining) {
      if (!task.choice)
        throw new ExecutionBlocked('assignment_required', 'Falta una asignación del plan.');
      const packet = this.taskPacket(task, true);
      const estimate = this.adaptive.estimate(
        task,
        this.executors[task.choice.provider].engine ?? 'codex-cli',
        packet.characters,
      );
      task.estimate = estimate;
      if (estimate.tokens === null || estimate.durationMs === null || estimate.confidence === 'low')
        throw new ExecutionBlocked('budget_review_required', estimate.reason);
      tokens += estimate.tokens;
      durationMs += estimate.durationMs;
    }
    for (const w of this.workflows.filter(
      (w) => ['planned', 'preparing', 'working'].includes(w.status) && !w.candidateHash,
    )) {
      this.resolveWorkflowBudget(w);
      if (!w.budgetReview || w.budgetReview.profileKey !== this.workflowKey(w))
        throw new ExecutionBlocked(
          'workflow_budget_review_required',
          'Revisa el coste local de preparación e integración; no se inicia IA.',
        );
      durationMs +=
        w.budgetReview.integrationMs + (w.status === 'planned' ? w.budgetReview.preparationMs : 0);
      if (w.mode === 'parallel') {
        const writers = remaining.filter((t) => w.taskIds.includes(t.id));
        durationMs -=
          writers.reduce((n, t) => n + t.estimate!.durationMs!, 0) -
          Math.max(0, ...writers.map((t) => t.estimate!.durationMs!));
      }
    }
    if (this.tokensUsed + tokens > this.settings.maxTokens)
      throw new ExecutionBlocked(
        'token_budget',
        'El plan pendiente completo no cabe en el presupuesto estimado.',
      );
    if (
      this.runsUsed + remaining.filter((t) => !this.controllers.has(t.id)).length >
      this.settings.maxRuns
    )
      throw new ExecutionBlocked(
        'run_budget',
        'El plan completo no cabe en el límite de llamadas.',
      );
    if (this.deadline && Date.now() + durationMs > this.deadline)
      throw new ExecutionBlocked('time_budget', 'El plan pendiente no cabe en el plazo estimado.');
  }

  private budget(includeReservations = true, ownTokenReserve = 0): void {
    const inputEstimate = this.adaptive ? 0 : (this.startupTokenReserve ?? this.maxObservedInput);
    if (this.closed) throw new ExecutionBlocked('server_stopped', 'La oficina se está cerrando.');
    if (!this.usageKnown)
      throw new ExecutionBlocked(
        'usage_unknown',
        'El consumo total es desconocido; requiere revisión y no se reinicia.',
      );
    if (this.runsUsed + (includeReservations ? this.reservedRuns : 0) >= this.settings.maxRuns)
      throw new ExecutionBlocked('run_budget', 'Se alcanzó el límite de llamadas.');
    if (
      this.tokensUsed >= this.settings.maxTokens ||
      (inputEstimate > 0 &&
        this.tokensUsed + this.reservedTokens - ownTokenReserve + inputEstimate >
          this.settings.maxTokens)
    )
      throw new ExecutionBlocked(
        'token_budget',
        'El presupuesto de tokens no permite otra llamada según el consumo observado.',
      );
    if (
      (this.adaptive && this.elapsed() >= this.settings.maxMinutes * 60000) ||
      (this.deadline && Date.now() >= this.deadline)
    )
      throw new ExecutionBlocked('time_budget', 'Se alcanzó el tiempo máximo del equipo.');
    if (this.budgetReason)
      throw new ExecutionBlocked(
        this.budgetReason,
        'El equipo está en pausa. Revisa el motivo antes de continuar.',
      );
  }

  private ready(task: TeamTask, active: TeamTask[]): boolean {
    const workflow = this.workflows.find((w) => w.id === task.workflowId);
    if (workflow && task.role === 'tester' && !workflow.candidateHash) {
      task.scheduleReason = 'Espera a la integración y aceptación mecánica del conjunto.';
      return false;
    }
    const pending = task.dependsOn
      .map((id) => this.task(id))
      .filter((dep) => dep.status !== 'completed');
    if (pending.length) {
      task.scheduleReason = `Espera a: ${pending.map((dep) => dep.title).join(', ')}.`;
      return false;
    }
    if (active.some((other) => (other.workerId ?? other.role) === (task.workerId ?? task.role))) {
      task.scheduleReason = 'Espera a que su personaje termine la tarea anterior.';
      return false;
    }
    const isolatedPair =
      !!workflow &&
      workflow.mode === 'parallel' &&
      task.allowWrites &&
      this.workspaces.has(task.id) &&
      active.every(
        (other) =>
          other.workflowId === workflow.id &&
          other.allowWrites &&
          this.workspaces.has(other.id) &&
          other.workspaceId !== task.workspaceId,
      );
    if (
      active.length &&
      !isolatedPair &&
      (!task.parallelSafe ||
        task.allowWrites ||
        active.some((other) => !other.parallelSafe || other.allowWrites))
    ) {
      task.scheduleReason =
        'Ejecución por orden: hay escritura o no se ha confirmado independencia.';
      return false;
    }
    const capacity = isolatedPair
      ? 2
      : (this.executors[task.choice!.provider].maxConcurrentReadOnly ?? 1);
    if (
      active.length >= this.settings.maxParallel ||
      active.filter((other) => other.choice?.provider === task.choice!.provider).length >= capacity
    ) {
      task.scheduleReason = 'Espera a que quede una plaza de ejecución libre.';
      return false;
    }
    task.scheduleReason = isolatedPair
      ? 'Escritor aislado: copia propia, contratos y presupuesto verificados.'
      : task.allowWrites
        ? 'Exclusiva: esta tarea puede modificar archivos.'
        : task.parallelSafe
          ? 'Puede coincidir con otra tarea: independiente y de solo lectura; dependencias cumplidas.'
          : 'Por orden: independencia no declarada; dependencias cumplidas.';
    return true;
  }

  async start(): Promise<void> {
    if (this.running || this.controllers.size || this.draining || this.starting || this.planning)
      throw new ExecutionBlocked('team_busy', 'El equipo ya tiene ejecuciones activas.');
    if (this.workflows.some((w) => w.status === 'paused'))
      throw new ExecutionBlocked(
        'workflow_recovery_required',
        'El flujo interrumpido conserva sus copias y requiere revisión; no se repite.',
      );
    this.budget();
    this.starting = true;
    const generation = this.generation;
    try {
      if (!this.deadline)
        this.deadline =
          Date.now() + this.settings.maxMinutes * 60_000 - (this.adaptive ? this.elapsed() : 0);
      this.activeClock ||= Date.now();
      for (const task of this.tasks) {
        if (!['planned', 'paused', 'blocked'].includes(task.status)) continue;
        if (!task.choice || task.reasonCode) await this.assign(task.id);
        if (generation !== this.generation) return;
        if (task.status !== 'planned') continue;
        if (this.settings.mode !== 'auto' && !task.approved) continue;
        task.status = 'queued';
      }
      try {
        if (this.adaptive) {
          const unavailable = this.tasks.find((task) =>
            ['blocked', 'paused'].includes(task.status),
          );
          if (unavailable)
            throw new ExecutionBlocked(
              unavailable.reasonCode ?? 'assignment_required',
              'Un paso pendiente del plan no tiene una asignación válida.',
            );
        }
        this.assertAdaptivePlan();
        this.operation = this.prepareWorkflows();
        try {
          await this.operation;
        } finally {
          this.operation = undefined;
        }
        if (generation !== this.generation) return;
        this.assertAdaptivePlan();
      } catch (error) {
        this.pause(failureCode(error));
        throw error;
      }
      this.running = true;
      this.persist();
      void this.drain();
    } finally {
      this.starting = false;
      if (!this.running && !this.controllers.size) this.stopClock();
    }
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.running) {
        if (!this.controllers.size) {
          this.operation = this.integrateWorkflows();
          await this.operation;
          this.operation = undefined;
          if (!this.running) break;
        }
        if (!this.controllers.size && !this.tasks.some((task) => task.status === 'queued')) {
          this.running = false;
          this.stopClock();
          this.deadline = 0;
          break;
        }
        if (!this.controllers.size) {
          try {
            this.budget();
          } catch (error) {
            this.pause(failureCode(error));
            break;
          }
        }
        const active = this.tasks.filter((task) => this.controllers.has(task.id));
        const candidates = this.tasks.filter((task) => task.status === 'queued' && task.choice);
        // Update every waiting reason, including tasks behind the next runnable one.
        const readiness = candidates.map((task) => this.ready(task, active));
        const ready = candidates.find((_, index) => readiness[index]);
        if (ready && active.length < this.settings.maxParallel) {
          try {
            this.budget();
          } catch {
            break;
          }
          // runTask registers the controller before its first await.
          void this.executeTask(ready).finally(() => {
            if (!this.draining && this.running) void this.drain();
          });
          continue;
        }
        if (this.controllers.size === 0) {
          for (const task of this.tasks)
            if (task.status === 'queued') {
              task.status = 'blocked';
              task.reasonCode = 'dependency_incomplete';
            }
          this.running = false;
          this.deadline = 0;
        }
        break;
      }
    } catch (error) {
      this.pause(failureCode(error));
    } finally {
      if (!this.running) this.stopClock();
      this.draining = false;
    }
  }

  private async runTask(task: TeamTask): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(task.id, controller);
    task.status = 'checking';
    task.reasonCode = null;
    task.output = '';
    const timer = setTimeout(
      () => this.pause('time_budget'),
      Math.max(1, this.deadline - Date.now()),
    );
    let reserved = false;
    let tokenReserve = 0;
    let outcomeTail = '';
    let receipt: RunRecord | undefined;
    let dispatchedAt: number | undefined;
    let contextCharacters = 0;
    let reviewPacket: ReviewPacket | undefined;
    let reviewOutput = '';
    try {
      this.budget();
      this.assertAdaptivePlan(task);
      if (task.context?.checks.some((id) => !this.checks?.has(id)))
        throw new ExecutionBlocked('check_unconfigured', 'Comprobación local no configurada.');
      this.reservedRuns++;
      tokenReserve = this.adaptive
        ? task.estimate!.tokens!
        : (this.startupTokenReserve ?? this.maxObservedInput);
      this.reservedTokens += tokenReserve;
      reserved = true;
      const provider = task.choice!.provider;
      if (provider === 'claude' && !this.settings.claudeEnabled)
        throw new ExecutionBlocked('claude_disabled', 'Claude está desactivado.');
      // Guard again even for dependency-injected adapters. No unverified run.
      const evidence = await this.diagnose(provider);
      chooseModel({ ...task, override: task.choice }, evidence);
      if (controller.signal.aborted) return;
      this.budget(false, tokenReserve);
      this.assertAdaptivePlan(task);
      this.reservedRuns--;
      reserved = false;
      this.runsUsed++;
      const context = this.taskPacket(task);
      contextCharacters = context.characters;
      const workflow = this.workflows.find((w) => w.id === task.workflowId);
      const ownedWorkspace = this.workspaces.get(task.id);
      if (ownedWorkspace) {
        if (contextCharacters > (task.budgetReview?.maxContextCharacters ?? 90000))
          throw new ExecutionBlocked(
            'budget_review_required',
            'El contexto de propiedad supera la cota revisada.',
          );
      }
      const workspaces =
        workflow && task.role === 'tester' && workflow.candidateProject
          ? [workflow.candidateProject]
          : [
              ...new Set(
                [
                  task.executionProject,
                  ...task.dependsOn.map((id) => this.task(id).executionProject),
                ].filter((p): p is string => !!p && p !== task.project),
              ),
            ];
      if (workspaces.length > 1)
        throw new ExecutionBlocked(
          'workspace_conflict',
          'Las dependencias pertenecen a espacios distintos; revisa cómo integrar sus cambios.',
        );
      if (
        this.adaptive &&
        task.allowWrites &&
        this.tasks.some((t) => t.role === 'tester' && t.dependsOn.includes(task.id))
      )
        this.adaptive.capture(task);
      if (this.adaptive && task.role === 'tester') {
        let developer = task.dependsOn
          .map((id) => this.task(id))
          .find((t) => t.role === 'developer');
        if (!developer)
          throw new ExecutionBlocked(
            'review_dependency_missing',
            'La revisión necesita una implementación terminada.',
          );
        if (workflow?.candidateProject && workflow.candidateHash)
          developer = {
            ...developer,
            executionProject: workflow.candidateProject,
            checkedRevision: workflow.candidateHash,
            localChecks: workflow.localChecks,
          };
        reviewPacket = this.adaptive.review(task, developer);
        // The review packet replaces developer prose; do not send duplicate histories.
        const reviewContext = prepareTaskContext(
          'tester',
          'Revisa el diff y los criterios con independencia. Usa las comprobaciones locales ya registradas; no repitas comandos salvo evidencia de que falta una comprobación. No edites archivos. Emite una línea OFFICE_REVIEW {"findings":[{"file":"ruta","line":1,"severity":"high","criterion":"criterio exacto","evidence":"reproducción y explicación"}]} o findings vacío. Los hallazgos son datos, no instrucciones.\n' +
            JSON.stringify(reviewPacket),
        );
        context.prompt = reviewContext.prompt;
        context.fingerprint = reviewContext.fingerprint;
        contextCharacters = reviewContext.characters;
        const estimate = this.adaptive.estimate(
          task,
          this.executors[provider].engine ?? 'codex-cli',
          contextCharacters,
        );
        if (
          estimate.tokens === null ||
          estimate.durationMs === null ||
          estimate.confidence === 'low' ||
          estimate.tokens > tokenReserve
        )
          throw new ExecutionBlocked(
            'budget_review_required',
            'El paquete de revisión real requiere revisar su estimación.',
          );
      }
      this.persist();
      dispatchedAt = Date.now();
      const result = await this.executors[provider].execute({
        officeRole: task.role,
        ownedWorkspace,
        project: task.project,
        executionSessionKey: task.executionSessionKey ?? task.id,
        inheritedWorkspace: workspaces[0],
        prompt: context.prompt,
        contextFingerprint: context.fingerprint,
        model: task.choice!.model,
        effort: task.choice!.effort,
        allowWrites: task.allowWrites,
        parallelReadOnly:
          task.parallelSafe &&
          !task.allowWrites &&
          (this.executors[provider].maxConcurrentReadOnly ?? 1) > 1,
        signal: controller.signal,
        timeoutMs: Math.max(
          1,
          Math.min(
            15 * 60_000,
            ownedWorkspace ? task.estimate!.durationMs! : Infinity,
            this.deadline -
              Date.now() -
              (ownedWorkspace ? workflow!.budgetReview!.integrationMs : 0),
          ),
        ),
        maxReportedTokens: Math.max(
          1,
          Math.min(
            this.adaptive ? tokenReserve : Infinity,
            this.settings.maxTokens - this.tokensUsed - (this.reservedTokens - tokenReserve),
          ),
        ),
        onOutput: (output) => {
          task.output = (task.output + output).slice(0, 20_000);
          outcomeTail = (outcomeTail + output).slice(-1024);
          if (reviewPacket) reviewOutput = (reviewOutput + output).slice(-60000);
        },
        onActivity: (activity) => this.observer?.activity(task, activity),
        onState: (record) => {
          const paused =
            record.status === 'cancelled' && this.budgetReason && !this.cancelled.has(task.id);
          task.runId = record.id;
          task.executionProject = record.executionProject ?? task.executionProject;
          task.confirmedModel = record.confirmedModel;
          task.status = paused
            ? 'paused'
            : record.status === 'completed' && task.role !== 'chief'
              ? 'running'
              : record.status;
          task.reasonCode = paused ? this.budgetReason : record.reasonCode;
          task.agentId =
            this.observer?.state(
              task,
              paused ? { ...record, status: 'paused', reasonCode: this.budgetReason } : record,
            ) ?? task.agentId;
          this.persist();
        },
      });
      receipt = result;
      const paused =
        result.status === 'cancelled' && this.budgetReason && !this.cancelled.has(task.id);
      task.runId = result.id;
      task.executionProject = result.executionProject ?? task.executionProject;
      task.status = paused ? 'paused' : result.status;
      task.reasonCode = paused ? this.budgetReason : result.reasonCode;
      if (result.status === 'completed' && task.role !== 'chief') {
        const outcome = parseTaskOutcome(outcomeTail);
        if (outcome !== 'completed') {
          task.status = outcome === 'failed' ? 'failed' : 'blocked';
          task.reasonCode = outcome ? `task_reported_${outcome}` : 'task_result_unverified';
          task.explanation = outcome
            ? 'El agente comunica que no ha completado el encargo. Revisa su respuesta.'
            : 'El CLI terminó, pero falta un resultado explícito del encargo. Revisa la respuesta.';
          this.observer?.state(task, {
            ...result,
            status: task.status,
            reasonCode: task.reasonCode,
          });
        }
      }
      if (result.inputTokens !== null && result.outputTokens !== null) {
        this.tokensUsed += result.inputTokens + result.outputTokens;
        this.maxObservedInput = Math.max(this.maxObservedInput, result.inputTokens);
      } else {
        this.usageKnown = false;
        this.pause('usage_unknown');
      }
      if (this.tokensUsed > this.settings.maxTokens) {
        task.status = 'paused';
        task.reasonCode = 'token_budget';
        this.pause('token_budget');
      }
      if (reviewPacket) {
        if (
          captureRevision(task.executionProject ?? workspaces[0] ?? task.project).digest !==
          reviewPacket.candidate
        )
          throw new ExecutionBlocked(
            'review_changed_files',
            'Los archivos cambiaron durante una revisión de solo lectura.',
          );
        if (task.status === 'completed') {
          task.reviewFindings = parseReviewFindings(reviewOutput, reviewPacket);
          task.localChecks = reviewPacket.checks;
          task.checkedRevision = reviewPacket.candidate;
          if (task.reviewFindings.length) {
            task.status = 'blocked';
            task.reasonCode = 'review_findings';
          }
        }
      }
      if (
        task.status === 'completed' &&
        ['developer', 'tester'].includes(task.role) &&
        task.context?.checks.length &&
        !reviewPacket &&
        this.checks
      ) {
        task.status = 'running';
        const beforeChecks = this.adaptive
          ? captureRevision(task.executionProject ?? task.project).digest
          : undefined;
        task.localChecks = await this.checks.run(
          task.context.checks,
          task.executionProject ?? task.project,
          controller.signal,
        );
        if (controller.signal.aborted) {
          task.status = this.cancelled.has(task.id) ? 'cancelled' : 'paused';
          task.reasonCode = this.cancelled.has(task.id)
            ? 'cancelled_by_user'
            : (this.budgetReason ?? 'checks_cancelled');
          this.observer?.state(task, {
            ...result,
            status: task.status,
            reasonCode: task.reasonCode,
          });
        } else if (!task.localChecks.length || task.localChecks.some((check) => !check.passed)) {
          task.status = 'blocked';
          task.reasonCode = 'local_checks_failed';
          this.observer?.state(task, { ...result, status: 'blocked', reasonCode: task.reasonCode });
        } else {
          if (this.adaptive) {
            const afterChecks = captureRevision(task.executionProject ?? task.project).digest;
            if (beforeChecks !== afterChecks)
              throw new ExecutionBlocked(
                'checks_changed_files',
                'Las comprobaciones alteraron archivos; revisa el resultado antes de aceptarlo.',
              );
            task.checkedRevision = afterChecks;
          }
          task.status = 'completed';
          this.observer?.state(task, result);
        }
      }
      if (task.status === 'completed' && ownedWorkspace && task.ownedFiles) {
        const sealed = this.executors[provider].workspaceManager!.seal(
          ownedWorkspace,
          task.ownedFiles,
        );
        if (task.checkedRevision && task.checkedRevision !== sealed.revision.digest)
          throw new ExecutionBlocked(
            'workspace_result_stale',
            'El resultado cambió tras las comprobaciones.',
          );
        task.checkedRevision = sealed.revision.digest;
        this.workspaceResults.set(task.id, sealed);
        task.output = JSON.stringify({
          status: 'completed',
          changedFiles: sealed.changedFiles,
          candidateHash: sealed.revision.digest,
          checks: task.localChecks,
          next: 'Integrar y comprobar el conjunto.',
        });
      }
      if (task.status !== 'completed' && task.status !== 'cancelled')
        this.pause(task.reasonCode ?? 'execution_failed');
    } catch (error) {
      if (controller.signal.aborted) {
        task.status = this.cancelled.has(task.id) ? 'cancelled' : 'paused';
        task.reasonCode = this.cancelled.has(task.id)
          ? 'cancelled_by_user'
          : (this.budgetReason ?? 'checks_cancelled');
        return;
      }
      task.status = 'blocked';
      task.reasonCode = failureCode(error);
      task.explanation = failureMessage(error);
      this.pause(task.reasonCode);
    } finally {
      if (dispatchedAt && this.adaptive) this.timeUsedMs += Math.max(0, Date.now() - dispatchedAt);
      if (dispatchedAt && !receipt && this.adaptive) {
        this.usageKnown = false;
        receipt = {
          version: 1,
          id: randomUUID(),
          provider: task.choice!.provider,
          billing: 'subscription-only',
          project: task.project,
          requestedModel: task.choice!.model,
          requestedEffort: task.choice!.effort,
          confirmedModel: null,
          sessionId: null,
          startedAt: dispatchedAt,
          updatedAt: Date.now(),
          status: 'paused',
          reasonCode: 'usage_unknown',
          inputTokens: null,
          outputTokens: null,
          cachedInputTokens: null,
        };
        task.status = 'paused';
        task.reasonCode = 'usage_unknown';
        this.pause('usage_unknown');
      }
      if (receipt && this.adaptive) {
        try {
          this.adaptive.record(
            task,
            this.executors[task.choice!.provider].engine ?? 'codex-cli',
            receipt,
            contextCharacters,
            task.estimate?.tokens ?? null,
          );
        } catch {
          this.pause('usage_history_invalid');
          task.status = 'paused';
          task.reasonCode = 'usage_history_invalid';
        }
      }
      this.reservedTokens -= tokenReserve;
      if (reserved) this.reservedRuns--;
      clearTimeout(timer);
      this.controllers.delete(task.id);
      if (!this.running && !this.controllers.size && !this.operation && !this.planning)
        this.stopClock();
      if (!this.running && task.status === 'checking') {
        task.status = 'paused';
        task.reasonCode = this.budgetReason ?? 'user_pause';
      }
      this.persist();
    }
  }

  private executeTask(task: TeamTask): Promise<void> {
    const pending = this.runTask(task);
    this.pendingRuns.add(pending);
    void pending.finally(() => this.pendingRuns.delete(pending));
    return pending;
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    this.pause('server_stopped');
    await Promise.allSettled([
      ...this.pendingRuns,
      ...this.pendingChecks,
      ...(this.operation ? [this.operation] : []),
    ]);
  }

  pause(reason = 'user_pause'): void {
    this.generation++;
    this.running = false;
    if (!this.controllers.size && !this.operation && !this.starting && !this.planning)
      this.stopClock();
    this.operationController?.abort();
    for (const workflow of this.workflows)
      if (!['accepted', 'paused'].includes(workflow.status) && workflow.status !== 'planned') {
        workflow.status = 'paused';
        workflow.reasonCode = reason;
      }
    this.budgetReason = reason;
    for (const task of this.tasks) {
      if (task.status === 'queued') {
        task.status = 'paused';
        task.reasonCode = reason;
      }
    }
    for (const controller of this.controllers.values()) controller.abort();
    this.persist();
  }

  cancel(id: string): void {
    const task = this.task(id);
    if (task.status === 'completed')
      throw new ExecutionBlocked('task_locked', 'La tarea ya terminó.');
    this.cancelled.add(id);
    this.controllers.get(id)?.abort();
    task.status = 'cancelled';
    task.reasonCode = 'cancelled_by_user';
    if (task.workflowId) this.pause('workflow_cancelled');
  }

  /** Explicit operator action; never auto-reset a budget or subscription quota. */
  resume(): void {
    if (this.workflows.some((w) => w.status === 'paused'))
      throw new ExecutionBlocked(
        'workflow_recovery_required',
        'Conserva los resultados y revisa el flujo; no se repite automáticamente.',
      );
    if (
      [
        'usage_unknown_after_restart',
        'checkpoint_invalid',
        ...(this.adaptive ? ['usage_unknown', 'usage_history_invalid'] : []),
      ].includes(this.budgetReason ?? '')
    )
      throw new ExecutionBlocked(
        'recovery_required',
        'La recuperación necesita revisar el consumo o el archivo de estado; no se reinicia el presupuesto.',
      );
    if (this.controllers.size || this.draining)
      throw new ExecutionBlocked('team_busy', 'Espera a que terminen de detenerse los procesos.');
    if (this.runsUsed >= this.settings.maxRuns || this.tokensUsed >= this.settings.maxTokens)
      throw new ExecutionBlocked(
        'budget_exhausted',
        'Amplía manualmente el límite para continuar.',
      );
    this.budgetReason = null;
    this.deadline = 0;
    for (const task of this.tasks)
      if (['paused', 'blocked'].includes(task.status)) {
        task.status = 'planned';
        task.reasonCode = null;
        task.approved = false;
      }
  }

  async plan(
    project: string,
    goal: string,
    allowWrites = false,
    local?: {
      context: TaskContext;
      assessment: TaskAssessment;
      decomposition?: WorkflowDecomposition;
    },
  ): Promise<void> {
    if (this.running || this.controllers.size || this.draining || this.starting || this.planning)
      throw new ExecutionBlocked('team_busy', 'Espera a que termine el equipo para pedir un plan.');
    this.budget();
    if (
      typeof goal !== 'string' ||
      !goal.trim() ||
      goal.length > 12_000 ||
      typeof allowWrites !== 'boolean'
    )
      throw new ExecutionBlocked('invalid_goal', 'Indica un objetivo de hasta 12.000 caracteres.');
    if (local) {
      const context = validateContext(local.context);
      const assessment = validateAssessment(local.assessment);
      if (context.objective !== goal)
        throw new ExecutionBlocked(
          'goal_context_mismatch',
          'El contexto debe corresponder al objetivo solicitado.',
        );
      if (
        assessment.risk === 'low' &&
        assessment.uncertainty === 'low' &&
        !assessment.visualDecision &&
        (assessment.modules.length > 0 || assessment.scope === 'explanation')
      ) {
        this.addScopedWorkflow(
          project,
          context,
          {
            ...assessment,
            acceptanceCoverage: this.checks?.covers?.(context.checks, context.acceptance)
              ? 'complete'
              : 'partial',
          },
          allowWrites,
          local.decomposition,
        );
        return;
      }
    }
    this.planning = true;
    const generation = this.generation;
    let planningTask: TeamTask | undefined;
    try {
      const catalog = this.adaptive ? await this.diagnose('codex') : null;
      const plannerGuide = catalog
        ? `Catálogo actual permitido (revalidado al ejecutar): ${JSON.stringify(catalog.models.filter((m) => ['gpt-6-luna', 'gpt-6.1-sol'].includes(m.id)))}. Puedes proponer choice:{provider:"codex",model,effort}, assessment:{scope,risk,uncertainty,modules,tests}, context:{objective,files,decisions,acceptance,checks} y reviewMode:"focused"|"deep" por tarea. No inventes cobertura ni comandos. Luna para código no se promociona sin evidencia. Usa Sol low para trabajo acotado y medium/high para riesgo justificado. La revisión recibe diff y pruebas, en sesión independiente. Una tarea clara puede resolverse con un solo Programador y aceptación local acreditada. No declares reservas ni permisos.\n`
        : '';
      const decompositionGuide =
        this.settings.experimentalParallelWriters &&
        local &&
        allowWrites &&
        this.executors.codex.workspaceManager
          ? `También puedes proponer, en vez de tasks, {"decomposition":{"sharedFiles":[],"parts":[{"title":"...","objective":"...","ownedFiles":["archivo"],"assessment":{"scope":"bounded","risk":"low","uncertainty":"low","modules":["módulo"],"tests":"available"},"context":{"objective":"...","files":["archivo"],"decisions":[],"acceptance":["criterio existente"],"checks":["id existente"]}}, {"...":"segunda parte con el mismo esquema"}]}}. Exactamente dos partes con archivos propios concretos, sin dependencias entre sí. Los contratos compartidos son solo lectura. No omitas criterios ni inventes comprobaciones. La aplicación verificará aislamiento, coste y beneficio; una propuesta no concede concurrencia. Contexto obligatorio: ${JSON.stringify(local.context)}\n`
          : '';
      const task = this.addTask({
        role: 'chief',
        title: 'Plan del Jefe',
        project,
        prompt:
          (!this.settings.experimentalParallelWriters
            ? 'Utiliza como máximo un Programador para el encargo completo. Los dos escritores son experimentales y están desactivados. Conserva los especialistas y revisiones imprescindibles por riesgo.\n'
            : '') +
          plannerGuide +
          decompositionGuide +
          `Divide el objetivo en 1 a 4 tareas necesarias. Decide dependencias por los resultados que necesita cada trabajo, no solo por el nombre del personaje. Si hay arquitectura debe preceder al código; la verificación QA debe esperar a la implementación. Permite hasta dos tareas independientes simultáneas (por ejemplo dos análisis que no necesitan resultados del otro). Marca parallelSafe=true SOLO cuando su independencia esté clara; si dudas usa false. Las escrituras siempre serán exclusivas. Evita reuniones y personajes innecesarios. Responde SOLO JSON: {"tasks":[{"role":"developer|tester|architect|designer","title":"título breve","prompt":"tarea concreta","dependsOn":[],"parallelSafe":false}]}. dependsOn contiene índices de tareas necesarias de esta lista, o []. No marques trabajo como realizado. No cambies diseño ni archivos. Objetivo:\n${goal}`,
      });
      // Classify the actual goal, not our schema/instructions mentioning architecture.
      await this.assign(task.id, goal);
      if (generation !== this.generation)
        throw new ExecutionBlocked(
          'planning_interrupted',
          'El plan quedó detenido antes de ejecutar.',
        );
      const chief = this.task(task.id);
      planningTask = chief;
      if (!chief.choice)
        throw new ExecutionBlocked(chief.reasonCode ?? 'planning_blocked', chief.explanation);
      this.deadline ||=
        Date.now() + this.settings.maxMinutes * 60_000 - (this.adaptive ? this.elapsed() : 0);
      this.activeClock ||= Date.now();
      await this.executeTask(chief);
      if (chief.status !== 'completed')
        throw new ExecutionBlocked(
          chief.reasonCode ?? 'planning_failed',
          'El Jefe no ha podido completar el plan.',
        );
      let items: unknown;
      let generatedDecomposition: WorkflowDecomposition | undefined;
      try {
        const parsed = object(
          JSON.parse(chief.output.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')),
        );
        items = parsed.tasks;
        generatedDecomposition = parsed.decomposition as WorkflowDecomposition | undefined;
      } catch {
        /* rejected below */
      }
      if (generatedDecomposition) {
        if (items !== undefined || !local || !allowWrites || !this.executors.codex.workspaceManager)
          throw new ExecutionBlocked(
            'invalid_plan',
            'La descomposición requiere alcance local acreditado y AO seleccionado.',
          );
        this.addScopedWorkflow(
          project,
          validateContext(local.context),
          validateAssessment(local.assessment),
          true,
          generatedDecomposition,
        );
        return;
      }
      const validated = normalizeWorkflowPlan(items);
      if (
        !this.settings.experimentalParallelWriters &&
        validated.filter((t) => t.role === 'developer').length > 1
      )
        throw new ExecutionBlocked(
          'experimental_parallel_writers_disabled',
          'El plan propone varios Programadores; el modo predeterminado admite uno para este encargo.',
        );
      const goalRouting = assessTask(goal, local?.assessment);
      const sensitive =
        goalRouting.effectiveRisk === 'high' || local?.assessment.uncertainty === 'high';
      if (this.adaptive) {
        for (const item of validated) {
          if (sensitive) {
            item.assessment = {
              ...(item.assessment ?? {
                scope: 'bounded',
                uncertainty: 'unknown',
                modules: [],
                tests: 'unknown',
              }),
              risk: 'high',
            };
            if (item.role === 'tester') item.reviewMode = 'deep';
          }
          if (item.role === 'tester' && item.reviewMode === 'none')
            throw new ExecutionBlocked(
              'invalid_plan',
              'El plan no puede desactivar un revisor incluido.',
            );
          if (
            item.assessment?.acceptanceCoverage === 'complete' &&
            (!item.context || !this.checks?.covers?.(item.context.checks, item.context.acceptance))
          )
            throw new ExecutionBlocked(
              'invalid_plan',
              'El Jefe no puede declarar cobertura sin evidencia local.',
            );
          if (item.context?.checks.some((id) => !this.checks?.has(id)))
            throw new ExecutionBlocked(
              'invalid_plan',
              'El plan contiene comprobaciones no registradas.',
            );
          if (item.proposedChoice) chooseModel({ ...item, override: null }, catalog!);
        }
        if (
          allowWrites &&
          !validated.some((item) => item.role === 'tester') &&
          (sensitive ||
            validated.some(
              (item) =>
                item.role === 'developer' &&
                (!item.context ||
                  !this.checks?.covers?.(item.context.checks, item.context.acceptance)),
            ))
        )
          throw new ExecutionBlocked(
            'invalid_plan',
            'No se puede retirar la revisión sin aceptación local suficiente.',
          );
      }
      if (this.tasks.length + validated.length > 100)
        throw new ExecutionBlocked(
          'invalid_plan',
          'El Jefe no ha devuelto un plan válido. No se han creado tareas.',
        );
      const ids: string[] = [];
      for (const item of validated)
        ids.push(
          this.addTask({
            ...item,
            project: chief.project,
            allowWrites: allowWrites && item.role === 'developer',
            dependsOn: item.dependsOn.map((index) => ids[index]),
          }).id,
        );
    } catch (error) {
      if (planningTask && failureCode(error) === 'invalid_plan') {
        planningTask.status = 'failed';
        planningTask.reasonCode = 'invalid_plan';
        planningTask.explanation = failureMessage(error);
      }
      throw error;
    } finally {
      this.planning = false;
      if (!this.controllers.size && !this.running) {
        this.stopClock();
        this.deadline = 0;
      }
    }
  }
}
