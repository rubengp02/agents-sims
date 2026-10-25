import { lookup } from 'node:dns';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';

/** Resolve and validate in the socket lookup itself, so DNS cannot rebind between checks. */
export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  // Only globally routed unicast IPv6. Deny mapped IPv4 and local/link-local addresses.
  return isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:db8:/i.test(address);
}
export const publicMcpFetch: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port && url.port !== '443') ||
    isIP(url.hostname.replace(/^\[|\]$/g, ''))
  )
    throw new Error('La conexión necesita un dominio HTTPS público sin credenciales.');
  if (input instanceof Request)
    throw new Error('La conexión no admite solicitudes preconstruidas.');
  return new Promise<Response>((resolve, reject) => {
    const headers = Object.fromEntries(new Headers(init?.headers));
    const req = request(
      url,
      {
        method: init?.method ?? 'GET',
        headers,
        signal: init?.signal ?? undefined,
        lookup: (hostname, options, callback) => {
          lookup(hostname, { all: true }, (error, addresses) => {
            if (error) return callback(error, []);
            if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
              return callback(new Error('La conexión no puede acceder a redes privadas.'), []);
            if (typeof options === 'object' && options.all) callback(null, addresses);
            else callback(null, addresses[0].address, addresses[0].family);
          });
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
          res.destroy();
          reject(new Error('La conexión no permite redirecciones.'));
          return;
        }
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(res.headers))
          if (value !== undefined)
            responseHeaders.set(key, Array.isArray(value) ? value.join(',') : value);
        resolve(
          new Response(
            res.statusCode === 204 ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>),
            { status: res.statusCode ?? 500, headers: responseHeaders },
          ),
        );
      },
    );
    req.setTimeout(30000, () => req.destroy(new Error('Connection timed out')));
    req.on('error', reject);
    if (init?.body !== undefined && init.body !== null) {
      if (typeof init.body !== 'string') {
        req.destroy(new Error('Unsupported MCP body'));
        return;
      }
      req.write(init.body);
    }
    req.end();
  });
};

/** Preflight only: native Codex owns subsequent transport and authentication. */
export async function checkPublicMcpEndpoint(url: string, signal: AbortSignal) {
  const response = await publicMcpFetch(url, { method: 'HEAD', signal });
  try {
    if (response.status === 403)
      throw new Error(
        'El proveedor ha denegado el acceso (403). No se cambiará de transporte para eludirlo.',
      );
    if (response.status >= 500)
      throw new Error('El proveedor no está disponible. Comprueba su servicio antes de conectar.');
    // 401 and 405 are normal for an unauthenticated MCP metadata request.
    // This check does not claim authentication or tool readiness.
  } finally {
    await response.body?.cancel();
  }
}
