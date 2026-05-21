import RedisMock from 'ioredis-mock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bumpAndCheckPerUserDaily, makeLlmBudget } from './llm-budget.js';

interface MinimalEnv {
  LLM_EMBED_TOKENS_DAILY: number;
  LLM_TEXT_TOKENS_DAILY: number;
}

function fakeCtx(redis: InstanceType<typeof RedisMock>, env: MinimalEnv): {
  redis: typeof redis;
  env: MinimalEnv;
} {
  return { redis, env };
}

describe('llm-budget', () => {
  let redis: InstanceType<typeof RedisMock>;
  beforeEach(async () => {
    redis = new RedisMock();
    // RedisMock shares in-process state across instances unless flushed.
    await redis.flushall();
  });
  afterEach(async () => {
    await redis.flushall();
    await redis.quit();
  });

  it('passes when cap is 0 (disabled)', async () => {
    const budget = makeLlmBudget(
      fakeCtx(redis, { LLM_EMBED_TOKENS_DAILY: 0, LLM_TEXT_TOKENS_DAILY: 0 }) as never,
    );
    const r = await budget.consume('embed', 99_999_999);
    expect(r.isOk()).toBe(true);
  });

  it('allows calls under the cap and refuses once exceeded', async () => {
    const budget = makeLlmBudget(
      fakeCtx(redis, { LLM_EMBED_TOKENS_DAILY: 1000, LLM_TEXT_TOKENS_DAILY: 0 }) as never,
    );
    const ok1 = await budget.consume('embed', 400);
    expect(ok1.isOk()).toBe(true);
    const ok2 = await budget.consume('embed', 500);
    expect(ok2.isOk()).toBe(true);
    // 900 used; this one pushes to 1100 → over cap.
    const blocked = await budget.consume('embed', 200);
    expect(blocked.isErr()).toBe(true);
    if (blocked.isErr()) {
      expect(blocked.error.kind).toBe('rate_limited');
      expect(blocked.error.message).toMatch(/embed/);
    }
  });

  it('consumeFor estimates tokens from text and reports them', async () => {
    const budget = makeLlmBudget(
      fakeCtx(redis, { LLM_EMBED_TOKENS_DAILY: 10_000, LLM_TEXT_TOKENS_DAILY: 0 }) as never,
    );
    const r = await budget.consumeFor('embed', 'hello '.repeat(100));
    expect(r.isOk()).toBe(true);
    if (r.isOk()) {
      expect(r.value.tokens).toBeGreaterThan(0);
    }
  });

  it('keeps embed and text buckets independent', async () => {
    const budget = makeLlmBudget(
      fakeCtx(redis, { LLM_EMBED_TOKENS_DAILY: 100, LLM_TEXT_TOKENS_DAILY: 100 }) as never,
    );
    expect((await budget.consume('embed', 80)).isOk()).toBe(true);
    expect((await budget.consume('embed', 80)).isErr()).toBe(true);
    // text bucket is independent — still has full budget.
    expect((await budget.consume('text', 80)).isOk()).toBe(true);
  });

  it('used() reports cumulative spend per kind', async () => {
    const budget = makeLlmBudget(
      fakeCtx(redis, { LLM_EMBED_TOKENS_DAILY: 1_000_000, LLM_TEXT_TOKENS_DAILY: 0 }) as never,
    );
    await budget.consume('embed', 250);
    await budget.consume('embed', 50);
    expect(await budget.used('embed')).toBe(300);
    expect(await budget.used('text')).toBe(0);
  });
});

describe('bumpAndCheckPerUserDaily', () => {
  it('counts up per (scope,user,day) and disallows past cap', async () => {
    const redis = new RedisMock();
    await redis.flushall();
    const u1 = 'user-1';
    const u2 = 'user-2';
    for (let i = 1; i <= 3; i++) {
      const r = await bumpAndCheckPerUserDaily(redis as never, 'explain', u1, 3);
      expect(r.allowed).toBe(true);
      expect(r.count).toBe(i);
    }
    const blocked = await bumpAndCheckPerUserDaily(redis as never, 'explain', u1, 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.count).toBe(4);
    // Other user is unaffected.
    const otherOk = await bumpAndCheckPerUserDaily(redis as never, 'explain', u2, 3);
    expect(otherOk.allowed).toBe(true);
    expect(otherOk.count).toBe(1);
    await redis.flushall();
    await redis.quit();
  });

  it('returns allowed=true when cap is 0 (disabled)', async () => {
    const redis = new RedisMock();
    await redis.flushall();
    const r = await bumpAndCheckPerUserDaily(redis as never, 'explain', 'user', 0);
    expect(r.allowed).toBe(true);
    await redis.quit();
  });
});
