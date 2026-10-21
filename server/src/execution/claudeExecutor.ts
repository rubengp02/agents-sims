import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

import { object, safeCliEnvironment } from './subscriptionPolicy.js';
import {
  type ExecuteOptions,
  ExecutionBlocked,
  type OfficialExecutor,
  type RunRecord,
  type SubscriptionEvidence,
} from './types.js';

export interface ClaudeProbe {
  status(): Promise<unknown>;
}

/** Only the official native executable is inspected; never read auth/keychain files. */
export class LocalClaudeProbe implements ClaudeProbe {
  async status(): Promise<unknown> {
    const env = safeCliEnvironment(process.env);
    const name = process.platform === 'win32' ? 'claude.exe' : 'claude';
    const home = env.USERPROFILE ?? env.HOME;
    const candidates = [
      ...(home ? [join(home, '.local', 'bin', name)] : []),
      ...(env.PATH ?? env.Path ?? '')
        .split(delimiter)
        .filter(isAbsolute)
        .map((dir) => join(dir, name)),
    ];
    const executable = candidates.find((file) => existsSync(file));
    if (!executable)
      throw new ExecutionBlocked(
        'claude_missing',
        'Claude Code no está instalado. Sigue desactivado.',
      );
    return new Promise((resolve, reject) => {
      const child = spawn(executable, ['auth', 'status'], {
        env,
        windowsHide: true,
        stdio: 'pipe',
      });
      let output = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(
          new ExecutionBlocked('claude_status_unknown', 'Claude no ha respondido al diagnóstico.'),
        );
      }, 5000);
      child.stdout.on('data', (chunk) => {
        if (output.length < 64_000) output += chunk.toString();
        else child.kill();
      });
      child.stderr.on('data', () => {});
      child.on('error', () => {
        clearTimeout(timer);
        reject(new ExecutionBlocked('claude_status_unknown', 'No se puede comprobar Claude.'));
      });
      child.on('close', () => {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(output));
        } catch {
          reject(
            new ExecutionBlocked(
              'claude_status_unknown',
              'Claude no ha comunicado un estado verificable.',
            ),
          );
        }
      });
      child.stdin.end();
    });
  }
}

/** No paid inference is attempted to discover eligibility. Unknown means blocked. */
export class ClaudeExecutor implements OfficialExecutor {
  readonly provider = 'claude' as const;
  constructor(
    private readonly enabled: () => boolean,
    private readonly probe: ClaudeProbe = new LocalClaudeProbe(),
  ) {}

  async diagnose(): Promise<SubscriptionEvidence> {
    if (!this.enabled()) throw new ExecutionBlocked('claude_disabled', 'Claude está desactivado.');
    const status = object(await this.probe.status());
    if (
      status.loggedIn !== true ||
      status.authMethod !== 'claude.ai' ||
      status.apiProvider !== 'firstParty' ||
      !['pro', 'max'].includes(String(status.subscriptionType))
    )
      throw new ExecutionBlocked(
        'claude_subscription_unverified',
        'No se ha verificado una sesión personal de Claude. No se permite API.',
      );
    // auth status does not document a pre-inference proof that usage credits are off.
    // Never invent a field or accept a UI checkbox as financial verification.
    throw new ExecutionBlocked(
      'claude_additional_usage_unverified',
      'Sesión de Claude detectada, pero su CLI no permite verificar previamente que el consumo adicional esté desactivado. Ejecución bloqueada.',
    );
  }

  async execute(_options: ExecuteOptions): Promise<RunRecord> {
    await this.diagnose();
    throw new ExecutionBlocked(
      'claude_additional_usage_unverified',
      'La ejecución de Claude sigue bloqueada.',
    );
  }
}
