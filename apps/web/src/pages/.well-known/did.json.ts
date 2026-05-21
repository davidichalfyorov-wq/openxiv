import type { APIRoute } from 'astro';

/**
 * Org-level did:web document for OpenXiv. Resolves `did:web:openxiv.net` to
 * the App View's identity document.
 *
 * We deliberately do NOT enumerate per-user DIDs here:
 *   - Privacy: a public list of every user's DID is unbounded PII surface.
 *   - Scale: the document would grow without bound.
 *   - did:web spec compliance: per-user DIDs resolve at their own path
 *     (`/u/{provider}.{subject}/did.json`).
 *
 * The optional service signing key for the App View itself is sourced
 * from `OPENXIV_SERVICE_PUBLIC_MULTIBASE` (multibase Multikey). When the
 * env is absent the document still resolves; it just lacks a
 * verificationMethod, which is acceptable for an App View that doesn't
 * sign records (only ingests). Operator runbook: docs/ops/secrets.md.
 */
const API_BASE =
  (typeof process !== 'undefined' && process.env?.INTERNAL_API_BASE) ||
  (typeof process !== 'undefined' && process.env?.PUBLIC_API_BASE) ||
  import.meta.env.PUBLIC_API_BASE ||
  'http://localhost:4000';

export const GET: APIRoute = async () => {
  try {
    const upstream = await fetch(`${API_BASE}/.well-known/did.json`, {
      signal: AbortSignal.timeout(2000),
      headers: { accept: 'application/json' },
    });
    if (upstream.ok) {
      return new Response(await upstream.text(), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'cache-control': upstream.headers.get('cache-control') ?? 'public, max-age=300',
          'access-control-allow-origin': '*',
        },
      });
    }
  } catch {
    // Fall back to a static document below so DID resolution still works
    // during API restarts, even if it cannot expose a fresh service key.
  }

  const publicBase =
    (import.meta.env.PUBLIC_WEB_BASE as string | undefined) ?? 'https://openxiv.net';
  const fgBase =
    (import.meta.env.FEED_GENERATOR_PUBLIC_URL as string | undefined) ?? publicBase;
  const servicePubMultibase =
    (typeof process !== 'undefined' && process.env?.OPENXIV_SERVICE_PUBLIC_MULTIBASE) ||
    (import.meta.env.OPENXIV_SERVICE_PUBLIC_MULTIBASE as string | undefined) ||
    null;

  const verificationMethod: Array<Record<string, unknown>> = [];
  if (servicePubMultibase) {
    verificationMethod.push({
      id: 'did:web:openxiv.net#atproto',
      type: 'Multikey',
      controller: 'did:web:openxiv.net',
      publicKeyMultibase: servicePubMultibase,
    });
  }
  const authPath = servicePubMultibase ? ['did:web:openxiv.net#atproto'] : [];

  const doc = {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/multikey/v1',
      'https://w3id.org/security/suites/secp256k1-2019/v1',
    ],
    id: 'did:web:openxiv.net',
    alsoKnownAs: [publicBase],
    verificationMethod,
    authentication: authPath,
    assertionMethod: authPath,
    service: [
      { id: '#openxiv-app', type: 'OpenXivAppView', serviceEndpoint: publicBase },
      { id: '#openxiv-api', type: 'OpenXivApi', serviceEndpoint: publicBase },
      { id: '#bsky-fg', type: 'BskyFeedGenerator', serviceEndpoint: fgBase },
    ],
  };
  return new Response(JSON.stringify(doc, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=300',
      'access-control-allow-origin': '*',
    },
  });
};
