import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HTTP_ATTEMPTS,
  DEFAULT_HTTP_BACKOFF_MS,
  DEFAULT_HTTP_RETRY_STATUSES,
  DEFAULT_HTTP_TIMEOUT_MS,
} from './http.js';

describe('HTTP retry defaults', () => {
  it('exports the launch timeout and retry policy as named constants', () => {
    expect(DEFAULT_HTTP_TIMEOUT_MS).toBe(10_000);
    expect(DEFAULT_HTTP_ATTEMPTS).toBe(3);
    expect(DEFAULT_HTTP_BACKOFF_MS).toBe(250);
    expect(DEFAULT_HTTP_RETRY_STATUSES).toEqual([408, 409, 425, 429, 500, 502, 503, 504]);
  });
});
