import type Redis from 'ioredis';
import { fetchWithTimeoutRetry, wrapBreaker } from '@openxiv/clients';
import { Errors, type AppResultAsync, fromPromise } from '@openxiv/shared';
import type { AppContext } from '../context.js';

/**
 * Bluesky DID resolver.
 *
 * Surface:
 *   - resolveHandle(handle)  →  { did, signingKey?, pdsEndpoint? }
 *   - resolveDid(did)        →  { signingKey?, pdsEndpoint? }
 *
 * The resolver is what makes `did:plc:*` first-class on OpenXiv. When a
 * user signs in via Bluesky we *replace* the local placeholder with
 * their real `did:plc:…`; from that point on, every read of their
 * verificationMethod can be cross-checked against the live PDS-published
 * DID Document.
 *
 * Resilience knobs:
 *   - 3s timeout per outbound HTTPS request (handle resolution and DID
 *     document fetch are independent timers).
 *   - opossum breaker, 50% over rolling window, half-open after 30s.
 *   - Redis cache `bsky:resolve:{handle}` with 5 minute TTL and ±10%
 *     jitter to spread refreshes across a Bluesky outage recovery wave.
 *   - PDS endpoint is *not* persisted on the user row — only the DID is
 *     load-bearing identity. The PDS endpoint changes when Bluesky
 *     migrates a user between shards; we refresh on a 1h cadence at
 *     read-time rather than storing a stale URL.
 *
 * Failure mode: every error returns null fields so the caller can fall
 * back to the did:web path. The caller is responsible for stamping
 * `users.did_resolution_status='fallback_web'` if it does so.
 */

const REDIS_KEY_PREFIX = 'bsky:resolve:';
const TTL_SECONDS = 5 * 60;
const TTL_JITTER = 0.1;
const HARD_TIMEOUT_MS = 3000;
const HANDLE_RESOLVE_BASE = 'https://bsky.social/xrpc/com.atproto.identity.resolveHandle';
const PLC_BASE = 'https://plc.directory';

export interface BskyDidResolution {
  did: string;
  /** Multikey (z…) public key for AT-proto rotation key. Null if PDS doc parse failed. */
  signingKey: string | null;
  /** Live PDS service endpoint. Null if missing from the DID Document. */
  pdsEndpoint: string | null;
  /** When this answer was assembled. ISO-8601. */
  observedAt: string;
  /** Whether this came from cache or live network. */
  source: 'cache' | 'live';
}

export interface BlueskyDidResolver {
  resolveHandle(handle: string): AppResultAsync<BskyDidResolution | null>;
  resolveDid(did: string): AppResultAsync<BskyDidResolution | null>;
}

export function makeBlueskyDidResolver(ctx: AppContext): BlueskyDidResolver {
  const redis = ctx.redis as Redis;

  const fetchHandle = wrapBreaker(
    {
      name: 'bsky.resolve.handle',
      timeoutMs: HARD_TIMEOUT_MS,
      errorThresholdPercent: 50,
      resetTimeoutMs: 30_000,
    },
    async (handle: string): Promise<{ did: string } | null> => {
      const url = `${HANDLE_RESOLVE_BASE}?handle=${encodeURIComponent(handle)}`;
      const res = await fetchWithTimeoutRetry(url, {
        timeoutMs: HARD_TIMEOUT_MS,
        headers: { accept: 'application/json' },
      });
      if (res.status === 400 || res.status === 404) return null;
      if (!res.ok) throw new Error(`bsky handle ${res.status}`);
      const body = (await res.json()) as { did?: string };
      return body.did ? { did: body.did } : null;
    },
  );

  const fetchDidDoc = wrapBreaker(
    {
      name: 'bsky.resolve.did',
      timeoutMs: HARD_TIMEOUT_MS,
      errorThresholdPercent: 50,
      resetTimeoutMs: 30_000,
    },
    async (did: string): Promise<DidDocSubset | null> => {
      // did:plc:* is resolved via plc.directory; did:web:* is resolved
      // via HTTPS GET to the document path. We forward did:web to its
      // canonical resolver but Bluesky's primary form is did:plc.
      if (did.startsWith('did:plc:')) {
        const url = `${PLC_BASE}/${did}`;
        const res = await fetchWithTimeoutRetry(url, {
          timeoutMs: HARD_TIMEOUT_MS,
          headers: { accept: 'application/json' },
        });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`plc ${res.status}`);
        return projectDidDoc((await res.json()) as Record<string, unknown>);
      }
      // did:web — resolve through https://<host>/<path>/did.json
      const docUrl = didWebToUrl(did);
      if (!docUrl) return null;
      const res = await fetchWithTimeoutRetry(docUrl, {
        timeoutMs: HARD_TIMEOUT_MS,
        headers: { accept: 'application/json' },
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`did:web ${res.status}`);
      return projectDidDoc((await res.json()) as Record<string, unknown>);
    },
  );

  function ttlWithJitter(): number {
    const jitter = TTL_SECONDS * TTL_JITTER * (Math.random() * 2 - 1);
    return Math.max(60, Math.floor(TTL_SECONDS + jitter));
  }

  async function readCache(handle: string): Promise<BskyDidResolution | null> {
    try {
      const raw = await redis.get(REDIS_KEY_PREFIX + handle.toLowerCase());
      if (!raw) return null;
      const parsed = JSON.parse(raw) as BskyDidResolution;
      return { ...parsed, source: 'cache' };
    } catch {
      return null;
    }
  }

  async function writeCache(handle: string, value: BskyDidResolution): Promise<void> {
    try {
      await redis.set(
        REDIS_KEY_PREFIX + handle.toLowerCase(),
        JSON.stringify({ ...value, source: 'live' }),
        'EX',
        ttlWithJitter(),
      );
    } catch {
      // best-effort cache; resolver never blocks on Redis
    }
  }

  return {
    resolveHandle(handle) {
      return fromPromise(
        (async (): Promise<BskyDidResolution | null> => {
          const cached = await readCache(handle);
          if (cached) {
            recordMetric('cached');
            return cached;
          }
          const handleResult = await fetchHandle(handle);
          if (handleResult.isErr()) {
            recordMetric('error');
            return null;
          }
          const r = handleResult.value;
          if (!r) {
            recordMetric('not_found');
            return null;
          }
          // Resolve the DID doc to get signing key + PDS endpoint.
          const docResult = await fetchDidDoc(r.did);
          const doc = docResult.isErr() ? null : docResult.value;
          const out: BskyDidResolution = {
            did: r.did,
            signingKey: doc?.signingKey ?? null,
            pdsEndpoint: doc?.pdsEndpoint ?? null,
            observedAt: new Date().toISOString(),
            source: 'live',
          };
          await writeCache(handle, out);
          recordMetric('success');
          return out;
        })(),
        (cause) => Errors.internal('bsky.resolveHandle', cause),
      );
    },
    resolveDid(did) {
      return fromPromise(
        (async (): Promise<BskyDidResolution | null> => {
          const docResult = await fetchDidDoc(did);
          if (docResult.isErr()) {
            recordMetric('error');
            return null;
          }
          const doc = docResult.value;
          if (!doc) {
            recordMetric('not_found');
            return null;
          }
          recordMetric('success');
          return {
            did,
            signingKey: doc.signingKey,
            pdsEndpoint: doc.pdsEndpoint,
            observedAt: new Date().toISOString(),
            source: 'live',
          };
        })(),
        (cause) => Errors.internal('bsky.resolveDid', cause),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// DID Document projection helpers — exported for unit tests.
// ---------------------------------------------------------------------------

export interface DidDocSubset {
  signingKey: string | null;
  pdsEndpoint: string | null;
}

export function projectDidDoc(doc: Record<string, unknown>): DidDocSubset {
  const verificationMethods = Array.isArray(doc['verificationMethod'])
    ? (doc['verificationMethod'] as Array<Record<string, unknown>>)
    : [];
  // AT-proto convention: the signing key is the verificationMethod whose
  // id ends with `#atproto`. We don't reject on alternate ids — only the
  // first matching one is taken because that's the load-bearing key.
  let signingKey: string | null = null;
  for (const vm of verificationMethods) {
    const id = typeof vm['id'] === 'string' ? (vm['id'] as string) : '';
    const multibase = typeof vm['publicKeyMultibase'] === 'string' ? (vm['publicKeyMultibase'] as string) : null;
    if (multibase && id.endsWith('#atproto')) {
      signingKey = multibase;
      break;
    }
  }
  // Fallback: take the first multibase pubkey if none matched #atproto.
  if (!signingKey) {
    for (const vm of verificationMethods) {
      const multibase = typeof vm['publicKeyMultibase'] === 'string' ? (vm['publicKeyMultibase'] as string) : null;
      if (multibase) {
        signingKey = multibase;
        break;
      }
    }
  }
  const services = Array.isArray(doc['service'])
    ? (doc['service'] as Array<Record<string, unknown>>)
    : [];
  let pdsEndpoint: string | null = null;
  for (const s of services) {
    const id = typeof s['id'] === 'string' ? (s['id'] as string) : '';
    const type = typeof s['type'] === 'string' ? (s['type'] as string) : '';
    const ep = typeof s['serviceEndpoint'] === 'string' ? (s['serviceEndpoint'] as string) : null;
    if (ep && (id.endsWith('#atproto_pds') || type === 'AtprotoPersonalDataServer')) {
      pdsEndpoint = ep;
      break;
    }
  }
  return { signingKey, pdsEndpoint };
}

/**
 * `did:web:host[:port][:p1:p2...]` →  `https://host[:port][/p1/p2...]/did.json`.
 * The path components are URL-encoded to keep colons/special chars safe.
 */
export function didWebToUrl(did: string): string | null {
  if (!did.startsWith('did:web:')) return null;
  const body = did.slice('did:web:'.length);
  const parts = body.split(':');
  if (parts.length === 0 || !parts[0]) return null;
  const host = decodeURIComponent(parts[0]);
  const tail = parts.slice(1).map(decodeURIComponent).filter(Boolean);
  const url = tail.length === 0
    ? `https://${host}/.well-known/did.json`
    : `https://${host}/${tail.join('/')}/did.json`;
  return url;
}

// ---------------------------------------------------------------------------
// Lightweight Prometheus-style counter. Real wiring will be added when
// the metrics server lands; until then this is a no-op that keeps the
// instrumentation site visible to readers.
// ---------------------------------------------------------------------------
type Outcome = 'success' | 'cached' | 'not_found' | 'error';
const metricCounts: Record<Outcome, number> = { success: 0, cached: 0, not_found: 0, error: 0 };

function recordMetric(outcome: Outcome): void {
  metricCounts[outcome] += 1;
}

export function snapshotMetrics(): Record<Outcome, number> {
  return { ...metricCounts };
}

export const __testing = {
  projectDidDoc,
  didWebToUrl,
  HARD_TIMEOUT_MS,
  TTL_SECONDS,
};
