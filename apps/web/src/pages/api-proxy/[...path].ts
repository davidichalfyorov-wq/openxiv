import type { APIRoute } from 'astro';

type RequestInitWithDuplex = RequestInit & { duplex?: 'half' };

// `process.env` (runtime) so the docker image can be rebuilt once and respect
// INTERNAL_API_BASE injected by docker-compose at container start.
const API_BASE =
  (typeof process !== 'undefined' && process.env?.INTERNAL_API_BASE) ||
  (typeof process !== 'undefined' && process.env?.PUBLIC_API_BASE) ||
  import.meta.env.PUBLIC_API_BASE ||
  'http://localhost:4000';

/**
 * Catch-all proxy: browser → /api-proxy/{path} → API at INTERNAL_API_BASE.
 * Cookies stay on the web origin (same-site lax just works), and the API never
 * has to deal with CORS for browser requests.
 *
 * The forwarded path is always /api/{path} on the upstream — the API no
 * longer exposes a bare unprefixed surface (Phase 7 of the profile-system
 * rollout flipped LEGACY_UNPREFIXED_MOUNT to off). If callers need to
 * reach an infra-level route (healthz, oai-pmh, xrpc, did.json), they do
 * that against the API directly, not through this proxy.
 */
const handler: APIRoute = async ({ request, params }) => {
  const segments = (params.path ?? '') as string | string[];
  const path = Array.isArray(segments) ? segments.join('/') : segments;
  const url = new URL(request.url);
  // Always prepend /api so the upstream hits the canonical mount.
  const target = `${API_BASE}/api/${path}${url.search}`;

  const init: RequestInitWithDuplex = {
    method: request.method,
    headers: forwardHeaders(request.headers),
    redirect: 'manual',
  };
  if (!['GET', 'HEAD'].includes(request.method)) {
    init.body = request.body;
    init.duplex = 'half';
  }

  const apiRes = await fetch(target, init);
  const out = new Headers();
  apiRes.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'content-encoding') return;
    if (key.toLowerCase() === 'transfer-encoding') return;
    out.append(key, value);
  });
  // Preserve set-cookie list as separate headers
  const setCookies = apiRes.headers.getSetCookie?.() ?? [];
  if (setCookies.length > 0) {
    out.delete('set-cookie');
    for (const sc of setCookies) out.append('set-cookie', sc);
  }

  return new Response(apiRes.body, {
    status: apiRes.status,
    statusText: apiRes.statusText,
    headers: out,
  });
};

function forwardHeaders(src: Headers): Headers {
  const out = new Headers();
  src.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === 'host' || lower === 'content-length' || lower === 'connection') return;
    out.append(key, value);
  });
  return out;
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
