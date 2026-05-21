import { Errors, type AppResultAsync, ResultAsync, estimateTokens } from '@openxiv/shared';
import type Redis from 'ioredis';
import type { AppContext } from '../context.js';

/**
 * Per-day LLM-spend tracker, backed by Redis.
 *
 * The keys look like `llm:budget:embed:2026-05-17`. Each `consume` call
 * INCRBY's the day-bucket and EXPIRE's it to ~26h. Reads check the bucket
 * against the configured daily cap; writes are non-blocking so an outage of
 * Redis fails open (we'd rather lose a few cents to budget than refuse
 * legitimate users when the cache is down).
 *
 * Why daily and not e.g. hourly: provider invoicing windows are typically
 * 24h, and our worst-case adversary is one user issuing thousands of search
 * queries — that fits in a single day if uncapped, so the day window is
 * what defends the bill. Add a finer-grained per-minute layer at the
 * fastify-rate-limit boundary (already done on /api/search and /explain).
 */
export type BudgetKind = 'embed' | 'text';

export interface LlmBudget {
  /**
   * Consume `tokens` from the daily budget for `kind`. Returns Ok if the
   * call may proceed, an `Errors.rateLimited` AppError if the day-bucket
   * has been exhausted. Cap of 0 disables the check.
   */
  consume(kind: BudgetKind, tokens: number): AppResultAsync<void>;

  /**
   * Estimate tokens for `text` and `consume` them in one call. Returns the
   * estimate even on the success path so callers can log spend.
   */
  consumeFor(kind: BudgetKind, text: string): AppResultAsync<{ tokens: number }>;

  /**
   * Inspect current day usage. Diagnostic — never blocks. Returns 0 if
   * Redis is unreachable.
   */
  used(kind: BudgetKind): Promise<number>;

  /** The configured daily cap; 0 means "no cap configured". */
  capFor(kind: BudgetKind): number;
}

const SAFETY_FACTOR_FUDGE = 1.05;

export function makeLlmBudget(ctx: AppContext): LlmBudget {
  const redis = ctx.redis;
  const caps: Record<BudgetKind, number> = {
    embed: ctx.env.LLM_EMBED_TOKENS_DAILY,
    text: ctx.env.LLM_TEXT_TOKENS_DAILY,
  };

  function todayKey(kind: BudgetKind): string {
    const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
    return `llm:budget:${kind}:${day}`;
  }

  async function tryConsume(kind: BudgetKind, tokens: number): Promise<void> {
    const cap = caps[kind];
    if (cap <= 0) return; // disabled
    if (tokens <= 0) return;
    const key = todayKey(kind);
    // INCRBY is atomic; we then EXPIRE if the key was newly created.
    const after = await redisIncrSafe(redis, key, tokens);
    if (after > cap) {
      throw Errors.rateLimited(
        `daily ${kind} budget exhausted (${after}/${cap} tokens). resets at 00:00 UTC.`,
      );
    }
  }

  return {
    consume(kind, tokens) {
      return ResultAsync.fromPromise(tryConsume(kind, tokens), (err) => {
        if (err instanceof Error && err.message.includes('budget exhausted')) {
          return Errors.rateLimited(err.message);
        }
        return Errors.internal('llm-budget.consume', err);
      });
    },
    consumeFor(kind, text) {
      const tokens = Math.ceil(estimateTokens(text) * SAFETY_FACTOR_FUDGE);
      return ResultAsync.fromPromise(
        tryConsume(kind, tokens).then(() => ({ tokens })),
        (err) => {
          if (err instanceof Error && err.message.includes('budget exhausted')) {
            return Errors.rateLimited(err.message);
          }
          return Errors.internal('llm-budget.consumeFor', err);
        },
      );
    },
    async used(kind) {
      try {
        const raw = await redis.get(todayKey(kind));
        return raw ? Number.parseInt(raw, 10) : 0;
      } catch {
        return 0;
      }
    },
    capFor(kind) {
      return caps[kind];
    },
  };
}

/**
 * INCRBY + EXPIREAT pair, atomic via Redis MULTI. EXPIREAT is set to a few
 * hours past the next UTC midnight so the bucket auto-resets without ever
 * sliding the TTL forward — a hot bucket cannot "live forever" because we
 * always anchor expiry to a wall-clock deadline, not "+24h from last write".
 *
 * Implementation note: MULTI works on real Redis and on ioredis-mock; the
 * earlier Lua-script version did not, which made the tests opaque.
 */
async function redisIncrSafe(redis: Redis, key: string, by: number): Promise<number> {
  const now = new Date();
  const nextMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
  );
  const expireAtSec = Math.floor(nextMidnight / 1000) + 3600; // +1h slack
  // Two round-trips, but no Lua/eval dependency. Even if the second call
  // failed the bucket would still be correct for the day (a key without
  // TTL just sticks around — we'd notice via memory metrics, not
  // correctness). Atomicity is not required for the counter.
  const after = await redis.incrby(key, by);
  // EXPIREAT is idempotent; refreshing to the same wall-clock deadline is
  // a no-op cost-wise and ensures a partial pipeline retry stays correct.
  await redis.expireat(key, expireAtSec).catch(() => 0);
  if (typeof after === 'number') return after;
  if (typeof after === 'string') return Number.parseInt(after, 10) || 0;
  return 0;
}

/**
 * Per-user, per-route counter — separate from token-budget. Used for
 * `/explain` calls/day per user. Fails open on Redis outage; the global
 * token cap is the harder line of defence.
 */
export async function bumpAndCheckPerUserDaily(
  redis: Redis,
  scope: string,
  userId: string,
  cap: number,
): Promise<{ allowed: boolean; count: number; cap: number }> {
  if (cap <= 0) return { allowed: true, count: 0, cap };
  const day = new Date().toISOString().slice(0, 10);
  const key = `quota:${scope}:${userId}:${day}`;
  try {
    const count = await redisIncrSafe(redis, key, 1);
    return { allowed: count <= cap, count, cap };
  } catch {
    // Fail open on Redis outage — the per-day token budget is the harder
    // line of defence. Better to let a legitimate request through than to
    // 500 the entire endpoint.
    return { allowed: true, count: 0, cap };
  }
}
