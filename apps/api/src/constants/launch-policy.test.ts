import { describe, expect, it } from 'vitest';
import {
  API_BODY_LIMIT_BYTES,
  API_CORS_MAX_AGE_SECONDS,
  ANALYTICS_ROLLUP_REFRESH_INTERVAL_MS,
  ANALYTICS_ROLLUP_RETAIN_COUNT,
  API_UPLOAD_FIELD_LIMIT,
  API_UPLOAD_FILE_LIMIT_BYTES,
  API_UPLOAD_FILE_LIMIT,
  API_UPLOAD_HEADER_PAIR_LIMIT,
  API_UPLOAD_PART_LIMIT,
  HEALTH_ATPROTO_PROBE_TIMEOUT_MS,
  HEALTH_GROBID_PROBE_TIMEOUT_MS,
  HEALTH_JETSTREAM_PROBE_TIMEOUT_MS,
  HEALTH_STORAGE_PRESIGN_TTL_SECONDS,
  HEALTH_WRAPPER_TIMEOUT_MS,
  MASTODON_CROSSPOST_RATE_LIMIT,
  WORKER_DEFAULT_JOB_OPTIONS,
} from './launch-policy.js';

describe('launch policy constants', () => {
  it('keeps public API request and upload limits explicit', () => {
    expect(API_BODY_LIMIT_BYTES).toBe(64 * 1024 * 1024);
    expect(API_UPLOAD_FILE_LIMIT_BYTES).toBe(100 * 1024 * 1024);
    expect(API_UPLOAD_FILE_LIMIT).toBe(2);
    expect(API_UPLOAD_FIELD_LIMIT).toBe(32);
    expect(API_UPLOAD_HEADER_PAIR_LIMIT).toBe(200);
    expect(API_UPLOAD_PART_LIMIT).toBe(64);
    expect(API_CORS_MAX_AGE_SECONDS).toBe(600);
    expect(ANALYTICS_ROLLUP_REFRESH_INTERVAL_MS).toBe(5 * 60 * 1000);
    expect(ANALYTICS_ROLLUP_RETAIN_COUNT).toBe(30);
  });

  it('keeps health probe windows named by dependency', () => {
    expect(HEALTH_WRAPPER_TIMEOUT_MS).toBe(1500);
    expect(HEALTH_STORAGE_PRESIGN_TTL_SECONDS).toBe(60);
    expect(HEALTH_GROBID_PROBE_TIMEOUT_MS).toBe(1000);
    expect(HEALTH_ATPROTO_PROBE_TIMEOUT_MS).toBe(1500);
    expect(HEALTH_JETSTREAM_PROBE_TIMEOUT_MS).toBe(1500);
  });

  it('keeps worker retry and social rate-limit policy explicit', () => {
    expect(WORKER_DEFAULT_JOB_OPTIONS).toMatchObject({
      attempts: 5,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { count: 200, age: 3_600 * 24 * 7 },
      removeOnFail: { count: 500, age: 3_600 * 24 * 30 },
    });
    expect(MASTODON_CROSSPOST_RATE_LIMIT).toEqual({ max: 300, duration: 5 * 60 * 1000 });
  });
});
