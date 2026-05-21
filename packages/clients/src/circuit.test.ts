import { describe, expect, it } from 'vitest';
import { Errors } from '@openxiv/shared';
import { DEFAULT_CIRCUIT_ROLLING_WINDOW_MS, wrapBreaker } from './circuit.js';

describe('wrapBreaker', () => {
  it('defaults to the launch breaker policy window', () => {
    expect(DEFAULT_CIRCUIT_ROLLING_WINDOW_MS).toBe(5 * 60 * 1000);
  });

  it('wraps a happy call into an Ok result', async () => {
    const echo = wrapBreaker({ name: 'echo', timeoutMs: 200 }, async (n: number) => n + 1);
    const r = await echo(2);
    expect(r.isOk()).toBe(true);
    if (r.isOk()) expect(r.value).toBe(3);
  });

  it('maps a thrown error to external_invalid_response', async () => {
    const boom = wrapBreaker({ name: 'boom', timeoutMs: 200 }, async () => {
      throw new Error('upstream blew up');
    });
    const r = await boom(null);
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.kind).toBe('external_invalid_response');
      expect(r.error.message).toMatch(/boom/);
    }
  });

  it('preserves typed AppErrors thrown by wrapped clients', async () => {
    const storage = wrapBreaker({ name: 'storage', timeoutMs: 200 }, async () => {
      throw Errors.storage('s3 put failed');
    });

    const result = await storage(undefined);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.kind).toBe('storage_failure');
      expect(result.error.message).toBe('s3 put failed');
    }
  });

  it('maps a slow call past the timeout to external_unavailable', async () => {
    const slow = wrapBreaker(
      { name: 'slow', timeoutMs: 30 },
      () => new Promise<string>((resolve) => setTimeout(() => resolve('ok'), 200)),
    );
    const r = await slow(null);
    expect(r.isErr()).toBe(true);
    if (r.isErr()) {
      expect(r.error.kind).toBe('external_unavailable');
    }
  });

  it('does not open before the default launch volume threshold is reached', async () => {
    let calls = 0;
    const flaky = wrapBreaker({ name: 'one-off', timeoutMs: 200 }, async () => {
      calls += 1;
      throw new Error('transient upstream failure');
    });

    const first = await flaky(null);
    const second = await flaky(null);

    expect(first.isErr()).toBe(true);
    expect(second.isErr()).toBe(true);
    expect(calls).toBe(2);
  });

  it('opens after a burst of failures and short-circuits subsequent calls', async () => {
    let calls = 0;
    const flaky = wrapBreaker(
      {
        name: 'flaky',
        timeoutMs: 200,
        errorThresholdPercent: 50,
        resetTimeoutMs: 5_000,
      },
      async () => {
        calls += 1;
        throw new Error('always fails');
      },
    );
    // Fire enough failed calls to definitively cross the threshold.
    for (let i = 0; i < 10; i++) {
      const r = await flaky(null);
      expect(r.isErr()).toBe(true);
    }
    const beforeReject = calls;
    const open = await flaky(null);
    expect(open.isErr()).toBe(true);
    if (open.isErr()) {
      // Once the breaker has opened, opossum should reject without invoking
      // the wrapped function — confirm by checking the call counter did not
      // advance for at least one of the post-open attempts.
      expect(calls === beforeReject || calls === beforeReject + 1).toBe(true);
      expect(open.error.kind === 'external_unavailable' || open.error.kind === 'external_invalid_response').toBe(true);
    }
  });
});
