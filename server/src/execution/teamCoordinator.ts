import { randomUUID } from 'node:crypto';
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
} from '../../../core/src/team.js';
import type { CheckRunner } from './localChecks.js';
import { object } from './subscriptionPolicy.js';
import { assessTask, validateAssessment } from './taskAssessment.js';
import { prepareTaskContext, validateContext } from './taskContext.js';
import { parseTaskOutcome } from './taskOutcome.js';
import { chooseModel, DEFAULT_TEAM_SETTINGS, validateSettings } from './teamPolicy.js';
import { ExecutionBlocked, type OfficialExecutor, type RunRecord } from './types.js';
import { normalizeWorkflowPlan } from './workflowPlan.js';

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
          saved.version !== 1 ||
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
          task.output = raw.output;
          task.executionProject = raw.executionProject;
          task.executionSessionKey = raw.executionSessionKey;
          task.runId = raw.runId;
          const settled = ['completed', 'failed', 'cancelled'].includes(raw.status);
          interrupted ||= ['running', 'checking'].includes(raw.status);
          task.status = settled ? raw.status : 'paused';
          task.reasonCode = settled ? raw.reasonCode : 'server_restarted';
          task.localChecks = raw.localChecks;
        }
        this.runsUsed = saved.runsUsed;
        this.tokensUsed = saved.tokensUsed;
        this.maxObservedInput = saved.maxObservedInput;
        this.budgetReason = interrupted
          ? 'usage_unknown_after_restart'
          : (saved.budgetReason ?? 'server_restarted');
      } catch {
        this.tasks.length = 0;
        this.budgetReason = 'checkpoint_invalid';
      }
    }
  }

  private persist(): void {
    if (!this.checkpointFile || this.budgetReason === 'checkpoint_invalid') return;
    mkdirSync(dirname(this.checkpointFile), { recursive: true, mode: 0o700 });
    const value = {
      version: 1,
      tasks: this.tasks,
      runsUsed: this.runsUsed,
      tokensUsed: this.tokensUsed,
      maxObservedInput: this.maxObservedInput,
      budgetReason: this.budgetReason,
    };
    writeFileSync(this.checkpointFile + '.tmp', JSON.stringify(value), { mode: 0o600 });
    renameSync(this.checkpointFile + '.tmp', this.checkpointFile);
  }

  snapshot(): TeamSnapshot {
    this.persist();
    return structuredClone({
      settings: this.settings,
      tasks: this.tasks,
      providers: this.providers,
      running: this.running,
      runsUsed: this.runsUsed,
      tokensUsed: this.tokensUsed,
      budgetReason: this.budgetReason,
    });
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
      role: input.role,
      title: input.title.trim(),
      prompt: input.prompt,
      context: input.context === undefined ? undefined : validateContext(input.context),
      assessment: input.assessment === undefined ? undefined : validateAssessment(input.assessment),
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
  ): TeamTask[] {
    const packet = validateContext(context);
    const evidence = validateAssessment(assessment);
    const routing = assessTask(packet.objective, evidence);
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
          dependsOn: tasks.map((task) => task.id),
          allowWrites: allowWrites && role === 'developer',
        }),
      );
    }
    return tasks;
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

  private budget(includeReservations = true, ownTokenReserve = 0): void {
    const inputEstimate = this.startupTokenReserve ?? this.maxObservedInput;
    if (this.closed) throw new ExecutionBlocked('server_stopped', 'La oficina se está cerrando.');
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
    if (this.deadline && Date.now() >= this.deadline)
      throw new ExecutionBlocked('time_budget', 'Se alcanzó el tiempo máximo del equipo.');
    if (this.budgetReason)
      throw new ExecutionBlocked(
        this.budgetReason,
        'El equipo está en pausa. Revisa el motivo antes de continuar.',
      );
  }

  private ready(task: TeamTask, active: TeamTask[]): boolean {
    const pending = task.dependsOn
      .map((id) => this.task(id))
      .filter((dep) => dep.status !== 'completed');
    if (pending.length) {
      task.scheduleReason = `Espera a: ${pending.map((dep) => dep.title).join(', ')}.`;
      return false;
    }
    if (active.some((other) => other.role === task.role)) {
      task.scheduleReason = 'Espera a que su personaje termine la tarea anterior.';
      return false;
    }
    if (
      active.length &&
      (!task.parallelSafe ||
        task.allowWrites ||
        active.some((other) => !other.parallelSafe || other.allowWrites))
    ) {
      task.scheduleReason =
        'Ejecución por orden: hay escritura o no se ha confirmado independencia.';
      return false;
    }
    const capacity = this.executors[task.choice!.provider].maxConcurrentReadOnly ?? 1;
    if (
      active.length >= this.settings.maxParallel ||
      active.filter((other) => other.choice?.provider === task.choice!.provider).length >= capacity
    ) {
      task.scheduleReason = 'Espera a que quede una plaza de ejecución libre.';
      return false;
    }
    task.scheduleReason = task.allowWrites
      ? 'Exclusiva: esta tarea puede modificar archivos.'
      : task.parallelSafe
        ? 'Puede coincidir con otra tarea: independiente y de solo lectura; dependencias cumplidas.'
        : 'Por orden: independencia no declarada; dependencias cumplidas.';
    return true;
  }

  async start(): Promise<void> {
    if (this.running || this.controllers.size || this.draining || this.starting || this.planning)
      throw new ExecutionBlocked('team_busy', 'El equipo ya tiene ejecuciones activas.');
    this.budget();
    this.starting = true;
    const generation = this.generation;
    try {
      if (!this.deadline) this.deadline = Date.now() + this.settings.maxMinutes * 60_000;
      for (const task of this.tasks) {
        if (!['planned', 'paused', 'blocked'].includes(task.status)) continue;
        if (!task.choice || task.reasonCode) await this.assign(task.id);
        if (generation !== this.generation) return;
        if (task.status !== 'planned') continue;
        if (this.settings.mode !== 'auto' && !task.approved) continue;
        task.status = 'queued';
      }
      this.running = true;
      this.persist();
      void this.drain();
    } finally {
      this.starting = false;
    }
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.running) {
        if (!this.controllers.size && !this.tasks.some((task) => task.status === 'queued')) {
          this.running = false;
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
    } finally {
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
    try {
      this.budget();
      if (task.context?.checks.some((id) => !this.checks?.has(id)))
        throw new ExecutionBlocked('check_unconfigured', 'Comprobación local no configurada.');
      this.reservedRuns++;
      tokenReserve = this.startupTokenReserve ?? this.maxObservedInput;
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
      this.reservedRuns--;
      reserved = false;
      this.runsUsed++;
      const context = prepareTaskContext(
        task.role,
        task.prompt,
        task.context,
        task.dependsOn.map((id) => {
          const dep = this.task(id);
          return { title: dep.title, output: dep.output };
        }),
      );
      const workspaces = [
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
      this.persist();
      const result = await this.executors[provider].execute({
        officeRole: task.role,
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
        timeoutMs: Math.max(1, Math.min(15 * 60_000, this.deadline - Date.now())),
        maxReportedTokens: Math.max(
          1,
          this.settings.maxTokens - this.tokensUsed - (this.reservedTokens - tokenReserve),
        ),
        onOutput: (output) => {
          task.output = (task.output + output).slice(0, 20_000);
          outcomeTail = (outcomeTail + output).slice(-1024);
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
      } else this.pause('usage_unknown');
      if (
        task.status === 'completed' &&
        ['developer', 'tester'].includes(task.role) &&
        task.context?.checks.length &&
        this.checks
      ) {
        task.status = 'running';
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
          task.status = 'completed';
          this.observer?.state(task, result);
        }
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
      this.reservedTokens -= tokenReserve;
      if (reserved) this.reservedRuns--;
      clearTimeout(timer);
      this.controllers.delete(task.id);
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
    await Promise.allSettled([...this.pendingRuns, ...this.pendingChecks]);
  }

  pause(reason = 'user_pause'): void {
    this.generation++;
    this.running = false;
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
  }

  /** Explicit operator action; never auto-reset a budget or subscription quota. */
  resume(): void {
    if (['usage_unknown_after_restart', 'checkpoint_invalid'].includes(this.budgetReason ?? ''))
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

  async plan(project: string, goal: string, allowWrites = false): Promise<void> {
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
    this.planning = true;
    const generation = this.generation;
    let planningTask: TeamTask | undefined;
    try {
      const task = this.addTask({
        role: 'chief',
        title: 'Plan del Jefe',
        project,
        prompt: `Divide el objetivo en 1 a 4 tareas necesarias. Decide dependencias por los resultados que necesita cada trabajo, no solo por el nombre del personaje. Si hay arquitectura debe preceder al código; la verificación QA debe esperar a la implementación. Permite hasta dos tareas independientes simultáneas (por ejemplo dos análisis que no necesitan resultados del otro). Marca parallelSafe=true SOLO cuando su independencia esté clara; si dudas usa false. Las escrituras siempre serán exclusivas. Evita reuniones y personajes innecesarios. Responde SOLO JSON: {"tasks":[{"role":"developer|tester|architect|designer","title":"título breve","prompt":"tarea concreta","dependsOn":[],"parallelSafe":false}]}. dependsOn contiene índices de tareas necesarias de esta lista, o []. No marques trabajo como realizado. No cambies diseño ni archivos. Objetivo:\n${goal}`,
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
      this.deadline ||= Date.now() + this.settings.maxMinutes * 60_000;
      await this.executeTask(chief);
      if (chief.status !== 'completed')
        throw new ExecutionBlocked(
          chief.reasonCode ?? 'planning_failed',
          'El Jefe no ha podido completar el plan.',
        );
      let items: unknown;
      try {
        items = object(
          JSON.parse(chief.output.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')),
        ).tasks;
      } catch {
        /* rejected below */
      }
      const validated = normalizeWorkflowPlan(items);
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
      if (!this.controllers.size && !this.running) this.deadline = 0;
    }
  }
}
