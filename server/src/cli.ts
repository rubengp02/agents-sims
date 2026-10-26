#!/usr/bin/env node

/**
 * Standalone CLI entry point: `npx pixel-agents`
 *
 * Starts the Fastify server in standalone mode with SPA serving and WebSocket.
 * Loads all assets (PNGs -> SpriteData) on startup and caches in memory.
 * Each connecting WebSocket client receives the full state on webviewReady.
 */

import * as path from 'path';

import { AgentRuntime } from './agentRuntime.js';
import { AgentStateStore } from './agentStateStore.js';
import {
  buildAssetCache,
  loadAllCharacters,
  loadAllFurniture,
  loadAllPets,
} from './assetReload.js';
import type { AssetCache, ReloadAssetsSideEffect } from './clientMessageHandler.js';
import { readConfig } from './configPersistence.js';
import { MAX_PORT, MIN_PORT } from './constants.js';
import { AdaptiveRuntime } from './execution/adaptiveRuntime.js';
import { adaptiveStateDirectory } from './execution/adaptiveState.js';
import { AntigravityExecutor } from './execution/antigravityExecutor.js';
import { ClaudeExecutor } from './execution/claudeExecutor.js';
import { ConversationLibrary } from './execution/conversationLibrary.js';
import { createOfficeExecutor } from './execution/engine.js';
import { pixelOfficeChecks } from './execution/localChecks.js';
import { OfficeSessionFilter } from './execution/officeSessionFilter.js';
import { TeamCoordinator } from './execution/teamCoordinator.js';
import { TeamOfficeBridge } from './execution/teamOfficeBridge.js';
import { ExecutionBlocked, type OfficialExecutor } from './execution/types.js';
import { UsageHistory } from './execution/usageHistory.js';
import { FileStateAdapter } from './fileStateAdapter.js';
import { copyHermesPlugin } from './providers/hook/hermes/hermesHookInstaller.js';
import {
  antigravityProvider,
  claudeProvider,
  codexProvider,
  copyHookScript,
  hermesProvider,
} from './providers/index.js';
import { PixelAgentsServer } from './server.js';
import { officeApprovalHandler } from './tools/appServerApprovals.js';
import { OfficeServices } from './tools/officeServices.js';

/** All providers this standalone server hosts, sharing one office. Claude stays
 *  first: AgentRuntime treats providers[0] as primary for its file-scanning
 *  singletons and legacy (no-providerId) call sites -- see agentRuntime.ts. */
const ALL_PROVIDERS = [claudeProvider, hermesProvider, codexProvider, antigravityProvider];

// ── Argument parsing ──────────────────────────────────────────

export interface CliArgs {
  /** Unset -> ephemeral (OS-assigned) port, so multiple standalone instances
   *  can run at once without a collision. --port picks a fixed one. */
  port?: number;
  host: string;
  providers: string[];
  watchAllSessions?: boolean;
}

/** Thrown by parseArgs on an invalid --port. Kept separate from process.exit so
 *  the parsing logic stays a pure, unit-testable function -- main() is the only
 *  place that turns a bad argument into an exit code. */
export class CliArgsError extends Error {}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    host: '127.0.0.1',
    providers: ALL_PROVIDERS.filter((p) => p.id !== 'antigravity').map((p) => p.id),
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' || argv[i] === '-p') {
      const raw = argv[i + 1];
      if (raw === undefined) {
        throw new CliArgsError(
          `Missing value for ${argv[i]}: expected an integer between ${MIN_PORT} and ${MAX_PORT}.`,
        );
      }
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < MIN_PORT || parsed > MAX_PORT) {
        throw new CliArgsError(
          `Invalid --port "${raw}": must be an integer between ${MIN_PORT} and ${MAX_PORT}.`,
        );
      }
      args.port = parsed;
      i++;
    } else if (argv[i] === '--host' && argv[i + 1]) {
      args.host = argv[i + 1];
      i++;
    } else if (argv[i] === '--providers') {
      const raw = argv[++i];
      const ids = raw?.split(',').map((id) => id.trim()) ?? [];
      if (!ids.length || ids.some((id) => !ALL_PROVIDERS.some((p) => p.id === id))) {
        throw new CliArgsError(
          'Invalid --providers: choose claude, hermes, codex, antigravity (comma-separated).',
        );
      }
      // Preserve the original primary-provider order, regardless of argument order.
      args.providers = ALL_PROVIDERS.filter((p) => ids.includes(p.id)).map((p) => p.id);
    } else if (argv[i] === '--watch-all-sessions') {
      args.watchAllSessions = true;
    } else if (argv[i] === '--no-watch-all-sessions') {
      args.watchAllSessions = false;
    } else if (argv[i] === '--help') {
      console.log(`Usage: pixel-agents [options]

Options:
  --port, -p <number>   Port to listen on (default: OS-assigned ephemeral port)
  --host <string>       Host to bind to (default: 127.0.0.1)
  --providers <list>    Enabled integrations (default: claude,hermes,codex)
  --watch-all-sessions  Observe local sessions across all project directories
  --no-watch-all-sessions  Restrict observation to tracked project directories
  --help                Show this help message`);
      process.exit(0);
    }
  }
  return args;
}

// ── Main ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`[Pixel Agents] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // dist/ contains both the CLI bundle and the assets/ + webview/ directories
  const distRoot = __dirname;
  const packageRoot = path.dirname(distRoot);
  const staticDir = path.join(distRoot, 'webview');

  // ── Load assets on startup (same pipeline as VS Code extension) ──
  // External asset directories are merged at startup too, so directories added
  // in a previous session survive a restart. buildAssetCache is the shared
  // loader used by both the standalone server and the VS Code adapter.
  console.log('[Pixel Agents] Loading assets...');
  const assetCache: AssetCache = await buildAssetCache(
    distRoot,
    readConfig().externalAssetDirectories,
  );
  const charCount = assetCache.characters?.characters.length ?? 0;
  const petCount = assetCache.pets?.pets.length ?? 0;
  const furnitureCount = assetCache.furniture?.catalog.length ?? 0;
  console.log(
    `[Pixel Agents] Assets loaded: ${charCount} characters, ${petCount} pets, ${furnitureCount} furniture items`,
  );

  // ── Store + adapter (shared settings + standalone-scoped agents/seats) ──
  const store = new AgentStateStore();
  const adapter = new FileStateAdapter({ namespace: 'standalone' });
  store.setAdapter(adapter);

  // ── Create server ──
  const server = new PixelAgentsServer();

  try {
    // Create runtime first (before server.start, so we can pass it in)
    const preview = process.env.PIXEL_OFFICE_PREVIEW === '1';
    // AgentRuntime needs a parser even without observation. Preview never installs
    // hooks or starts scanners, so this does not connect to personal sessions.
    const providers = preview
      ? [codexProvider]
      : ALL_PROVIDERS.filter((p) => args.providers.includes(p.id));
    const localRuntime =
      preview && process.env.PIXEL_OFFICE_STATE_DIR
        ? path.join(process.env.PIXEL_OFFICE_STATE_DIR, 'execution-state')
        : path.resolve('.local-office');
    const executionDirectory = path.join(localRuntime, 'executions');
    const officeSessions = new OfficeSessionFilter(executionDirectory);
    const runtime = new AgentRuntime(store, providers, {
      ignoreObservedSession: (provider, session, transcript) =>
        officeSessions.shouldIgnore(provider, session, transcript),
    });
    const adaptiveState =
      preview && process.env.PIXEL_OFFICE_STATE_DIR
        ? path.join(process.env.PIXEL_OFFICE_STATE_DIR, 'adaptive')
        : adaptiveStateDirectory(process.cwd());
    const officeServices = new OfficeServices(
      path.join(adaptiveState, 'office-tools'),
      packageRoot,
      path.join(distRoot, 'native', 'office-desktop.exe'),
    );
    await officeServices.initialize();
    const previewBlock = async (): Promise<never> => {
      throw new ExecutionBlocked(
        'preview_execution_disabled',
        'Esta es una vista previa aislada. Los modelos se ejecutan únicamente desde la oficina principal.',
      );
    };
    const previewExecutor: OfficialExecutor = {
      provider: 'codex',
      diagnose: previewBlock,
      execute: previewBlock,
    };
    const team: TeamCoordinator = new TeamCoordinator(
      {
        codex: preview
          ? previewExecutor
          : createOfficeExecutor(process.cwd(), executionDirectory, {
              approvals: officeApprovalHandler(officeServices),
            }),
        claude: preview
          ? { ...previewExecutor, provider: 'claude' }
          : new ClaudeExecutor(() => team.snapshot().settings.claudeEnabled),
        antigravity: preview
          ? { ...previewExecutor, provider: 'antigravity' }
          : new AntigravityExecutor(
              executionDirectory,
              () => team.snapshot().settings.antigravityEnabled === true,
            ),
      },
      path.join(localRuntime, 'team-settings.json'),
      new TeamOfficeBridge(store, runtime),
      pixelOfficeChecks(process.cwd()),
      undefined,
      path.join(localRuntime, 'team-checkpoint.json'),
      new AdaptiveRuntime(
        new UsageHistory(path.join(adaptiveState, 'usage-history.json')),
        path.join(adaptiveState, 'task-artifacts'),
      ),
      new ConversationLibrary(path.join(adaptiveState, 'library')),
      officeServices,
    );
    console.log(`[Pixel Agents] Enabled providers: ${providers.map((p) => p.id).join(', ')}`);

    // Wire hook events: HTTP POST -> runtime -> hookEventHandler -> agents
    server.onHookEvent((providerId, event) => {
      runtime.handleHookEvent(providerId, event);
    });

    // Installs/uninstalls every provider's hooks together. Claude and Hermes each
    // need a file copied into place first (compiled hook script / plugin source);
    // Codex has nothing to copy -- installHooks() just starts its in-process
    // JSONL tailer. A failure in one provider's install is logged and does not
    // block the others (graceful degradation: one broken provider can't take
    // down hook delivery for the rest).
    const installAllHooks = async (serverUrl: string, authToken: string): Promise<void> => {
      if (preview) return;
      if (args.providers.includes('claude')) {
        const copied = copyHookScript(packageRoot);
        try {
          await claudeProvider.installHooks(serverUrl, authToken);
          console.log(
            copied
              ? '[Pixel Agents] Claude hooks installed'
              : '[Pixel Agents] Claude hooks NOT installed, hook script missing',
          );
        } catch (err) {
          console.error('[Pixel Agents] Failed to install Claude hooks:', err);
        }
      }
      if (args.providers.includes('hermes')) {
        try {
          const pluginCopied = copyHermesPlugin(packageRoot);
          await hermesProvider.installHooks(serverUrl, authToken);
          console.log(
            pluginCopied
              ? '[Pixel Agents] Hermes plugin installed (applies to Hermes sessions started from now on -- see README for the already-running-session limitation)'
              : '[Pixel Agents] Hermes plugin NOT installed, plugin source missing',
          );
        } catch (err) {
          console.error('[Pixel Agents] Failed to install Hermes plugin:', err);
        }
      }
      if (args.providers.includes('codex')) {
        try {
          await codexProvider.installHooks(serverUrl, authToken);
          console.log('[Pixel Agents] Codex JSONL tailer started');
        } catch (err) {
          console.error('[Pixel Agents] Failed to start Codex tailer:', err);
        }
      }
      if (args.providers.includes('antigravity')) {
        try {
          await antigravityProvider.installHooks(serverUrl, authToken);
          console.log('[Pixel Agents] Antigravity JSONL tailer started');
        } catch (err) {
          console.error('[Pixel Agents] Failed to start Antigravity tailer:', err);
        }
      }
    };

    const uninstallAllHooks = async (): Promise<void> => {
      if (preview) return;
      await Promise.all(
        providers.map((provider) =>
          provider
            .uninstallHooks()
            .catch((err) =>
              console.error(`[Pixel Agents] Failed to uninstall ${provider.id} hooks:`, err),
            ),
        ),
      );
      console.log('[Pixel Agents] Hooks uninstalled');
    };

    // onSetHooksEnabled side effect: install/uninstall hooks when user toggles in UI.
    // Captures config from the outer scope after server.start().
    let currentConfig: { port: number; token: string } | null = null;
    const onSetHooksEnabled = async (enabled: boolean): Promise<void> => {
      if (!currentConfig) return;
      if (enabled) {
        await installAllHooks(`http://127.0.0.1:${currentConfig.port}`, currentConfig.token);
      } else {
        await uninstallAllHooks();
      }
    };

    // onReloadAssets side effect: re-run the shared loaders (bundled + external
    // dirs) after an external-asset-directory change, then re-broadcast the
    // updated sprites to the requesting client. Mutates the assetCache object in
    // place so already-open sockets (which captured the same reference) and
    // future webviewReady handshakes both observe the new assets. Only
    // characters/pets/furniture can come from external dirs, so only those three
    // are reloaded and re-sent (mirrors the VS Code reload path).
    const onReloadAssets: ReloadAssetsSideEffect = async (send): Promise<void> => {
      const externalDirs = readConfig().externalAssetDirectories;
      const [characters, pets, furniture] = await Promise.all([
        loadAllCharacters(distRoot, externalDirs),
        loadAllPets(distRoot, externalDirs),
        loadAllFurniture(distRoot, externalDirs),
      ]);
      assetCache.characters = characters;
      assetCache.pets = pets;
      assetCache.furniture = furniture;
      if (characters) {
        send({ type: 'characterSpritesLoaded', characters: characters.characters });
      }
      if (pets) {
        send({
          type: 'petSpritesLoaded',
          pets: pets.pets,
          petNames: pets.manifests.map((m) => m.name),
        });
      }
      if (furniture) {
        send({
          type: 'furnitureAssetsLoaded',
          catalog: furniture.catalog,
          sprites: Object.fromEntries(furniture.sprites),
        });
      }
      console.log('[Pixel Agents] Assets reloaded (external directory change)');
    };

    const config = await server.start({
      team,
      store,
      runtime,
      embedded: false,
      host: args.host,
      port: args.port,
      staticDir,
      assetCache,
      onSetHooksEnabled,
      onReloadAssets,
    });
    currentConfig = { port: config.port, token: config.token };

    // Sync runtime refs with persisted settings BEFORE first scan tick
    runtime.hooksEnabled.current = adapter.getSetting('pixel-agents.hooksEnabled', true);
    if (args.watchAllSessions !== undefined) {
      adapter.setSetting('pixel-agents.watchAllSessions', args.watchAllSessions);
    }
    runtime.watchAllSessions.current = adapter.getSetting('pixel-agents.watchAllSessions', false);

    // Install hooks on startup if the persisted setting says so
    if (runtime.hooksEnabled.current) {
      await installAllHooks(`http://127.0.0.1:${config.port}`, config.token);
    }

    // Start scanning for external sessions (Claude running in user's terminal)
    const cwd = process.cwd();
    const dirs =
      !preview && args.providers.includes('claude')
        ? claudeProvider.getSessionDirs?.(cwd)
        : undefined;
    if (dirs && dirs[0]) {
      const projectDir = dirs[0];
      console.log(`[Pixel Agents] Scanning project dir: ${projectDir}`);
      runtime.startProjectScan(projectDir);
      runtime.startExternalScanning(projectDir);
      runtime.startStaleCheck();
    }

    console.log(`\n  Pixel Agents server running at http://${args.host}:${config.port}\n`);

    // ── Graceful shutdown ──
    let shuttingDown = false;
    async function shutdown(): Promise<void> {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log('\nShutting down...');
      await team.shutdown();
      runtime.dispose();
      server.stop();
      process.exit(0);
    }

    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

// Only auto-run when this file is executed directly (`node dist/cli.js`), not
// when it's imported for its exports (e.g. `parseArgs` in tests) -- importing
// it unconditionally used to start a real server and install real Claude
// hooks as a side effect of module load.
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
