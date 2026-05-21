import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyFormbody from '@fastify/formbody';
import fastifyHelmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySensible from '@fastify/sensible';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { randomToken } from '@openxiv/shared';
import type { AppContext } from './context.js';
import { authPlugin } from './plugins/auth.js';
import { errorPlugin } from './plugins/error.js';
import { registerRoutes } from './routes/index.js';
import { buildServices, type Services } from './services/index.js';
import { makeDailyBriefCron } from './services/daily-brief-cron.js';
import {
  ANALYTICS_ROLLUP_REFRESH_INTERVAL_MS,
  ANALYTICS_ROLLUP_RETAIN_COUNT,
  API_BODY_LIMIT_BYTES,
  API_CORS_MAX_AGE_SECONDS,
  API_UPLOAD_FIELD_LIMIT,
  API_UPLOAD_FILE_LIMIT,
  API_UPLOAD_FILE_LIMIT_BYTES,
  API_UPLOAD_HEADER_PAIR_LIMIT,
  API_UPLOAD_PART_LIMIT,
} from './constants/launch-policy.js';

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
    services: Services;
  }
}

export async function buildServer(ctx: AppContext): Promise<FastifyInstance> {
  const requestStartedAt = new WeakMap<object, number>();
  const app = Fastify({
    logger: {
      level: ctx.env.LOG_LEVEL,
      ...(ctx.env.NODE_ENV === 'development'
        ? {
            transport: {
              target: 'pino-pretty',
              options: { colorize: true, translateTime: 'HH:MM:ss.l' },
            },
          }
        : {}),
    },
    genReqId: () => randomToken(8),
    trustProxy: true,
    bodyLimit: API_BODY_LIMIT_BYTES,
  }).withTypeProvider<ZodTypeProvider>();

  app.addHook('onRequest', async (req) => {
    requestStartedAt.set(req, Date.now());
  });

  app.addHook('onResponse', async (req, reply) => {
    const startedAt = requestStartedAt.get(req) ?? Date.now();
    req.log.info(
      {
        request_id: req.id,
        user_did: req.session?.did ?? null,
        duration_ms: Date.now() - startedAt,
        status: reply.statusCode,
        method: req.method,
        path: req.url.split('?', 1)[0],
      },
      'request completed',
    );
  });

  app.decorate('ctx', ctx);
  app.decorate('services', buildServices(ctx, app.log));

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(fastifySensible);

  // application/x-www-form-urlencoded body parser. OAI-PMH 2.0 §3.1.1
  // MANDATES that repositories accept POST requests with form-encoded
  // bodies; without this plugin Fastify rejects them with 415 Unsupported
  // Media Type and validators (BASE, CORE) cannot harvest us. JSON routes
  // are unaffected — they keep their own content-type parser.
  await app.register(fastifyFormbody);

  await app.register(fastifyHelmet, {
    // CSP for API responses — restrictive; the API is mostly JSON, only
    // swagger-ui needs script/style. We carve those allowances per-route.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    strictTransportSecurity:
      ctx.env.NODE_ENV === 'production'
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: false }
        : false,
  });

  await app.register(fastifyCors, {
    origin: ctx.env.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'],
    maxAge: API_CORS_MAX_AGE_SECONDS,
  });
  await app.register(fastifyCookie, { secret: ctx.env.SESSION_SECRET });
  await app.register(fastifyRateLimit, {
    max: rateLimitMaxForRequest(ctx.env.RATE_LIMIT_MAX),
    timeWindow: ctx.env.RATE_LIMIT_WINDOW_MS,
    redis: ctx.redis,
    // Liveness and Prometheus scrape endpoints should
    // never be throttled — controllers and k8s poll them aggressively.
    allowList: (req) => isRateLimitBypassPath(req.url),
    keyGenerator: (req) => req.ip,
  });
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: API_UPLOAD_FILE_LIMIT_BYTES,
      files: API_UPLOAD_FILE_LIMIT,
      fields: API_UPLOAD_FIELD_LIMIT,
      headerPairs: API_UPLOAD_HEADER_PAIR_LIMIT,
      parts: API_UPLOAD_PART_LIMIT,
    },
    attachFieldsToBody: false,
  });

  await app.register(errorPlugin);
  await app.register(authPlugin);

  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'OpenXiv API',
        description: 'Science social + preprint App View on AT Protocol.',
        version: '0.1.0',
      },
      servers: [{ url: ctx.env.PUBLIC_API_BASE }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(fastifySwaggerUi, { routePrefix: '/docs' });

  await registerRoutes(app);

  // Background cron for the Daily Brief snapshot. Lives in-process so a
  // single api replica handles it (good enough for single-instance MVP).
  const cron = makeDailyBriefCron(ctx, app.services.flags);
  cron.start();
  app.addHook('onClose', async () => cron.stop());

  // Five-minute materialized analytics refresh via BullMQ. The API process
  // only schedules; the worker process owns the database-heavy refresh.
  await ctx.queues.analyticsRollup
    .add('refresh', {}, {
      jobId: 'analytics-rollup-5m',
      repeat: { every: ANALYTICS_ROLLUP_REFRESH_INTERVAL_MS },
      removeOnComplete: { count: ANALYTICS_ROLLUP_RETAIN_COUNT },
      removeOnFail: { count: ANALYTICS_ROLLUP_RETAIN_COUNT },
    })
    .catch((err: Error) => app.log.warn({ err: err.message }, 'analytics rollup schedule failed'));

  return app;
}

const HIGH_VOLUME_PUBLIC_READ_LIMIT_MAX = 600;
const RATE_LIMIT_BYPASS_PATHS = new Set(['/health', '/health/ready', '/healthz', '/metrics']);

function requestPath(url: string): string {
  return url.split('?', 1)[0] || '/';
}

function isRateLimitBypassPath(url: string): boolean {
  return RATE_LIMIT_BYPASS_PATHS.has(requestPath(url));
}

function isHighVolumePublicReadRoute(method: string, url: string): boolean {
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod !== 'GET' && normalizedMethod !== 'HEAD') return false;

  const path = requestPath(url);
  if (
    path === '/api/auth/me' ||
    path === '/api/featured' ||
    path === '/api/feed/home' ||
    path === '/api/stats' ||
    path === '/api/topics/categories'
  ) {
    return true;
  }

  return (
    path === '/api/papers' ||
    path.startsWith('/api/papers/') ||
    path.startsWith('/api/topics/') ||
    path.startsWith('/api/feed/') ||
    path.startsWith('/api/profiles/') ||
    path.startsWith('/api/daily-brief/') ||
    path.startsWith('/api/lens/')
  );
}

function rateLimitMaxForRequest(configuredMax: number) {
  return (req: FastifyRequest, _key: string): number => {
    if (isHighVolumePublicReadRoute(req.method, req.url)) {
      return Math.max(configuredMax, HIGH_VOLUME_PUBLIC_READ_LIMIT_MAX);
    }
    return configuredMax;
  };
}

export const __serverTesting = {
  isHighVolumePublicReadRoute,
  isRateLimitBypassPath,
  rateLimitMaxForRequest,
};
