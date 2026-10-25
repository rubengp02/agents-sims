import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import * as crypto from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import Fastify from 'fastify';

import type { AgentRuntime } from './agentRuntime.js';
import type { AgentStateStore } from './agentStateStore.js';
import type {
  AssetCache,
  ReloadAssetsSideEffect,
  SetHooksEnabledSideEffect,
} from './clientMessageHandler.js';
import { handleClientMessage } from './clientMessageHandler.js';
import { HOOK_API_PREFIX, MAX_HOOK_BODY_SIZE } from './constants.js';
import type { TeamCoordinator } from './execution/teamCoordinator.js';
import { registerTeamRoutes } from './execution/teamRoutes.js';
import { employeeMessage, officePresence } from './officePresence.js';
import type { AgentState } from './types.js';

/** Options for creating the HTTP + WebSocket server. */
export interface HttpServerOptions {
  team?: TeamCoordinator;
  /** true = VS Code embedded mode (ephemeral port, no static, quiet logging) */
  embedded: boolean;
  /** Host to bind to. Default: '127.0.0.1' */
  host?: string;
  /** Port to listen on. Default: 0 (auto-assign) */
  port?: number;
  /** Bearer auth token for hook and WebSocket endpoints */
  token: string;
  /** AgentStateStore for WebSocket broadcast piping */
  store: AgentStateStore;
  /** Shared agent lifecycle core (for toggle side effects + standalone restore). Optional in embedded mode. */
  runtime?: AgentRuntime;
  /** Path to SPA dist directory for static serving (standalone only) */
  staticDir?: string;
  /** Cached assets loaded at startup (standalone only) */
  assetCache?: AssetCache;
  /** Callback when a hook event is received */
  onHookEvent?: (providerId: string, event: Record<string, unknown>) => void;
  /** Invoked when setHooksEnabled is toggled via WebSocket. Standalone installs/uninstalls hooks here. */
  onSetHooksEnabled?: SetHooksEnabledSideEffect;
  /** Invoked when an external asset directory is added/removed. Standalone reloads + re-broadcasts assets here. */
  onReloadAssets?: ReloadAssetsSideEffect;
}

/** Result of createHttpServer(). */
export interface HttpServerHandle {
  app: FastifyInstance;
  port: number;
}

const startTime = Date.now();

/**
 * Create a Fastify server with hook endpoint, health check, and WebSocket support.
 *
 * All Fastify-specific code lives in this file. The rest of the server layer is
 * framework-agnostic. If Fastify is ever replaced, only this file changes.
 */
export async function createHttpServer(options: HttpServerOptions): Promise<HttpServerHandle> {
  const app = Fastify({
    logger: !options.embedded,
    bodyLimit: MAX_HOOK_BODY_SIZE,
  });

  await app.register(fastifyCors, { origin: true });
  await app.register(fastifyWebsocket);

  // Static SPA serving (standalone mode only)
  if (!options.embedded && options.staticDir) {
    await app.register(fastifyStatic, {
      root: options.staticDir,
      prefix: '/',
    });
    // HTML5 history fallback: serve index.html for unmatched routes
    app.setNotFoundHandler((request, reply) => {
      if (request.url.split('?')[0].startsWith('/api/')) {
        return reply.code(404).send({
          code: 'api_not_found',
          message:
            'Esta función no está disponible en el servidor. Cierra y vuelve a abrir la oficina para actualizarlo.',
        });
      }
      reply.sendFile('index.html');
    });
  }

  // ── Routes ──────────────────────────────────────────────────

  registerHealthRoute(app);
  registerHookRoute(app, options);
  if (process.env.PIXEL_OFFICE_PREVIEW === '1' && process.env.PIXEL_OFFICE_PREVIEW_NONCE)
    app.get('/api/office/preview', async () => ({ nonce: process.env.PIXEL_OFFICE_PREVIEW_NONCE }));
  registerWebSocketRoute(app, options);
  if (!options.embedded && options.team) registerTeamRoutes(app, options.team);
  if (!options.embedded && options.team)
    app.get('/api/office/presence', async () => officePresence(options.store, options.team!));

  // ── Listen ──────────────────────────────────────────────────

  await app.listen({ host: options.host ?? '127.0.0.1', port: options.port ?? 0 });
  const address = app.server.address();
  const port = typeof address === 'object' ? (address?.port ?? 0) : 0;

  return { app, port };
}

// ── Health ──────────────────────────────────────────────────────

function registerHealthRoute(app: FastifyInstance): void {
  app.get('/api/health', async () => ({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    pid: process.pid,
  }));
}

// ── Hook Events ────────────────────────────────────────────────

function registerHookRoute(app: FastifyInstance, options: HttpServerOptions): void {
  app.post<{
    Params: { providerId: string };
    Body: Record<string, unknown>;
  }>(
    `${HOOK_API_PREFIX}/:providerId`,
    {
      preHandler: bearerAuth(options.token),
      schema: {
        params: {
          type: 'object',
          properties: {
            providerId: { type: 'string', pattern: '^[a-z0-9-]+$' },
          },
          required: ['providerId'],
        },
      },
    },
    async (request, reply) => {
      const { providerId } = request.params;
      const event = request.body;

      if (event.session_id && event.hook_event_name) {
        options.onHookEvent?.(providerId, event);
      }

      reply.send('ok');
    },
  );
}

// ── WebSocket ──────────────────────────────────────────────────

function registerWebSocketRoute(app: FastifyInstance, options: HttpServerOptions): void {
  app.get('/ws', { websocket: true }, (socket, request) => {
    // Loopback alone does not prevent another website from opening this socket.
    if (
      !options.embedded &&
      request.headers.origin &&
      request.headers.origin !== `http://${request.headers.host}`
    ) {
      socket.close(4003, 'origin_not_allowed');
      return;
    }
    // Embedded VS Code clients additionally require their bearer token.
    if (options.embedded) {
      const auth = request.headers.authorization ?? '';
      const expected = `Bearer ${options.token}`;
      const authBuf = Buffer.from(auth);
      const expectedBuf = Buffer.from(expected);
      if (authBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(authBuf, expectedBuf)) {
        socket.close(4001, 'unauthorized');
        return;
      }
    }

    const { store } = options;
    const send = (message: Record<string, unknown>) => {
      const projected =
        !options.embedded && options.team ? employeeMessage(message, store) : message;
      if (projected) safeSend(socket, projected);
    };

    // Pipe store events to WebSocket client
    const onAgentAdded = (id: number, agent: AgentState) => {
      send({
        type: 'agentCreated',
        id,
        folderName: agent.folderName,
        isExternal: agent.isExternal || undefined,
        isTeammate: agent.leadAgentId !== undefined || undefined,
        teammateName: agent.agentName,
        parentAgentId: agent.leadAgentId,
        teamName: agent.teamName,
        hooksOnly: agent.hooksOnly || undefined,
        palette: agent.palette,
        hueShift: agent.hueShift,
      });
    };

    const onAgentRemoved = (id: number) => {
      send({ type: 'agentClosed', id });
    };

    const onBroadcast = (message: Record<string, unknown>) => {
      send(message);
    };

    store.on('agentAdded', onAgentAdded);
    store.on('agentRemoved', onAgentRemoved);
    store.on('broadcast', onBroadcast);

    // Handle incoming client messages
    socket.on('message', (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (
          !options.embedded &&
          options.team &&
          msg.type === 'saveAgentSeats' &&
          msg.seats &&
          typeof msg.seats === 'object' &&
          !Array.isArray(msg.seats)
        ) {
          // A filtered office only sends employee seats. Preserve preferences
          // belonging to hidden sessions instead of replacing them with absence.
          const hiddenSeats = Object.fromEntries(
            Object.entries(store.getAdapter()?.loadSeats() ?? {}).filter(
              ([id]) => !store.get(Number(id))?.officeRole,
            ),
          );
          msg.seats = { ...hiddenSeats, ...msg.seats };
        }
        if (!options.embedded && msg.type) {
          console.log('[Pixel Agents] WS client message:', msg.type);
        }
        handleClientMessage(msg, send, {
          store,
          runtime: options.runtime,
          cache: options.assetCache ?? null,
          onSetHooksEnabled: options.onSetHooksEnabled,
          onReloadAssets: options.onReloadAssets,
        });
      } catch {
        // Malformed JSON, ignore
      }
    });

    socket.on('close', () => {
      store.off('agentAdded', onAgentAdded);
      store.off('agentRemoved', onAgentRemoved);
      store.off('broadcast', onBroadcast);
    });
  });
}

// ── Auth Helper ────────────────────────────────────────────────

function bearerAuth(expectedToken: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.headers.authorization ?? '';
    const expected = `Bearer ${expectedToken}`;
    const authBuf = Buffer.from(auth);
    const expectedBuf = Buffer.from(expected);
    if (authBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(authBuf, expectedBuf)) {
      reply.code(401).send('unauthorized');
    }
  };
}

// ── Utilities ──────────────────────────────────────────────────

function safeSend(
  socket: { send: (data: string) => void; readyState: number },
  message: Record<string, unknown>,
): void {
  // WebSocket.OPEN = 1
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(message));
  }
}
