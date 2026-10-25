const sensitive =
  /password|contraseñ|passphrase|secret|cookie|authorization|api.?key|credential|token|csrf|session/i;
const hidden = '[dato privado oculto]';
export function previewUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()])
      if (sensitive.test(key)) url.searchParams.set(key, hidden);
    url.username = '';
    url.password = '';
    return url.href;
  } catch {
    return value;
  }
}
export function toolPreview(value: unknown, depth = 0): unknown {
  if (depth > 12)
    throw new Error('La operación requiere dividir sus datos para poder revisarla completa.');
  if (typeof value === 'string') {
    if (value.length > 64000)
      throw new Error('La operación requiere dividir sus datos para poder revisarla completa.');
    if (/^https?:\/\//i.test(value)) return previewUrl(value);
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => toolPreview(item, depth + 1));
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(record).map(([key, item]) => [
        key,
        sensitive.test(key) || (key === 'value' && sensitive.test(String(record.selector ?? '')))
          ? hidden
          : toolPreview(item, depth + 1),
      ]),
    );
  }
  return value;
}
export function requestBodyPreview(body: string, manualLogin: boolean): unknown {
  if (manualLogin) return '[datos del inicio de sesión manual ocultos]';
  try {
    return toolPreview(JSON.parse(body));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  if (body.includes('=')) return toolPreview(Object.fromEntries(new URLSearchParams(body)));
  // Opaque payloads can carry credentials; do not put them in a public snapshot.
  return body && /password|authorization|bearer|token|secret|credential|contraseñ/i.test(body)
    ? hidden
    : toolPreview(body);
}
