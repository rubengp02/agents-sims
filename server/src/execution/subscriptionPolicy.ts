import { ExecutionBlocked, type ModelCapability, type SubscriptionEvidence } from './types.js';

export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

// Inspect names only. Never read, print, forward or persist credential values.
const FORBIDDEN_ENV =
  /^(OPENAI_API_KEY|CODEX_API_KEY|OPENAI_BASE_URL|ANTHROPIC_.*|CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CODE_USE_.*|GOOGLE_API_KEY|GEMINI_API_KEY|AZURE_OPENAI_.*|AWS_.*|CODEX_(API_KEY|BASE_URL|AUTH_.*|ACCESS_TOKEN)|ACCESS_TOKEN)$/i;

export function assertNoPaymentEnvironment(env: NodeJS.ProcessEnv): void {
  if (Object.keys(env).some((key) => FORBIDDEN_ENV.test(key))) {
    throw new ExecutionBlocked(
      'payment_environment',
      'Hay variables de autenticación o proveedor incompatibles. No se han leído sus valores ni ejecutado la tarea.',
    );
  }
}

export function safeCliEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  assertNoPaymentEnvironment(env);
  const allowed =
    /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|PROGRAMDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|SYSTEMDRIVE|HOMEDRIVE|HOMEPATH|LANG|LC_ALL|TERM|CODEX_HOME|SSL_CERT_FILE|SSL_CERT_DIR|CODEX_CA_CERTIFICATE)$/i;
  const safe: NodeJS.ProcessEnv = {};
  for (const key of Object.keys(env)) if (allowed.test(key)) safe[key] = env[key];
  return safe;
}

export function verifySubscription(
  accountResponse: unknown,
  limitsResponse: unknown,
  modelResponse: unknown,
  now = Date.now(),
): SubscriptionEvidence {
  const response = object(accountResponse);
  const account = object(response.account);
  if (
    account.type !== 'chatgpt' ||
    response.requiresOpenaiAuth !== true ||
    !['plus', 'pro'].includes(String(account.planType))
  ) {
    throw new ExecutionBlocked(
      'subscription_unverified',
      'No se ha verificado una sesión personal ChatGPT Plus o Pro. No se permite API, Bedrock ni facturación de workspace.',
    );
  }
  const limits = object(limitsResponse);
  const buckets = Object.keys(object(limits.rateLimitsByLimitId)).length
    ? object(limits.rateLimitsByLimitId)
    : { codex: limits.rateLimits };
  if (!object(buckets.codex).primary && !object(buckets.codex).secondary) {
    throw new ExecutionBlocked(
      'quota_unknown',
      'La cuota incluida de Codex no se puede verificar.',
    );
  }
  const quota: SubscriptionEvidence['quota'] = [];
  for (const [id, raw] of Object.entries(buckets)) {
    const bucket = object(raw);
    const credits = object(bucket.credits);
    // Absence is unknown, never zero. No credit purchases/resets or paid fallback.
    if (
      credits.hasCredits !== false ||
      credits.unlimited !== false ||
      !['0', '0.0', '0.00', 0].includes(credits.balance as string | number)
    ) {
      throw new ExecutionBlocked(
        'additional_usage_unverified',
        'No se ha verificado la ausencia de créditos o consumo adicional. La ejecución queda bloqueada.',
      );
    }
    if (
      bucket.planType !== null &&
      bucket.planType !== undefined &&
      bucket.planType !== account.planType
    ) {
      throw new ExecutionBlocked(
        'plan_mismatch',
        'La cuota y la sesión no corresponden al mismo tipo de suscripción.',
      );
    }
    if (bucket.rateLimitReachedType !== null && bucket.rateLimitReachedType !== undefined) {
      throw new ExecutionBlocked(
        'quota_exhausted',
        'Límite de suscripción alcanzado. La tarea queda en pausa.',
      );
    }
    let count = 0;
    for (const key of ['primary', 'secondary']) {
      const value = bucket[key];
      if (value === null || value === undefined) continue;
      const window = object(value);
      const used = window.usedPercent;
      if (
        typeof used !== 'number' ||
        !Number.isFinite(used) ||
        used < 0 ||
        used > 100 ||
        typeof window.resetsAt !== 'number' ||
        !Number.isFinite(window.resetsAt) ||
        window.resetsAt * 1000 <= now
      ) {
        throw new ExecutionBlocked(
          'quota_unknown',
          'La información de cuota está incompleta o caducada.',
        );
      }
      if (used >= 90) {
        throw new ExecutionBlocked(
          'quota_reserve',
          'Se conserva un margen del 10% de cuota. La tarea queda en pausa para evitar alcanzar el límite.',
        );
      }
      quota.push({ id: `${id}:${key}`, usedPercent: used, resetsAt: window.resetsAt });
      count++;
    }
    if (!count)
      throw new ExecutionBlocked('quota_unknown', 'Faltan ventanas de cuota verificables.');
  }
  const data = object(modelResponse).data;
  if (
    !Array.isArray(data) ||
    (object(modelResponse).nextCursor !== null && object(modelResponse).nextCursor !== undefined)
  ) {
    throw new ExecutionBlocked(
      'catalog_unknown',
      'El catálogo de modelos no se ha podido verificar completamente.',
    );
  }
  const models: ModelCapability[] = data.flatMap((raw) => {
    const item = object(raw);
    const id = item.model ?? item.id;
    const efforts = Array.isArray(item.supportedReasoningEfforts)
      ? item.supportedReasoningEfforts
          .map((entry) => object(entry).reasoningEffort)
          .filter((entry): entry is string => typeof entry === 'string')
      : [];
    return typeof id === 'string' && efforts.length ? [{ id, efforts }] : [];
  });
  if (!models.length)
    throw new ExecutionBlocked('catalog_unknown', 'No hay modelos con razonamiento verificable.');
  return { checkedAt: now, plan: account.planType as 'plus' | 'pro', quota, models };
}

export function verifyChoice(evidence: SubscriptionEvidence, model: string, effort: string): void {
  const capability = evidence.models.find((item) => item.id === model);
  if (!capability || !capability.efforts.includes(effort)) {
    throw new ExecutionBlocked(
      'choice_unavailable',
      'El modelo o razonamiento solicitado no aparece en el catálogo de este CLI.',
    );
  }
}
