import type Redis from 'ioredis';
import type { AppContext } from '../context.js';

/**
 * Feature-flag service.
 *
 * Resolution order (highest first):
 *   1. Env override: `OPENXIV_FLAG_<KEY_UPPERCASE>` = `true|false|1|0|on|off`.
 *      Lets ops kill a feature without DB access. Wins over Redis.
 *   2. Redis hash `openxiv:flags` keyed by the flag name. Set/unset at
 *      runtime via admin endpoints.
 *   3. `defaultValue` passed by the caller. Each call-site declares its
 *      own conservative default — usually `false` for in-development work.
 *
 * Reads are cached in-process for 30s. That bound keeps Redis traffic flat
 * on a hot endpoint and gives ops a known recovery window after flipping
 * a flag — long enough to amortise, short enough to feel responsive.
 *
 * Failure mode: any Redis error short-circuits to the default. We never
 * 500 a request because of an unreachable flag store.
 */
export interface FlagsService {
  isEnabled(key: string, defaultValue?: boolean): Promise<boolean>;
  /** Set a flag at runtime. Admin-only callers. Returns the resolved value. */
  set(key: string, value: boolean): Promise<boolean>;
  /** Clear an override — falls back to env/default. */
  clear(key: string): Promise<void>;
  /** Snapshot all flag entries currently in Redis. Diagnostic only. */
  snapshot(): Promise<Record<string, boolean>>;
}

const CACHE_TTL_MS = 30_000;
const REDIS_KEY = 'openxiv:flags';

interface CacheEntry {
  value: boolean;
  expiresAt: number;
}

export function makeFlagsService(ctx: AppContext): FlagsService {
  const redis = ctx.redis as Redis;
  const cache = new Map<string, CacheEntry>();

  function envOverride(key: string): boolean | null {
    const envKey = `OPENXIV_FLAG_${key.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
    const raw = process.env[envKey];
    if (raw === undefined) return null;
    const lower = raw.toLowerCase();
    if (lower === 'true' || lower === '1' || lower === 'on') return true;
    if (lower === 'false' || lower === '0' || lower === 'off') return false;
    return null;
  }

  return {
    async isEnabled(key, defaultValue = false) {
      // Env wins. Env reads are sync + cheap; do them every call so a `kill
      // -HUP`-style reload picks up changes without flushing the cache.
      const env = envOverride(key);
      if (env !== null) return env;

      const now = Date.now();
      const hit = cache.get(key);
      if (hit && hit.expiresAt > now) return hit.value;

      try {
        const raw = await redis.hget(REDIS_KEY, key);
        if (raw === null) {
          // No stored override — fall back to the caller-supplied default.
          // We deliberately do NOT cache "absence" because different call
          // sites may pass different defaults; caching one would poison the
          // others. The Redis HGET is cheap enough to take every time when
          // nothing's stored.
          return defaultValue;
        }
        const value = raw === '1' || raw === 'true';
        cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
        return value;
      } catch {
        return defaultValue;
      }
    },
    async set(key, value) {
      try {
        await redis.hset(REDIS_KEY, key, value ? '1' : '0');
        cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
        return value;
      } catch {
        return value;
      }
    },
    async clear(key) {
      try {
        await redis.hdel(REDIS_KEY, key);
        cache.delete(key);
      } catch {
        // best-effort
      }
    },
    async snapshot() {
      try {
        const raw = (await redis.hgetall(REDIS_KEY)) as Record<string, string>;
        const out: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(raw)) {
          out[k] = v === '1' || v === 'true';
        }
        return out;
      } catch {
        return {};
      }
    },
  };
}

/**
 * Canonical flag names. New code should reference these constants, never the
 * raw string — typos at the call-site become silent "always default" bugs
 * otherwise.
 */
export const FLAGS = {
  EVENT_TRACKING: 'event_tracking',
  OPENXIV_LENS: 'openxiv_lens',
  FEATURED: 'featured',
  DAILY_BRIEF: 'daily_brief',
  PROFILE_SEO: 'profile_seo',
  PROFILE_MODES: 'profile_modes',
  PROFILE_CARDS: 'profile_cards',
  // Bluesky-specific flags. Each gates exactly the path it names so an
  // outage of one (e.g. jetstream) doesn't take down adjacent paths
  // (e.g. bridge writes).
  BLUESKY_BRIDGE: 'bluesky_bridge',
  BLUESKY_JETSTREAM: 'bluesky_jetstream',
  BLUESKY_FOLLOWS: 'bluesky_follows',
  BLUESKY_LABELER: 'bluesky_labeler',
  // Aliases callable by uppercase const name — these match the Phase 5
  // goal doc verbatim so an operator typing the env override
  // `OPENXIV_FLAG_BSKY_BRIDGE=1` gets the canonical key. The string
  // values map to the same redis key as the lowercase form above to
  // avoid two-key drift.
  PROFILES_V2: 'profile_modes',
  BLUESKY_OAUTH_REAL: 'bluesky_oauth_real',
  BSKY_BRIDGE: 'bluesky_bridge',
  JETSTREAM: 'bluesky_jetstream',
  LABELER: 'bluesky_labeler',
  STARTER_PACK: 'bluesky_starter_pack',
  // Phase 6 — external enrichment + moderation surfaces.
  OPENALEX_ENRICH: 'openalex_enrich',
  ROR_AUTOCOMPLETE: 'ror_autocomplete',
  ZOTERO_IMPORT: 'zotero_import',
  OZONE_LABELS: 'ozone_labels',
  CREDIT_ROLES: 'credit_roles',
  ARTIFACT_PASSPORT: 'artifact_passport',
  MODERATOR_EDIT: 'moderator_edit',
  MULTI_CATEGORY: 'multi_category',
  ISSN_DISPLAY: 'issn_display',
  // Crossref export + Scholar-CI + bull-board live for completeness;
  // their string keys match how the goal doc names them.
  SCHOLAR_CI: 'scholar_ci',
  LEX_CODEGEN: 'lex_codegen',
  BULL_BOARD: 'bull_board',
  ERROR_TRACKING: 'error_tracking',
  // Phase 7 (Profile system) — DID/identity safety net flags. All
  // default *true*; ops toggles them off independently if a sub-system
  // is suspect. Documented in docs/ops/feature-flags.md.
  PROFILE_USE_CANONICAL_DID: 'profile_use_canonical_did',
  PROFILE_DID_WEB_RESOLUTION_ENABLED: 'profile_did_web_resolution_enabled',
  PROFILE_LEGACY_LOCAL_FALLBACK_ENABLED: 'profile_legacy_local_fallback_enabled',
  PROFILE_BLUESKY_DID_PLC_ENABLED: 'profile_bluesky_did_plc_enabled',
  PROFILE_SECP256K1_KEYS_ENABLED: 'profile_secp256k1_keys_enabled',
  PROFILE_RESERVED_HANDLES_ENFORCED: 'profile_reserved_handles_enforced',
  PROFILE_IMPERSONATION_CHECK_ENABLED: 'profile_impersonation_check_enabled',
  ACCOUNT_LINKING_ENABLED: 'account_linking_enabled',
  LEGACY_UNPREFIXED_MOUNT_ENABLED: 'legacy_unprefixed_mount_enabled',
} as const;

export type FlagKey = (typeof FLAGS)[keyof typeof FLAGS];

/**
 * Convenience: read a single flag with a default, caller passes the AppContext
 * instead of a FlagsService instance. Useful inside services that don't take
 * the service registry on construction (e.g. saga handlers).
 */
export async function isFeatureEnabled(
  ctx: AppContext,
  key: string,
  defaultValue = false,
): Promise<boolean> {
  return makeFlagsService(ctx).isEnabled(key, defaultValue);
}
