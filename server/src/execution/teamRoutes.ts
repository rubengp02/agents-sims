import { randomUUID, timingSafeEqual } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { MAX_IMAGE_BYTES } from '../../../core/src/artifacts.js';
import type {
  TaskAssessment,
  TaskContext,
  TeamChoice,
  TeamSettings,
  WorkflowDecomposition,
} from '../../../core/src/team.js';
import { InvalidOfficeImage } from '../tools/artifactErrors.js';
import { pickProjectFolder } from './projectFolderPicker.js';
import { object } from './subscriptionPolicy.js';
import type { TeamCoordinator } from './teamCoordinator.js';
import { ExecutionBlocked } from './types.js';

/** Same-origin localhost control surface; no CORS, DNS-rebinding or unauthenticated mutations. */
export function registerTeamRoutes(app: FastifyInstance, team: TeamCoordinator): void {
  const controlToken = randomUUID();
  const localRequest = async (request: FastifyRequest, reply: FastifyReply) => {
    const host = request.headers.host ?? '';
    const address = app.server.address();
    const port = typeof address === 'object' ? address?.port : null;
    if (
      !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip) ||
      !port ||
      ![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host) ||
      (request.headers.origin && request.headers.origin !== `http://${host}`) ||
      request.headers['sec-fetch-site'] === 'cross-site'
    ) {
      reply
        .code(403)
        .send({ code: 'local_origin_required', message: 'Abre el panel desde la oficina local.' });
      return;
    }
    if (request.method !== 'GET') {
      const token = request.headers['x-office-control'];
      if (
        typeof token !== 'string' ||
        Buffer.byteLength(token) !== Buffer.byteLength(controlToken) ||
        !timingSafeEqual(Buffer.from(token), Buffer.from(controlToken))
      )
        reply
          .code(403)
          .send({ code: 'control_token_required', message: 'Vuelve a abrir el panel del equipo.' });
    }
  };
  app.register(async (routes) => {
    routes.addHook('preHandler', localRequest);
    routes.addHook('onSend', async (_request, reply, payload) => {
      reply.header('Cache-Control', 'no-store');
      return payload;
    });
    routes.setErrorHandler((error, _request, reply) =>
      reply.code(error instanceof ExecutionBlocked ? 409 : 400).send({
        code:
          error instanceof ExecutionBlocked
            ? error.code
            : error instanceof InvalidOfficeImage
              ? 'invalid_image'
              : 'invalid_request',
        message:
          error instanceof ExecutionBlocked || error instanceof InvalidOfficeImage
            ? error.message
            : 'Solicitud incorrecta.',
      }),
    );
    routes.get('/api/team', async () => ({ ...team.snapshot(), controlToken }));
    routes.get('/api/team/tools', async () => ({
      capabilities: team.services?.capabilities() ?? [],
      approvals: team.services?.runtime.approvals.list() ?? [],
    }));
    routes.get('/api/team/tool-operations', async () => {
      const snapshot = team.snapshot();
      const operations = ((await team.services?.operationReviews.list()) ?? []).map((operation) => {
        const conversationId =
          operation.conversationId ??
          snapshot.tasks.find((task) => task.id === operation.taskId)?.conversationId;
        return { ...operation, ...(conversationId ? { conversationId } : {}) };
      });
      return { operations, officeRunning: snapshot.running };
    });
    routes.post('/api/team/tool-operations/:id/review', async (request) => {
      if (!team.services)
        throw new ExecutionBlocked(
          'tools_not_configured',
          'Las herramientas no están configuradas.',
        );
      const operation = (await team.services.operationReviews.list()).find(
        (entry) => entry.id === (request.params as { id: string }).id,
      );
      if (team.snapshot().running && operation?.originalStatus === 'dispatching')
        throw new ExecutionBlocked(
          'office_still_running',
          'Esta operación aún no tiene un recibo cerrado. Espera a que termine o detén la oficina antes de revisarla.',
        );
      const body = object(request.body);
      if (body.reviewed !== true || !['completed', 'not_completed'].includes(String(body.outcome)))
        throw new ExecutionBlocked(
          'operation_review_required',
          'Indica si has comprobado que la operación se realizó o que no se realizó.',
        );
      await team.services.operationReviews.acknowledge(
        (request.params as { id: string }).id,
        body.outcome as 'completed' | 'not_completed',
      );
      return team.snapshot();
    });
    routes.post('/api/team/tools/check', async () => {
      await team.refreshTools();
      return team.snapshot();
    });
    routes.post('/api/team/connections/:id/disable', async (request) => {
      if (!team.services)
        throw new ExecutionBlocked('tools_not_configured', 'Las conexiones no están configuradas.');
      await team.services.connections.disable((request.params as { id: string }).id);
      return team.snapshot();
    });
    routes.get('/api/team/connections/:id/operations', async (request) => {
      if (!team.services)
        throw new ExecutionBlocked('tools_not_configured', 'Las conexiones no están configuradas.');
      const id = (request.params as { id: string }).id;
      if (!team.services.connections.list().some((entry) => entry.id === id))
        throw new ExecutionBlocked('connection_unknown', 'La conexión no existe.');
      return team.services.connections.operations(id);
    });
    routes.post('/api/team/connections/:id/review', async (request) => {
      if (!team.services)
        throw new ExecutionBlocked('tools_not_configured', 'Las conexiones no están configuradas.');
      if (object(request.body).reviewed !== true)
        throw new ExecutionBlocked(
          'connection_review_required',
          'Confirma que has comprobado el resultado en el proveedor.',
        );
      await team.services.connections.acknowledge((request.params as { id: string }).id);
      return team.snapshot();
    });
    routes.post('/api/team/tool-approvals/:id', async (request) => {
      const body = object(request.body);
      if (typeof body.approved !== 'boolean')
        throw new ExecutionBlocked('invalid_approval', 'Elige aprobar o rechazar la operación.');
      const id = (request.params as { id: string }).id;
      if (!team.services?.runtime.approvals.resolve(id, body.approved, body.values))
        throw new ExecutionBlocked(
          'approval_expired',
          'La solicitud ya terminó o no está disponible. No se ha ejecutado otra operación.',
        );
      return team.snapshot();
    });
    routes.post('/api/team/authentication/:id/check', async (request) => {
      const id = (request.params as { id: string }).id;
      if (!team.services)
        throw new ExecutionBlocked('auth_unavailable', 'El inicio de sesión no está disponible.');
      if (
        !team.services.authentications
          .list()
          .some(
            (entry) =>
              entry.id === id &&
              entry.kind === 'application' &&
              ['awaiting_user', 'verifying'].includes(entry.status),
          )
      )
        throw new ExecutionBlocked(
          'auth_expired',
          'Esta conexión ya terminó o no está disponible.',
        );
      await team.services.authentications.checkApplication(id);
      return team.snapshot();
    });
    routes.post('/api/team/authentication/:id/cancel', async (request) => {
      const id = (request.params as { id: string }).id;
      if (!team.services?.authentications.cancel(id))
        throw new ExecutionBlocked(
          'auth_expired',
          'Esta autorización ya terminó o no está disponible.',
        );
      return team.snapshot();
    });
    routes.post(
      '/api/team/attachments',
      { bodyLimit: Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8192 },
      async (request) => {
        const body = object(request.body);
        if (!team.services)
          throw new ExecutionBlocked('tools_not_configured', 'Las imágenes no están configuradas.');
        team.assertConversation(body.conversationId as string);
        if (
          typeof body.data !== 'string' ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(body.data) ||
          body.data.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3)
        )
          throw new ExecutionBlocked(
            'invalid_image',
            'El adjunto no contiene una imagen válida dentro del tamaño permitido.',
          );
        const bytes = Buffer.from(body.data, 'base64');
        if (bytes.toString('base64') !== body.data)
          throw new ExecutionBlocked('invalid_image', 'El archivo no se ha recibido completo.');
        const artifact = await team.services.artifacts.put({
          name: body.name as string,
          bytes,
          kind: 'attachment',
          conversationId: body.conversationId as string,
        });
        return { artifact };
      },
    );
    routes.get('/api/team/artifacts/:id', async (request, reply) => {
      if (!team.services)
        throw new ExecutionBlocked(
          'tools_not_configured',
          'El almacén de imágenes no está disponible.',
        );
      const { artifact, bytes } = await team.services.artifacts.read(
        (request.params as { id: string }).id,
      );
      if (artifact.conversationId) team.assertConversation(artifact.conversationId);
      reply.header('Cross-Origin-Resource-Policy', 'same-origin');
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header(
        'Content-Disposition',
        `${(request.query as { download?: string }).download === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(artifact.name)}`,
      );
      return reply.type(artifact.mime).send(bytes);
    });
    routes.post('/api/team/projects/pick-folder', async () => ({
      path: await pickProjectFolder(),
    }));
    routes.post('/api/team/projects', async (request) => {
      const body = object(request.body);
      const saved = team.saveProject(
        body.project as string,
        body.name as string | undefined,
        body.instructions as string | undefined,
        body.context as TaskContext | undefined,
      );
      if (body.openConversation === true) team.selectProject(saved.id);
      return team.snapshot();
    });
    routes.post('/api/team/projects/select', async (request) => {
      team.selectProject(object(request.body).projectId as string);
      return team.snapshot();
    });
    routes.post('/api/team/projects/checks', async (request) => {
      const body = object(request.body);
      team.approveProjectChecks(
        body.projectId as string,
        body.fingerprint as string,
        body.ids as string[],
      );
      return team.snapshot();
    });
    routes.post('/api/team/projects/turbo', async (request) => {
      const body = object(request.body);
      team.setProjectTurbo(body.projectId as string, body.enabled as boolean);
      return team.snapshot();
    });
    routes.post('/api/team/projects/autonomy', async (request) => {
      const body = object(request.body);
      team.setProjectAutonomy(body.projectId as string, body.enabled as boolean);
      return team.snapshot();
    });
    routes.post('/api/team/conversations/send', async (request) => {
      const body = object(request.body);
      await team.submitConversation(
        body.id as string,
        body.message as string,
        body.officeMode as boolean | undefined,
        body.attachmentIds as string[] | undefined,
        body.inputId as string | undefined,
      );
      return team.snapshot();
    });
    routes.post('/api/team/conversations/queue', async (request) => {
      const body = object(request.body);
      await team.queueConversation(
        body.id as string,
        body as unknown as Parameters<TeamCoordinator['queueConversation']>[1],
      );
      return team.snapshot();
    });
    routes.post('/api/team/conversations/queue/update', async (request) => {
      const body = object(request.body);
      await team.updateQueuedConversation(
        body.id as string,
        body.inputId as string,
        body.revision as number,
        body.message as string,
        body.attachmentIds as string[] | undefined,
      );
      return team.snapshot();
    });
    routes.post('/api/team/conversations/queue/remove', async (request) => {
      const body = object(request.body);
      await team.removeQueuedConversation(
        body.id as string,
        body.inputId as string,
        body.revision as number,
      );
      return team.snapshot();
    });
    routes.post('/api/team/conversations/queue/continue', async (request) => {
      await team.continueQueuedConversation(object(request.body).id as string);
      return team.snapshot();
    });
    routes.post('/api/team/conversations/apply-now', async (request) => {
      const body = object(request.body);
      await team.applyConversationNow(
        body.id as string,
        body as unknown as Parameters<TeamCoordinator['applyConversationNow']>[1],
      );
      return team.snapshot();
    });
    routes.post('/api/team/conversations/run-pending', async (request) => {
      const body = object(request.body);
      await team.executeProjectConversation(
        body.taskId as string,
        body.resumeConfirmed as boolean | undefined,
      );
      return team.snapshot();
    });
    routes.post('/api/team/conversations/answer', async (request) => {
      const body = object(request.body);
      await team.answerOfficeQuestion(
        body.taskId as string,
        body.requestId as string,
        body.answer as string,
      );
      return team.snapshot();
    });
    routes.post('/api/team/conversations/prepare', async (request) => {
      const body = object(request.body);
      await team.prepareConversation(
        body.id as string,
        body.message as string,
        body.allowWrites as boolean | undefined,
        body.budgetMode as 'codex' | 'manual' | undefined,
        body.officeMode as boolean | undefined,
        body.attachmentIds as string[] | undefined,
      );
      return team.snapshot();
    });
    routes.post('/api/team/conversations/execute', async (request) => {
      const body = object(request.body);
      await team.confirmConversation(
        body.taskId as string,
        body.quotaConfirmed as boolean,
        body.writesConfirmed as boolean,
        body.resumeConfirmed as boolean,
        body.fingerprint as string,
      );
      return team.snapshot();
    });
    routes.post('/api/team/conversations', async (request) => {
      team.createConversation(object(request.body).projectId as string);
      return team.snapshot();
    });
    routes.post('/api/team/conversations/select', async (request) => {
      team.selectConversation(object(request.body).id as string);
      return team.snapshot();
    });
    routes.post('/api/team/conversations/draft', async (request) => {
      const body = object(request.body);
      if (body.attachmentIds !== undefined)
        await team.saveConversationAttachments(
          body.id as string,
          body.draft as string,
          body.attachmentIds as string[],
        );
      else team.saveConversationDraft(body.id as string, body.draft as string);
      return team.snapshot();
    });
    routes.post('/api/team/conversations/message', async (request) => {
      const body = object(request.body);
      team.sendConversation(
        body.id as string,
        body.message as string,
        body.allowWrites as boolean | undefined,
      );
      return team.snapshot();
    });
    routes.post('/api/team/check', async () => team.refresh());
    routes.post('/api/team/settings', async (request) => {
      team.configure(request.body as TeamSettings);
      return team.snapshot();
    });
    routes.post('/api/team/tasks', async (request) => {
      if (object(request.body).inputId !== undefined)
        throw new ExecutionBlocked(
          'invalid_task',
          'Los identificadores de mensajes se gestionan desde Conversaciones.',
        );
      team.addTask(request.body as Parameters<TeamCoordinator['addTask']>[0]);
      return team.snapshot();
    });
    routes.post('/api/team/scope', async (request) => {
      const body = object(request.body);
      team.addScopedWorkflow(
        body.project as string,
        body.context as TaskContext,
        body.assessment as TaskAssessment,
        body.allowWrites as boolean | undefined,
        body.decomposition as WorkflowDecomposition | undefined,
      );
      return team.snapshot();
    });
    routes.post('/api/team/assign', async (request) => {
      await team.assign(String(object(request.body).id));
      return team.snapshot();
    });
    routes.post('/api/team/override', async (request) => {
      const body = object(request.body);
      team.override(String(body.id), body.choice as TeamChoice | null);
      return team.snapshot();
    });
    routes.post('/api/team/approve', async (request) => {
      team.approve(String(object(request.body).id));
      return team.snapshot();
    });
    routes.post('/api/team/budget-review', async (request) => {
      const body = object(request.body);
      team.reviewBudget(
        String(body.id),
        body.tokens as number,
        body.durationMs as number,
        body.maxContextCharacters as number,
      );
      return team.snapshot();
    });
    routes.post('/api/team/workflow-budget-review', async (request) => {
      const body = object(request.body);
      team.reviewWorkflowBudget(
        String(body.id),
        body.preparationMs as number,
        body.integrationMs as number,
        body.sequentialMs as number,
      );
      return team.snapshot();
    });
    routes.post('/api/team/start', async () => {
      await team.start();
      return team.snapshot();
    });
    routes.post('/api/team/pause', async () => {
      team.pause();
      return team.snapshot();
    });
    routes.post('/api/team/resume', async () => {
      team.resume();
      return team.snapshot();
    });
    routes.post('/api/team/shutdown', async () => {
      await team.shutdown();
      return { stopped: true };
    });
    routes.post('/api/team/cancel', async (request) => {
      team.cancel(String(object(request.body).id));
      return team.snapshot();
    });
    // Planning is asynchronous; UI keeps polling while the official CLI works.
    let planning = false;
    let planError: { code: string; message: string } | null = null;
    routes.get('/api/team/planning', async () => ({ planning, error: planError }));
    routes.post('/api/team/plan', async (request, reply) => {
      if (planning) throw new ExecutionBlocked('team_busy', 'El Jefe ya está preparando un plan.');
      const body = object(request.body);
      if (
        typeof body.project !== 'string' ||
        typeof body.goal !== 'string' ||
        (body.allowWrites !== undefined && typeof body.allowWrites !== 'boolean')
      )
        throw new ExecutionBlocked('invalid_goal', 'Indica proyecto y objetivo.');
      planning = true;
      planError = null;
      void team
        .plan(
          body.project,
          body.goal,
          body.allowWrites === true,
          body.context && body.assessment
            ? {
                context: body.context as TaskContext,
                assessment: body.assessment as TaskAssessment,
                decomposition: body.decomposition as WorkflowDecomposition | undefined,
              }
            : undefined,
        )
        .catch((error) => {
          planError = {
            code: error instanceof ExecutionBlocked ? error.code : 'planning_failed',
            message:
              error instanceof ExecutionBlocked ? error.message : 'No se pudo preparar el plan.',
          };
        })
        .finally(() => {
          planning = false;
        });
      return reply.code(202).send({ planning: true });
    });
    routes.addHook('onClose', async () => {
      await team.shutdown();
    });
  });
}
