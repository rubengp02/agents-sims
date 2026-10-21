import { randomUUID, timingSafeEqual } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type {
  TaskAssessment,
  TaskContext,
  TeamChoice,
  TeamSettings,
  WorkflowDecomposition,
} from '../../../core/src/team.js';
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
        code: error instanceof ExecutionBlocked ? error.code : 'invalid_request',
        message: error instanceof ExecutionBlocked ? error.message : 'Solicitud incorrecta.',
      }),
    );
    routes.get('/api/team', async () => ({ ...team.snapshot(), controlToken }));
    routes.post('/api/team/check', async () => team.refresh());
    routes.post('/api/team/settings', async (request) => {
      team.configure(request.body as TeamSettings);
      return team.snapshot();
    });
    routes.post('/api/team/tasks', async (request) => {
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
