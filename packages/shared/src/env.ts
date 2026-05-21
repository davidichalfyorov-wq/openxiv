import { z } from 'zod';

/**
 * Centralised env schema. Validated once at app start so missing/misshaped
 * config fails fast instead of leaking into request paths.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_PORT: z.coerce.number().int().positive().default(4321),
  PUBLIC_API_BASE: z.string().url().default('http://localhost:4000'),
  PUBLIC_WEB_BASE: z.string().url().default('http://localhost:4321'),

  USE_MOCK_CLIENTS: z
    .union([z.boolean(), z.string()])
    .transform((v) => v === true || v === 'true')
    .default(false),
  USE_MOCK_LLM: z
    .union([z.boolean(), z.string()])
    .transform((v) => v === true || v === 'true')
    .default(false),
  USE_MOCK_GROBID: z
    .union([z.boolean(), z.string()])
    .transform((v) => v === true || v === 'true')
    .default(false),
  USE_MOCK_TECTONIC: z
    .union([z.boolean(), z.string()])
    .transform((v) => v === true || v === 'true')
    .default(false),
  USE_MOCK_LATEXML: z
    .union([z.boolean(), z.string()])
    .transform((v) => v === true || v === 'true')
    .default(false),
  USE_MOCK_DETECTOR: z
    .union([z.boolean(), z.string()])
    .transform((v) => v === true || v === 'true')
    .default(false),
  USE_MOCK_ORCID: z
    .union([z.boolean(), z.string()])
    .transform((v) => v === true || v === 'true')
    .default(false),
  USE_MOCK_BLUESKY: z
    .union([z.boolean(), z.string()])
    .transform((v) => v === true || v === 'true')
    .default(false),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  S3_ENDPOINT: z.string().url(),
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('auto'),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .union([z.boolean(), z.string()])
    .transform((v) => v === true || v === 'true')
    .default(true),

  ORCID_CLIENT_ID: z.string().default(''),
  ORCID_CLIENT_SECRET: z.string().default(''),
  ORCID_REDIRECT_URI: z.string().url().default('http://localhost:4000/auth/orcid/callback'),
  ORCID_USE_SANDBOX: z
    .union([z.boolean(), z.string()])
    .transform((v) => v === true || v === 'true')
    .default(true),

  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_REDIRECT_URI: z.string().url().default('http://localhost:4000/auth/google/callback'),

  BLUESKY_OAUTH_CLIENT_ID: z.string().default('http://localhost'),
  BLUESKY_OAUTH_REDIRECT_URI: z
    .string()
    .url()
    .default('http://localhost:4000/auth/bluesky/callback'),
  ATPROTO_SERVICE_URL: z.string().url().default('https://bsky.social'),
  /**
   * Jetstream WebSocket endpoint for backfill mention ingestion. Production
   * leaves the default; tests can point at a mock fixture.
   */
  JETSTREAM_URL: z
    .string()
    .url()
    .default('wss://jetstream2.us-east.bsky.network/subscribe'),
  /** did:web identifier of the feed-generator (also doubles as labeler src). */
  FEED_GENERATOR_DID: z.string().default('did:web:openxiv.net'),
  FEED_GENERATOR_PUBLIC_URL: z
    .string()
    .url()
    .default('http://localhost:4400'),

  DEEPSEEK_API_KEY: z.string().default(''),
  DEEPSEEK_BASE_URL: z.string().url().default('https://api.deepseek.com/v1'),
  DEEPSEEK_MODEL_TEXT: z.string().default('deepseek-v4-flash'),

  GEMINI_API_KEY: z.string().default(''),
  GEMINI_MODEL_TEXT: z.string().default('gemini-2.5-flash'),
  GEMINI_MODEL_EMBED: z.string().default('gemini-embedding-001'),

  GROBID_URL: z.string().url().default('http://localhost:8070'),
  TECTONIC_DOCKER_IMAGE: z.string().default('openxiv/tectonic:latest'),
  TECTONIC_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
  LATEXML_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),

  DETECTOR_GPT2_MODEL_PATH: z.string().default('models/gpt2-medium'),
  DETECTOR_BURST_WEIGHT: z.coerce.number().min(0).max(1).default(0.4),
  DETECTOR_BINOCULARS_WEIGHT: z.coerce.number().min(0).max(1).default(0.4),
  DETECTOR_STYLOMETRIC_WEIGHT: z.coerce.number().min(0).max(1).default(0.2),

  SESSION_SECRET: z.string().min(32),
  JWT_SECRET: z.string().min(32),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

  SENTRY_DSN: z.string().url().or(z.literal('')).default(''),
  SENTRY_RELEASE: z.string().default(''),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),

  /**
   * LLM cost caps. These are per-day, per-key, enforced via Redis token
   * buckets. Set to 0 to disable a particular cap (not recommended in
   * production). Defaults sized for a single-instance MVP — bump as needed.
   */
  LLM_EMBED_TOKENS_DAILY: z.coerce.number().int().min(0).default(1_000_000),
  LLM_TEXT_TOKENS_DAILY: z.coerce.number().int().min(0).default(200_000),
  /** Per-user explain calls / day. Cache hits don't count. */
  LLM_EXPLAIN_PER_USER_DAILY: z.coerce.number().int().min(0).default(30),
  /** Per-IP search calls / minute (no auth required, so IP-scoped). */
  SEARCH_RATE_PER_IP_PER_MIN: z.coerce.number().int().min(0).default(30),
  /** Search query result cache TTL (seconds). */
  SEARCH_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).default(300),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:4321')
    .transform((value) =>
      value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  ADMIN_DIDS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  /**
   * IndexNow API key (Bing + Yandex push-indexing protocol). Per spec
   * (https://www.indexnow.org/documentation): 8-128 characters, letters/
   * digits/dashes only. When empty the ping is skipped — search engines
   * still discover content via sitemap, just on their own crawl schedule.
   *
   * Ownership verification: the web layer serves `/{INDEXNOW_KEY}.txt`
   * returning the key when the URL slug equals the env value. This avoids
   * committing the key into the file tree.
   */
  INDEXNOW_KEY: z
    .string()
    .default('')
    .refine((v) => v === '' || /^[a-zA-Z0-9-]{8,128}$/.test(v), {
      message: 'INDEXNOW_KEY must be 8-128 chars of a-z, A-Z, 0-9, dash',
    }),

  SUBMIT_ALLOW_DIDS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

});

export type AppEnv = z.infer<typeof envSchema>;

/**
 * Secrets we ship as placeholders for local dev. Refusing to start in
 * production with one of these still set prevents the classic "I forgot
 * to rotate the secret" leak — a publicly known JWT secret means any
 * attacker can mint sessions.
 */
const PLACEHOLDER_SECRETS = new Set([
  'dev-session-secret-please-replace-32-chars-min',
  'dev-jwt-secret-please-replace-32-chars-min',
  'dev-session-secret-please-replace-in-prod-32+chars',
  'dev-jwt-secret-please-replace-in-prod-32+chars',
  'changeme',
  'change-me',
  'please-change-me',
]);

function isLowEntropy(secret: string): boolean {
  if (secret.length < 32) return true;
  const unique = new Set(secret).size;
  // 12 distinct characters in a 32-char string is a reasonable floor —
  // "aaaaa...32chars" or "abcabcabc..." should not pass.
  return unique < 12;
}

export function parseEnv(
  source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): AppEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const messages = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${messages}`);
  }
  const env = result.data;
  if (env.NODE_ENV === 'production') {
    const problems: string[] = [];
    for (const [name, value] of [
      ['SESSION_SECRET', env.SESSION_SECRET],
      ['JWT_SECRET', env.JWT_SECRET],
    ] as const) {
      if (PLACEHOLDER_SECRETS.has(value)) {
        problems.push(`${name}: refuses to start with placeholder secret value`);
      }
      if (isLowEntropy(value)) {
        problems.push(`${name}: low-entropy (need ≥32 chars, ≥12 unique)`);
      }
    }
    if (env.SESSION_SECRET === env.JWT_SECRET) {
      problems.push('SESSION_SECRET and JWT_SECRET must differ in production');
    }
    for (const [name, value] of [
      ['USE_MOCK_CLIENTS', env.USE_MOCK_CLIENTS],
      ['USE_MOCK_LLM', env.USE_MOCK_LLM],
      ['USE_MOCK_GROBID', env.USE_MOCK_GROBID],
      ['USE_MOCK_TECTONIC', env.USE_MOCK_TECTONIC],
      ['USE_MOCK_LATEXML', env.USE_MOCK_LATEXML],
      ['USE_MOCK_DETECTOR', env.USE_MOCK_DETECTOR],
      ['USE_MOCK_ORCID', env.USE_MOCK_ORCID],
      ['USE_MOCK_BLUESKY', env.USE_MOCK_BLUESKY],
    ] as const) {
      if (value) problems.push(`${name}: mock clients are forbidden in production`);
    }
    if (env.S3_ACCESS_KEY_ID === 'minioadmin' || env.S3_SECRET_ACCESS_KEY === 'minioadmin') {
      problems.push('S3 credentials must not use the MinIO default minioadmin value in production');
    }
    if (!env.PUBLIC_API_BASE.startsWith('https://') || !env.PUBLIC_WEB_BASE.startsWith('https://')) {
      problems.push('PUBLIC_API_BASE and PUBLIC_WEB_BASE must be HTTPS in production');
    }
    if (env.CORS_ORIGINS.length === 0 || env.CORS_ORIGINS.includes('*')) {
      problems.push('CORS_ORIGINS must be an explicit allow-list in production');
    }
    for (const origin of env.CORS_ORIGINS) {
      try {
        const parsed = new URL(origin);
        if (parsed.protocol !== 'https:') {
          problems.push(`CORS_ORIGINS entry must be HTTPS in production: ${origin}`);
        }
      } catch {
        problems.push(`CORS_ORIGINS entry is not a valid origin URL: ${origin}`);
      }
    }
    if (!env.ORCID_CLIENT_ID || !env.ORCID_CLIENT_SECRET) {
      problems.push('ORCID_CLIENT_ID and ORCID_CLIENT_SECRET are required in production');
    }
    if (env.BLUESKY_OAUTH_CLIENT_ID.startsWith('http://localhost')) {
      problems.push('BLUESKY_OAUTH_CLIENT_ID must be the production HTTPS client metadata URL');
    }
    if (!env.BLUESKY_OAUTH_REDIRECT_URI.startsWith('https://')) {
      problems.push('BLUESKY_OAUTH_REDIRECT_URI must be HTTPS in production');
    }
    if (problems.length > 0) {
      throw new Error(`Production secret hygiene check failed:\n  ${problems.join('\n  ')}`);
    }
  }
  return env;
}
