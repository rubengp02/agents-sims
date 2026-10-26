import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

import type { ProviderInspection } from '../../../core/src/team.js';
import { type CliRuntime, stopProcess } from './cliProcess.js';
import { safeCliEnvironment } from './subscriptionPolicy.js';
import { ExecutionBlocked } from './types.js';

export interface AntigravityProbe {
  inspect(cwd?: string): Promise<ProviderInspection>;
}

export const ANTIGRAVITY_STATUS_ARGS = (command: '/usage' | '/config' | '/permissions') => [
  '--print',
  command,
  '--disable-slash-commands=false',
  '--print-timeout',
  '10s',
];

/** Metadata only. Cannot launch a prompt, login or credit operation. */
export type AntigravityMetadataRunner = (
  executable: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  cwd?: string,
) => Promise<string>;

export const runAntigravityMetadata: AntigravityMetadataRunner = (executable, args, env, cwd) => {
  if (
    !(args.length === 1 && ['--version', 'models'].includes(args[0])) &&
    !(['/usage', '/config', '/permissions'] as const).some(
      (command) => JSON.stringify(args) === JSON.stringify(ANTIGRAVITY_STATUS_ARGS(command)),
    )
  )
    return Promise.reject(
      new ExecutionBlocked(
        'antigravity_metadata_forbidden',
        'Solo se permiten las consultas oficiales de versión, catálogo, configuración y cuota.',
      ),
    );
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], {
      env: safeCliEnvironment(env),
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let failure: ExecutionBlocked | undefined;
    const stop = (code: string, message: string) => {
      if (failure) return;
      failure = new ExecutionBlocked(code, message);
      void stopProcess(child);
    };
    const timer = setTimeout(
      () => stop('antigravity_timeout', 'Antigravity no ha respondido a la consulta de metadatos.'),
      12000,
    );
    child.stdout.on('data', (chunk: Buffer) => {
      if (output.length + chunk.length > 256_000)
        stop(
          'antigravity_metadata_invalid',
          'La respuesta de metadatos no tiene un tamaño válido.',
        );
      else output += chunk.toString('utf8');
    });
    // Diagnostic text can contain account information. Never expose or persist it.
    child.stderr.on('data', () => {});
    child.on('error', () => {
      clearTimeout(timer);
      reject(
        new ExecutionBlocked('antigravity_error', 'No se puede ejecutar el CLI de Antigravity.'),
      );
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0 || signal)
        reject(
          new ExecutionBlocked(
            'antigravity_metadata_failed',
            'El CLI no ha completado la consulta de metadatos.',
          ),
        );
      else resolve(output);
    });
  });
};

/** Parse agy models: native ID, tab, display label. Never infer account entitlement. */
export function parseAvailableModels(text: string): ProviderInspection['models'] {
  const models = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim() === 'Fetching available models...') continue;
    const match = /^([a-zA-Z0-9][a-zA-Z0-9._:/-]*)\t+([^\t\x00-\x1f]{1,160})$/.exec(line.trim());
    if (!match || models.has(match[1]))
      throw new ExecutionBlocked(
        'antigravity_models_unverified',
        'El catálogo oficial está vacío, duplicado o tiene un formato no reconocido.',
      );
    models.set(match[1], match[2].trim());
  }
  if (!models.size)
    throw new ExecutionBlocked(
      'antigravity_models_unverified',
      'El CLI no ha comunicado un catálogo de modelos verificable.',
    );
  return [...models].map(([id, label]) => ({ id, label }));
}

export async function discoverAntigravity(
  env = process.env,
  runner: AntigravityMetadataRunner = runAntigravityMetadata,
): Promise<CliRuntime> {
  const safeEnv = safeCliEnvironment(env);
  const name = process.platform === 'win32' ? 'agy.exe' : 'agy';
  const candidates = new Set<string>();
  if (process.platform === 'win32' && env.LOCALAPPDATA)
    candidates.add(join(env.LOCALAPPDATA, 'agy', 'bin', name));
  const home = env.USERPROFILE ?? env.HOME;
  if (home) {
    candidates.add(join(home, '.local', 'bin', name));
    candidates.add(join(home, '.gemini', 'antigravity-cli', 'bin', name));
  }
  const pathKey = Object.keys(safeEnv).find((key) => key.toUpperCase() === 'PATH');
  for (const dir of (safeEnv[pathKey ?? 'PATH'] ?? '').split(delimiter).filter(isAbsolute))
    candidates.add(join(dir, name));
  const executable = [...candidates].find((candidate) => existsSync(candidate));
  if (!executable)
    throw new ExecutionBlocked('antigravity_missing', 'Antigravity CLI (agy) no está instalado.');
  const version = (await runner(executable, ['--version'], safeEnv)).trim();
  if (!/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version))
    throw new ExecutionBlocked(
      'antigravity_version_unverified',
      'El CLI no ha comunicado una versión válida.',
    );
  return { executable, version };
}

export async function queryAntigravityModels(
  executable: string,
  env: NodeJS.ProcessEnv,
  runner: AntigravityMetadataRunner = runAntigravityMetadata,
): Promise<ProviderInspection['models']> {
  return parseAvailableModels(await runner(executable, ['models'], safeCliEnvironment(env)));
}

export class LocalAntigravityProbe implements AntigravityProbe {
  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly runner: AntigravityMetadataRunner = runAntigravityMetadata,
  ) {}

  async inspect(cwd?: string): Promise<ProviderInspection> {
    const runner: AntigravityMetadataRunner = (executable, args, env) =>
      this.runner(executable, args, env, cwd);
    const runtime = await discoverAntigravity(this.env, runner);
    const checks: ProviderInspection['checks'] = [
      { id: 'cli', state: 'verified', message: 'CLI instalado y versión consultada.' },
    ];
    let models: ProviderInspection['models'] = [];
    try {
      models = await queryAntigravityModels(runtime.executable, this.env, runner);
      checks.push({
        id: 'models',
        state: 'verified',
        message: 'Catálogo consultado con agy models; no acredita acceso a inferencia.',
      });
    } catch {
      checks.push({
        id: 'models',
        state: 'unverified',
        message:
          'El CLI no ha comunicado un catálogo verificable. No se utiliza una lista de sustitución.',
      });
    }
    let includedUsage: ProviderInspection['includedUsage'] = {
      verified: false,
      creditsEnabled: null,
      windows: [],
    };
    try {
      parseAntigravityConfig(
        await runner(
          runtime.executable,
          ANTIGRAVITY_STATUS_ARGS('/config'),
          safeCliEnvironment(this.env),
        ),
      );
      const windows = parseAntigravityQuota(
        await runner(
          runtime.executable,
          ANTIGRAVITY_STATUS_ARGS('/usage'),
          safeCliEnvironment(this.env),
        ),
      );
      includedUsage = { verified: true, creditsEnabled: false, windows };
    } catch {
      /* Keep every absent financial fact unknown. */
    }
    checks.push(
      {
        id: 'subscription',
        state: includedUsage.verified ? 'verified' : 'unverified',
        message: includedUsage.verified
          ? 'Cuota de la sesión Google y créditos adicionales desactivados comprobados con el CLI. No se infiere el nombre del plan.'
          : 'Consumo incluido sin verificar mediante el CLI oficial.',
      },
      {
        id: 'quota',
        state: includedUsage.verified ? 'verified' : 'unverified',
        message: includedUsage.verified
          ? 'Ventanas de cuota actuales comunicadas por /usage.'
          : 'Cuota incluida y ausencia de consumo adicional sin verificar. No se iniciarán tareas.',
      },
      {
        id: 'permissions',
        state: 'unverified',
        message:
          'Cada encargo prepara un guardián privado: solo las herramientas mediadas por la oficina pueden actuar. No se heredan permisos ilimitados.',
      },
      {
        id: 'tools',
        state: 'unverified',
        message:
          'MCP de la oficina preparado por encargo. Cada conexión se comprueba cuando se utiliza.',
      },
      {
        id: 'images',
        state: 'unverified',
        message:
          'Imágenes reales mediante attachment_read. La inspección se acredita durante cada ejecución, sin sustituir la imagen por texto.',
      },
      {
        id: 'chief-session',
        state: 'unverified',
        message:
          'El Jefe conserva su identificador dentro del objetivo. Aplicar ahora en oficina interrumpe y reorganiza; no usa redirección nativa de Codex.',
      },
      {
        id: 'execution',
        state: 'unverified',
        message:
          'Presupuesto, cancelación y recibo final verificados por el adaptador. El éxito del objetivo requiere además pruebas y revisión.',
      },
    );
    return { checkedAt: Date.now(), cliVersion: runtime.version, models, checks, includedUsage };
  }
}

/** Official text reports have a fixed tabular shape. Unknown is never zero. */
export function parseAntigravityConfig(text: string): Record<string, string> {
  const selected: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const parts = line.split('\t');
    if (
      !['useG1Credits', 'modelProvider', 'toolPermission', 'allowNonWorkspaceAccess'].includes(
        parts[0],
      )
    )
      continue;
    if (parts.length !== 2 || Object.hasOwn(selected, parts[0]))
      throw new ExecutionBlocked(
        'antigravity_config_unverified',
        'La configuración oficial es ambigua.',
      );
    selected[parts[0]] = parts[1].trim();
  }
  if (selected.useG1Credits !== 'false' || selected.modelProvider !== '')
    throw new ExecutionBlocked(
      'antigravity_billing_unverified',
      'Antigravity no acredita el proveedor oficial con créditos adicionales desactivados.',
    );
  if (
    !['request-review', ''].includes(selected.toolPermission) ||
    selected.allowNonWorkspaceAccess !== 'false'
  )
    throw new ExecutionBlocked(
      'antigravity_permissions_unverified',
      'La configuración general necesita mantener revisión y acceso externo desactivado.',
    );
  return selected;
}

export function parseAntigravityQuota(
  text: string,
  now = Date.now(),
): NonNullable<ProviderInspection['includedUsage']>['windows'] {
  const windows: NonNullable<ProviderInspection['includedUsage']>['windows'] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/).filter((line) => line.trim())) {
    const [group, label, remaining, reset, ...other] = line.split('\t');
    const id = group + ':' + label;
    const match = /^(100|[0-9]{1,2})(?:\.([0-9]+))?%$/.exec(remaining ?? '');
    const resetsAt = Date.parse(reset ?? '');
    if (
      other.length ||
      !group ||
      !/^(Weekly|Five Hour) Limit Remaining$/.test(label ?? '') ||
      !match ||
      seen.has(id) ||
      !Number.isFinite(resetsAt) ||
      resetsAt <= now
    )
      throw new ExecutionBlocked(
        'antigravity_quota_unverified',
        'La cuota está vacía, caducada o tiene un formato no reconocido.',
      );
    const usedPercent = 100 - Number(remaining.slice(0, -1));
    if (usedPercent < 0 || usedPercent > 100)
      throw new ExecutionBlocked('antigravity_quota_unverified', 'Porcentaje de cuota no válido.');
    seen.add(id);
    windows.push({ id, usedPercent, resetsAt: Math.floor(resetsAt / 1000) });
  }
  const groups = new Set(windows.map((window) => window.id.split(':')[0]));
  if (
    !groups.size ||
    [...groups].some(
      (group) =>
        !seen.has(group + ':Weekly Limit Remaining') ||
        !seen.has(group + ':Five Hour Limit Remaining'),
    )
  )
    throw new ExecutionBlocked(
      'antigravity_quota_unverified',
      'Faltan ventanas de cuota actuales.',
    );
  return windows;
}
