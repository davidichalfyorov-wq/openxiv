export const API_BODY_LIMIT_BYTES = 64 * 1024 * 1024;
export const API_UPLOAD_FILE_LIMIT_BYTES = 100 * 1024 * 1024;
export const API_UPLOAD_FILE_LIMIT = 2;
export const API_UPLOAD_FIELD_LIMIT = 32;
export const API_UPLOAD_HEADER_PAIR_LIMIT = 200;
export const API_UPLOAD_PART_LIMIT = 64;
export const API_CORS_MAX_AGE_SECONDS = 600;

export const ANALYTICS_ROLLUP_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
export const ANALYTICS_ROLLUP_RETAIN_COUNT = 30;

export const HEALTH_WRAPPER_TIMEOUT_MS = 1500;
export const HEALTH_STORAGE_PRESIGN_TTL_SECONDS = 60;
export const HEALTH_GROBID_PROBE_TIMEOUT_MS = 1000;
export const HEALTH_ATPROTO_PROBE_TIMEOUT_MS = 1500;
export const HEALTH_JETSTREAM_PROBE_TIMEOUT_MS = 1500;

export const WORKER_DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 30_000 },
  removeOnComplete: { count: 200, age: 3_600 * 24 * 7 },
  removeOnFail: { count: 500, age: 3_600 * 24 * 30 },
} as const;

export const MASTODON_CROSSPOST_RATE_LIMIT = {
  max: 300,
  duration: 5 * 60 * 1000,
} as const;
