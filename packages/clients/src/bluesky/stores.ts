import type { Redis } from 'ioredis';
import type {
  NodeSavedSession,
  NodeSavedSessionStore,
  NodeSavedState,
  NodeSavedStateStore,
} from '@atproto/oauth-client-node';

/**
 * Redis-backed state store. Holds short-lived in-flight OAuth state, indexed
 * by the random `state` value generated during `client.authorize(...)`. Each
 * record carries the DPoP key (as a JWK), PKCE verifier, nonce, and the
 * caller-provided `redirectAfter` URL, so the callback handler can resume
 * exchange even across instances. The lib serialises/deserialises through
 * the `toDpopKeyStore` helper higher up; here we only see `NodeSavedState`
 * (DPoP key as JWK) — safe to JSON.stringify.
 *
 * TTL is short (default 10 min) because half-completed flows are wasted
 * memory; the user either finishes the redirect roundtrip quickly or
 * abandons it.
 */
const STATE_PREFIX = 'bsky:oauth:state:';
const SESSION_PREFIX = 'bsky:oauth:session:';
const DEFAULT_STATE_TTL_SECONDS = 600;

export interface RedisStoreConfig {
  readonly redis: Redis;
  readonly stateTtlSeconds?: number;
}

export function makeRedisStateStore({
  redis,
  stateTtlSeconds = DEFAULT_STATE_TTL_SECONDS,
}: RedisStoreConfig): NodeSavedStateStore {
  return {
    async get(key) {
      const raw = await redis.get(STATE_PREFIX + key);
      if (!raw) return undefined;
      try {
        return JSON.parse(raw) as NodeSavedState;
      } catch {
        return undefined;
      }
    },
    async set(key, value) {
      await redis.set(
        STATE_PREFIX + key,
        JSON.stringify(value),
        'EX',
        stateTtlSeconds,
      );
    },
    async del(key) {
      await redis.del(STATE_PREFIX + key);
    },
  };
}

/**
 * Redis-backed session store. The session record (tokens + DPoP key + token
 * endpoint metadata) is the "live" credential we keep across the user's
 * authenticated lifetime. The OAuth client library calls `set(...)` on every
 * successful refresh — so this is also our token-rotation persistence layer.
 *
 * No TTL: tokens are refreshed by the lib until either the user signs out
 * (`client.revoke(...)`) or the upstream PDS revokes them. A `del()` happens
 * automatically inside `signOut()`.
 *
 * Keyed by the user's DID (sub). One sign-in per DID, even across browsers.
 */
export function makeRedisSessionStore({ redis }: { redis: Redis }): NodeSavedSessionStore {
  return {
    async get(key) {
      const raw = await redis.get(SESSION_PREFIX + key);
      if (!raw) return undefined;
      try {
        return JSON.parse(raw) as NodeSavedSession;
      } catch {
        return undefined;
      }
    },
    async set(key, value) {
      await redis.set(SESSION_PREFIX + key, JSON.stringify(value));
    },
    async del(key) {
      await redis.del(SESSION_PREFIX + key);
    },
  };
}

export const __testing = { STATE_PREFIX, SESSION_PREFIX, DEFAULT_STATE_TTL_SECONDS };
