import type { APIRoute } from 'astro';

/**
 * Public Bluesky OAuth client metadata document. AT-proto OAuth requires
 * production clients to publish a JSON document at the URL declared in
 * `client_id`; the Authorization Server fetches and validates it on every
 * authorize call.
 *
 * In local dev we use the loopback exception (client_id starts with
 * http://localhost), so the lib synthesises this document in-memory and the
 * endpoint serves a debug copy only. In production, set
 * BLUESKY_OAUTH_CLIENT_ID=https://openxiv.net/oauth/client-metadata.json and
 * deploy this Astro page at that exact path.
 */
export const GET: APIRoute = async () => {
  const publicBase =
    (import.meta.env.PUBLIC_WEB_BASE as string | undefined) ?? 'http://localhost:4321';
  const redirectBase =
    (import.meta.env.BLUESKY_OAUTH_REDIRECT_URI as string | undefined) ??
    'http://localhost:4000/auth/bluesky/callback';
  const clientId =
    (import.meta.env.BLUESKY_OAUTH_CLIENT_ID as string | undefined) ?? 'http://localhost';

  const isLoopback =
    clientId.startsWith('http://localhost') ||
    clientId.startsWith('http://127.0.0.1');

  const metadata: Record<string, unknown> = isLoopback
    ? {
        // Loopback exception: this document is informational only. The lib
        // doesn't fetch it — it constructs the metadata in-memory from the
        // params on the loopback client_id.
        note: 'dev loopback — the live config is synthesised by the lib',
        client_id: clientId,
        client_name: 'OpenXiv (local dev)',
        redirect_uris: [redirectBase],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: 'atproto transition:generic',
        application_type: 'web',
        token_endpoint_auth_method: 'none',
        dpop_bound_access_tokens: true,
      }
    : {
        client_id: clientId,
        client_name: 'OpenXiv',
        client_uri: publicBase,
        logo_uri: `${publicBase}/brand/logo-mark.svg`,
        tos_uri: `${publicBase}/terms`,
        policy_uri: `${publicBase}/privacy`,
        redirect_uris: [redirectBase],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: 'atproto transition:generic',
        application_type: 'web',
        token_endpoint_auth_method: 'none',
        dpop_bound_access_tokens: true,
      };

  return new Response(JSON.stringify(metadata, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      // bsky's AS caches with respect to ETag; a short max-age is fine while
      // still letting us iterate during the rollout.
      'cache-control': 'public, max-age=300',
    },
  });
};
