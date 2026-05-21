import { UnrecoverableError, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { AppError, Errors } from '@openxiv/shared';
import type { AppContext } from '../context.js';
import { QUEUE_NAMES } from '../context.js';
import { ANALYTICS_ROLLUP_REFRESHED_AT_KEY } from '../services/engagement-stats.js';
import { captureError } from '../services/error-tracking.js';
import { buildServices, type Services } from '../services/index.js';
import type { HtmlCompilePayload, SagaPayload } from '../services/submissions.js';
import { makeJetstreamSubscriber } from '../services/jetstream-subscriber.js';
import { makePdfFinalizeWorker } from './pdf-finalize-worker.js';
import { makePdfFiguresWorker } from './pdf-figures-worker.js';
import {
  BSKY_FOLLOW_QUEUE_RATE_LIMIT,
  processBskyFollowJob,
  type BskyFollowJobData,
} from '../services/bsky-follow-queue.js';
import { startBlueskyProfileSyncLoop } from '../services/bluesky-profile-sync-loop.js';
import {
  processMastodonCrosspostJob,
  type MastodonCrosspostJobData,
} from './mastodon-crosspost.js';
import {
  MASTODON_CROSSPOST_RATE_LIMIT,
  WORKER_DEFAULT_JOB_OPTIONS,
} from '../constants/launch-policy.js';
export { MASTODON_CROSSPOST_RATE_LIMIT } from '../constants/launch-policy.js';

export interface OpenxivWorkers {
  close(): Promise<void>;
}

const TERMINAL_KINDS = new Set([
  'validation',
  'not_found',
  'forbidden',
  'unauthorized',
  'conflict',
]);

/**
 * Re-throw the error in a form BullMQ understands. Terminal errors
 * (validation, not_found, …) should not be retried — we hand them up as
 * `UnrecoverableError` so the job goes straight to `failed` without burning
 * the retry budget. Transient errors (external timeouts, network blips) are
 * thrown as-is and BullMQ applies the per-job retry policy.
 */
export function rethrowForBullMQ(err: unknown): never {
  if (err instanceof AppError && TERMINAL_KINDS.has(err.kind)) {
    throw new UnrecoverableError(`${err.kind}: ${err.message}`);
  }
  throw err instanceof Error ? err : new Error(String(err));
}

export function socialWorkerLimiter(queueName: string):
  | typeof MASTODON_CROSSPOST_RATE_LIMIT
  | undefined {
  return queueName === QUEUE_NAMES.mastodonCrosspost ? MASTODON_CROSSPOST_RATE_LIMIT : undefined;
}

const DEAD_LETTER_QUEUES = new Set<string>(Object.values(QUEUE_NAMES));
export const WORKER_ALERTS_KEY = 'worker:alerts';

export function shouldRecordDeadLetter(input: {
  queueName: string;
  attemptsMade: number;
  attempts?: number;
  unrecoverable?: boolean;
}): boolean {
  if (!DEAD_LETTER_QUEUES.has(input.queueName)) return false;
  if (input.unrecoverable) return true;
  const attempts = Math.max(1, input.attempts ?? 1);
  return input.attemptsMade >= attempts;
}

export function startWorkers(ctx: AppContext): OpenxivWorkers {
  const services = buildServices(ctx);
  const connection: ConnectionOptions = {
    host: ctx.redis.options.host ?? 'localhost',
    port: ctx.redis.options.port ?? 6379,
  };

  const compileConcurrency = Number.parseInt(process.env['WORKER_COMPILE_CONCURRENCY'] ?? '2', 10);
  const embedConcurrency = Number.parseInt(process.env['WORKER_EMBED_CONCURRENCY'] ?? '4', 10);
  const explainConcurrency = Number.parseInt(process.env['WORKER_EXPLAIN_CONCURRENCY'] ?? '2', 10);

  const compileWorker = makeCompileWorker(services, connection, compileConcurrency);
  const htmlCompileWorker = makeHtmlCompileWorker(services, connection);
  const embedWorker = makeEmbedWorker(ctx, connection, embedConcurrency);
  const explainWorker = makeExplainWorker(services, connection, explainConcurrency);
  const pdfFinalizeConcurrency = Number.parseInt(
    process.env['WORKER_PDF_FINALIZE_CONCURRENCY'] ?? '2',
    10,
  );
  const pdfFinalizeWorker = makePdfFinalizeWorker(ctx, connection, pdfFinalizeConcurrency);
  const pdfFiguresConcurrency = Number.parseInt(
    process.env['WORKER_PDF_FIGURES_CONCURRENCY'] ?? '1',
    10,
  );
  const pdfFiguresWorker = makePdfFiguresWorker(ctx, connection, pdfFiguresConcurrency);
  const bskyFollowWorker = makeBskyFollowWorker(ctx, connection);
  const analyticsRollupWorker = makeAnalyticsRollupWorker(ctx, connection);
  const mastodonCrosspostWorker = makeMastodonCrosspostWorker(ctx, connection);
  const blueskyProfileSync = startBlueskyProfileSyncLoop(ctx);

  // Jetstream is a long-lived WebSocket consumer, not a BullMQ worker. We
  // own its lifecycle alongside the queue workers so a single SIGTERM
  // drains everything together.
  const labelerDid = ctx.env.PUBLIC_WEB_BASE
    .replace(/^https?:\/\//, 'did:web:')
    .replace(/\/$/, '');
  const jetstream = makeJetstreamSubscriber(ctx, { labelerDid });
  void jetstream.start().catch((err: Error) => {
    console.error('[jetstream] start failed:', err.message);
  });

  const all: Worker[] = [
    compileWorker,
    htmlCompileWorker,
    embedWorker,
    explainWorker,
    pdfFinalizeWorker,
    pdfFiguresWorker,
    bskyFollowWorker,
    analyticsRollupWorker,
    mastodonCrosspostWorker,
  ];
  for (const w of all) {
    w.on('failed', (job, err) => {
      ctx.redis.hincrby('worker:failed', w.name, 1).catch(() => {});
      recordDeadLetter(ctx, w.name, job, err).catch(() => {});
      // log via console; pino isn't wired in worker subprocess
      console.error(
        `[worker:${w.name}] job ${job?.id ?? '?'} failed: ${err?.message ?? err}`,
      );
    });
    w.on('error', (err) => {
      console.error(`[worker:${w.name}] worker error: ${err.message}`);
    });
  }

  return {
    async close() {
      await Promise.all([
        ...all.map((w) => w.close()),
        Promise.resolve(blueskyProfileSync.close()),
        jetstream.stop().catch(() => {}),
      ]);
    },
  };
}

async function recordDeadLetter(
  ctx: AppContext,
  queueName: string,
  job: Job | undefined,
  err: Error,
): Promise<void> {
  if (!job) return;
  if (
    !shouldRecordDeadLetter({
      queueName,
      attemptsMade: job.attemptsMade,
      attempts: job.opts.attempts,
      unrecoverable: err instanceof UnrecoverableError,
    })
  ) {
    return;
  }
  const key = `worker:dlq:${queueName}`;
  const payload = JSON.stringify({
    paper_id: paperIdFromJob(job),
    error: err.message,
    retry_count: job.attemptsMade,
    jobId: job.id ?? null,
    name: job.name,
    queueName,
    attemptsMade: job.attemptsMade,
    failedReason: err.message,
    data: job.data,
    failedAt: new Date().toISOString(),
  });
  await ctx.redis.lpush(key, payload);
  await ctx.redis.ltrim(key, 0, 499);
  await ctx.redis.lpush(WORKER_ALERTS_KEY, payload);
  await ctx.redis.ltrim(WORKER_ALERTS_KEY, 0, 499);
  captureError(err);
}

function paperIdFromJob(job: Job | undefined): string | null {
  const data = job?.data as { paperId?: unknown } | undefined;
  return typeof data?.paperId === 'string' ? data.paperId : null;
}

function makeAnalyticsRollupWorker(ctx: AppContext, connection: ConnectionOptions): Worker {
  return new Worker(
    QUEUE_NAMES.analyticsRollup,
    async () => {
      await ctx.db.pool.query('REFRESH MATERIALIZED VIEW CONCURRENTLY papers_views_hourly');
      const refreshedAt = new Date().toISOString();
      await ctx.redis.set(ANALYTICS_ROLLUP_REFRESHED_AT_KEY, refreshedAt, 'EX', 10 * 60);
      return { refreshedAt };
    },
    { connection, concurrency: 1, ...WORKER_DEFAULT_JOB_OPTIONS },
  );
}

function makeMastodonCrosspostWorker(ctx: AppContext, connection: ConnectionOptions): Worker {
  return new Worker<MastodonCrosspostJobData>(
    QUEUE_NAMES.mastodonCrosspost,
    async (job) => {
      try {
        return await processMastodonCrosspostJob(ctx, job.data);
      } catch (err) {
        rethrowForBullMQ(err);
      }
    },
    {
      connection,
      concurrency: 2,
      ...WORKER_DEFAULT_JOB_OPTIONS,
      limiter: socialWorkerLimiter(QUEUE_NAMES.mastodonCrosspost),
    },
  );
}

function makeBskyFollowWorker(ctx: AppContext, connection: ConnectionOptions): Worker {
  return new Worker<BskyFollowJobData>(
    QUEUE_NAMES.bskyFollow,
    async (job) => {
      try {
        return await processBskyFollowJob(ctx, job.data);
      } catch (err) {
        rethrowForBullMQ(err);
      }
    },
    {
      connection,
      concurrency: 4,
      limiter: BSKY_FOLLOW_QUEUE_RATE_LIMIT,
      ...WORKER_DEFAULT_JOB_OPTIONS,
    },
  );
}

function makeCompileWorker(
  services: Services,
  connection: ConnectionOptions,
  concurrency: number,
): Worker {
  return new Worker<SagaPayload>(
    QUEUE_NAMES.compile,
    async (job) => {
      const result = await services.submissions.runSaga({
        ...job.data,
        retryCount: job.attemptsMade,
      });
      if (result.isErr()) rethrowForBullMQ(result.error);
      return result.value;
    },
    { connection, concurrency, ...WORKER_DEFAULT_JOB_OPTIONS },
  );
}

function makeHtmlCompileWorker(services: Services, connection: ConnectionOptions): Worker {
  return new Worker<HtmlCompilePayload>(
    QUEUE_NAMES.convertHtml,
    async (job) => {
      const result = await services.submissions.runHtmlCompile(job.data);
      if (result.isErr()) rethrowForBullMQ(result.error);
      return result.value;
    },
    { connection, concurrency: 1, ...WORKER_DEFAULT_JOB_OPTIONS },
  );
}

function makeEmbedWorker(ctx: AppContext, connection: ConnectionOptions, concurrency: number): Worker {
  return new Worker<{ paperId: string }>(
    QUEUE_NAMES.embed,
    async (job) => {
      const { paperId } = job.data;
      const loadedResult = await ctx.repos.papers.loadWithRelations(paperId);
      if (loadedResult.isErr()) rethrowForBullMQ(loadedResult.error);
      const loaded = loadedResult._unsafeUnwrap();
      if (!loaded) throw new UnrecoverableError(`not_found: paper ${paperId}`);
      const corpus = [loaded.paper.title, loaded.paper.abstract ?? '', ...loaded.keywords]
        .filter(Boolean)
        .join('\n');
      if (corpus.length < 10) {
        throw new UnrecoverableError('validation: corpus too small to embed');
      }
      const embedResult = await ctx.clients.llm.generateEmbedding(corpus, {
        model: ctx.env.GEMINI_MODEL_EMBED,
      });
      if (embedResult.isErr()) rethrowForBullMQ(embedResult.error);
      const embedding = embedResult._unsafeUnwrap();
      const upsert = await ctx.repos.embeddings.upsert({
        paperId,
        embedding,
        model: ctx.env.GEMINI_MODEL_EMBED,
        dim: embedding.length,
      });
      if (upsert.isErr()) rethrowForBullMQ(upsert.error);
      return { dim: embedding.length };
    },
    { connection, concurrency, ...WORKER_DEFAULT_JOB_OPTIONS },
  );
}

function makeExplainWorker(
  services: Services,
  connection: ConnectionOptions,
  concurrency: number,
): Worker {
  return new Worker<{ paperId: string; tier: 'school' | 'undergrad' | 'expert' }>(
    QUEUE_NAMES.explain,
    async (job) => {
      const result = await services.explain.explain(job.data);
      if (result.isErr()) rethrowForBullMQ(result.error);
      return result.value;
    },
    { connection, concurrency, ...WORKER_DEFAULT_JOB_OPTIONS },
  );
}

void Errors;
