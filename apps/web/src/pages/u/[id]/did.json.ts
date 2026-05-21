import type { APIRoute } from 'astro';

/**
 * Per-user did:web resolution endpoint. The canonical DID for an ORCID or
 * Google sign-up is `did:web:openxiv.net:u:{provider}.{subject}`, which the
 * did:web spec resolves to `https://openxiv.net/u/{provider}.{subject}/did.json`.
 *
 * The document published here mirrors what the API serves at the same path,
 * but the web edge is the one external resolvers actually fetch (Caddy
 * routes `*.did.json` to the web container). The web SSR fetches the
 * authoritative document from the API on every request — the API holds
 * the user's signing-key material; the web doesn't have a DB connection.
 *
 * Failure modes:
 *   - Unknown subject  →  404
 *   - Subject shape invalid (e.g. raw DID slipped in)  →  404
 *   - API hard-down (>2s, breaker open)  →  503 + Retry-After
 *
 * Cache: 5min public + ETag derived from the pubkey suffix so the next
 * resolver fetch can revalidate cheaply.
 */
export const GET: APIRoute = async ({ params, request }) => {
  const id = params['id'];
  if (typeof id !== 'string' || id.length === 0 || id.length > 200) {
    return new Response('Not Found', { status: 404 });
  }
  // The id segment must match `{provider}.{subject}` where provider is one
  // of {orcid, google, bluesky, plc}. Anything else is a probe — refuse.
  const match = /^(orcid|google|bluesky|plc)\.[A-Za-z0-9._-]{1,160}$/.exec(id);
  if (!match) {
    return new Response('Not Found', { status: 404 });
  }

  const apiBase =
    (import.meta.env.PUBLIC_API_BASE as string | undefined) ?? 'http://api:4000';
  const upstream = `${apiBase}/u/${encodeURIComponent(id)}/did.json`;
  let upstreamResp: Response;
  try {
    // 2s hard timeout — matches the API-side budget so the resolver can't
    // tie up a web worker beyond the API's own SLO.
    upstreamResp = await fetch(upstream, {
      signal: AbortSignal.timeout(2000),
      headers: { accept: 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ kind: 'unavailable' }), {
      status: 503,
      headers: { 'content-type': 'application/json', 'retry-after': '5' },
    });
  }
  if (upstreamResp.status === 301) {
    // The user has linked Bluesky and their primary is now did:plc:* — let
    // the resolver follow to plc.directory rather than 301-chaining via the
    // web edge.
    const target = upstreamResp.headers.get('location');
    return new Response(JSON.stringify({ redirectTo: target }), {
      status: 301,
      headers: {
        'content-type': 'application/json',
        ...(target ? { location: target } : {}),
      },
    });
  }
  if (upstreamResp.status === 404) {
    return new Response('Not Found', { status: 404 });
  }
  if (!upstreamResp.ok) {
    return new Response(JSON.stringify({ kind: 'unavailable' }), {
      status: 503,
      headers: { 'content-type': 'application/json', 'retry-after': '5' },
    });
  }
  const body = await upstreamResp.text();
  const etag = upstreamResp.headers.get('etag');
  if (etag && request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304 });
  }
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=300',
      ...(etag ? { etag } : {}),
      'access-control-allow-origin': '*',
    },
  });
};

