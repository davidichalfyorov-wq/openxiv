import RedisMock from 'ioredis-mock';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeFlagsService } from './flags.js';

function fakeCtx(redis: InstanceType<typeof RedisMock>): { redis: typeof redis } {
  return { redis };
}

describe('flags service', () => {
  let redis: InstanceType<typeof RedisMock>;
  beforeEach(async () => {
    redis = new RedisMock();
    await redis.flushall();
    // Wipe any pollution from previous tests' env overrides.
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('OPENXIV_FLAG_TEST_')) delete process.env[k];
    }
  });
  afterEach(async () => {
    await redis.flushall();
    await redis.quit();
  });

  it('returns defaultValue when nothing is set', async () => {
    const flags = makeFlagsService(fakeCtx(redis) as never);
    expect(await flags.isEnabled('test_x')).toBe(false);
    expect(await flags.isEnabled('test_x', true)).toBe(true);
  });

  it('round-trips a set value through Redis', async () => {
    const flags = makeFlagsService(fakeCtx(redis) as never);
    await flags.set('test_a', true);
    expect(await flags.isEnabled('test_a')).toBe(true);
    await flags.set('test_a', false);
    // Cached value updates immediately on set — no stale read.
    expect(await flags.isEnabled('test_a', true)).toBe(false);
  });

  it('clear() removes the override and falls back to default', async () => {
    const flags = makeFlagsService(fakeCtx(redis) as never);
    await flags.set('test_b', true);
    expect(await flags.isEnabled('test_b')).toBe(true);
    await flags.clear('test_b');
    expect(await flags.isEnabled('test_b', false)).toBe(false);
  });

  it('env override wins over Redis and default', async () => {
    process.env['OPENXIV_FLAG_TEST_C'] = 'true';
    const flags = makeFlagsService(fakeCtx(redis) as never);
    await flags.set('test_c', false);
    expect(await flags.isEnabled('test_c', false)).toBe(true);
    process.env['OPENXIV_FLAG_TEST_C'] = '0';
    expect(await flags.isEnabled('test_c', true)).toBe(false);
  });

  it('snapshot returns all set flags', async () => {
    const flags = makeFlagsService(fakeCtx(redis) as never);
    await flags.set('test_x', true);
    await flags.set('test_y', false);
    const snap = await flags.snapshot();
    expect(snap['test_x']).toBe(true);
    expect(snap['test_y']).toBe(false);
  });

  it('survives Redis being completely down (returns default)', async () => {
    const broken = {
      hget: async () => {
        throw new Error('redis down');
      },
      hset: async () => {
        throw new Error('redis down');
      },
      hdel: async () => {
        throw new Error('redis down');
      },
      hgetall: async () => {
        throw new Error('redis down');
      },
    };
    const flags = makeFlagsService({ redis: broken } as never);
    expect(await flags.isEnabled('test_e', true)).toBe(true);
    expect(await flags.isEnabled('test_e', false)).toBe(false);
    expect(await flags.snapshot()).toEqual({});
  });
});
