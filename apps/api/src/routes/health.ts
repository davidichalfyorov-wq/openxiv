import type { FastifyInstance } from 'fastify';
import { fetchWithTimeoutRetry } from '@openxiv/clients';
import { Errors } from '@openxiv/shared';
import { SAGA_STAGE_ORDER, type SagaStage } from '@openxiv/db';
import type { Queue } from 'bullmq';
import { snapshotMetrics as snapshotBskyDidMetrics } from '../services/bluesky-did-resolver.js';
import {
  HEALTH_ATPROTO_PROBE_TIMEOUT_MS,
  HEALTH_GROBID_PROBE_TIMEOUT_MS,
  HEALTH_JETSTREAM_PROBE_TIMEOUT_MS,
  HEALTH_STORAGE_PRESIGN_TTL_SECONDS,
  HEALTH_WRAPPER_TIMEOUT_MS,
} from '../constants/launch-policy.js';

interface DepStatus {
  status: 'up' | 'down' | 'degraded' | 'skipped';
  latencyMs: number;
  detail?: string;
}

const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

interface MetricsSnapshot {
  readonly dependencies: Record<string, DepStatus>;
  readonly queues: Awaited<ReturnType<typeof queueDepths>>;
  readonly saga24h: Awaited<ReturnType<typeof sagaSuccessRates24h>>;
  readonly bskyDidResolution: ReturnType<typeof snapshotBskyDidMetrics>;
}

async function timed<T>(probe: () => Promise<T>): Promise<{ ok: T | null; ms: number; error?: string }> {
  const start = Date.now();
  try {
    const value = await Promise.race([
      probe(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`probe timeout after ${HEALTH_WRAPPER_TIMEOUT_MS}ms`)),
          HEALTH_WRAPPER_TIMEOUT_MS,
        ),
      ),
    ]);
    return { ok: value, ms: Date.now() - start };
  } catch (err) {
    return { ok: null, ms: Date.now() - start, error: (err as Error).message };
  }
}

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  /** Liveness — always 200 if process is up. */
  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'openxiv-api',
  }));

  /** Backwards-compatible readiness — postgres + redis only. */
  app.get('/health/ready', async (_req, reply) => {
    try {
      await ctx.db.pool.query('select 1');
      await ctx.redis.ping();
      return { status: 'ready' };
    } catch (err) {
      reply.status(503);
      return { status: 'not_ready', error: (err as Error).message };
    }
  });

  /**
   * Dep-aware health. Probes every external in parallel with bounded timeouts.
   * `degraded` if any non-critical dep is down (e.g. Gemini); `down` if a
   * critical dep is unavailable (postgres, redis, s3).
   */
  app.get('/healthz', async (_req, reply) => {
    const [pg, redis, s3, grobid, llm, atproto, jetstream] = await Promise.all([
      timed(async () => {
        await ctx.db.pool.query('select 1');
        return 'ok';
      }),
      timed(async () => {
        await ctx.redis.ping();
        return 'ok';
      }),
      timed(async () => {
        const r = await ctx.clients.storage.presignGet(
          'healthcheck/__ping__',
          HEALTH_STORAGE_PRESIGN_TTL_SECONDS,
        );
        if (r.isErr()) throw r.error;
        return 'ok';
      }),
      timed(async () => {
        if (ctx.env.USE_MOCK_CLIENTS || ctx.env.USE_MOCK_GROBID) return 'mock';
        const res = await fetchWithTimeoutRetry(`${ctx.env.GROBID_URL}/api/isalive`, {
          timeoutMs: HEALTH_GROBID_PROBE_TIMEOUT_MS,
          attempts: 1,
        });
        if (!res.ok) throw new Error(`grobid ${res.status}`);
        return 'ok';
      }),
      timed(async () => {
        if (ctx.env.USE_MOCK_CLIENTS || ctx.env.USE_MOCK_LLM || !ctx.env.GEMINI_API_KEY) {
          return 'mock';
        }
        const r = await ctx.clients.llm.generateEmbedding('healthcheck', {
          model: ctx.env.GEMINI_MODEL_EMBED,
        });
        if (r.isErr()) throw r.error;
        return 'ok';
      }),
      timed(async () => {
        if (ctx.env.USE_MOCK_CLIENTS || ctx.env.USE_MOCK_BLUESKY) return 'mock';
        // describeServer is the documented unauthenticated probe for AT-proto
        // PDS instances. We hit bsky.social directly here (not the user's
        // PDS) — it serves as the canonical reachability check.
        const res = await fetchWithTimeoutRetry(
          `${ctx.env.ATPROTO_SERVICE_URL}/xrpc/com.atproto.server.describeServer`,
          { timeoutMs: HEALTH_ATPROTO_PROBE_TIMEOUT_MS, attempts: 1 },
        );
        if (!res.ok) throw new Error(`atproto ${res.status}`);
        return 'ok';
      }),
      timed(async () => {
        if (ctx.env.USE_MOCK_CLIENTS || ctx.env.USE_MOCK_BLUESKY) return 'mock';
        // Jetstream WebSocket probe via the HTTP info endpoint (jetstream
        // exposes one beside the wss:// path). Failing the probe means
        // mentions won't be backfilled — non-critical but reported.
        const httpUrl = (process.env['JETSTREAM_PROBE_URL'] ??
          'https://jetstream2.us-east.bsky.network/');
        const res = await fetchWithTimeoutRetry(httpUrl, {
          timeoutMs: HEALTH_JETSTREAM_PROBE_TIMEOUT_MS,
          attempts: 1,
        });
        if (!res.ok && res.status !== 426) throw new Error(`jetstream ${res.status}`);
        return 'ok';
      }),
    ]);

    const deps: Record<string, DepStatus> = {
      postgres: probeStatus(pg, true),
      redis: probeStatus(redis, true),
      s3: probeStatus(s3, true),
      grobid: probeStatus(grobid, false),
      llm: probeStatus(llm, false),
      atproto: probeStatus(atproto, false),
      jetstream: probeStatus(jetstream, false),
    };

    const critical = ['postgres', 'redis', 's3'].some((k) => deps[k]?.status === 'down');
    const optional = ['grobid', 'llm', 'atproto', 'jetstream'].some(
      (k) => deps[k]?.status === 'down',
    );
    const overall: 'ok' | 'degraded' | 'down' = critical ? 'down' : optional ? 'degraded' : 'ok';
    reply.status(critical ? 503 : 200);
    return {
      status: overall,
      timestamp: new Date().toISOString(),
      service: 'openxiv-api',
      dependencies: deps,
    };
  });

  app.get('/metrics', async (_req, reply) => {
    const [dependencies, queues, saga24h] = await Promise.all([
      metricsDependencies(ctx),
      queueDepths(ctx),
      sagaSuccessRates24h(ctx),
    ]);
    reply.header('content-type', PROMETHEUS_CONTENT_TYPE);
    return renderPrometheusMetrics({
      dependencies,
      queues,
      saga24h,
      bskyDidResolution: snapshotBskyDidMetrics(),
    });
  });

  app.get('/admin/health', { preHandler: app.requireAuth }, async (req) => {
    if (!req.session) throw Errors.unauthorized();
    if (!app.services.users.isAdminDid(req.session.did)) throw Errors.forbidden('admin only');

    const [postgres, redis, s3, grobid, queues, saga24h] = await Promise.all([
      timed(async () => {
        await ctx.db.pool.query('select 1');
        return 'ok';
      }),
      timed(async () => {
        await ctx.redis.ping();
        return 'ok';
      }),
      timed(async () => {
        const r = await ctx.clients.storage.presignGet(
          'healthcheck/__ping__',
          HEALTH_STORAGE_PRESIGN_TTL_SECONDS,
        );
        if (r.isErr()) throw r.error;
        return 'ok';
      }),
      timed(async () => {
        if (ctx.env.USE_MOCK_CLIENTS || ctx.env.USE_MOCK_GROBID) return 'mock';
        const res = await fetchWithTimeoutRetry(`${ctx.env.GROBID_URL}/api/isalive`, {
          timeoutMs: HEALTH_GROBID_PROBE_TIMEOUT_MS,
          attempts: 1,
        });
        if (!res.ok) throw new Error(`grobid ${res.status}`);
        return 'ok';
      }),
      queueDepths(ctx),
      sagaSuccessRates24h(ctx),
    ]);

    return {
      status: [postgres, redis, s3].some((probe) => probe.error) ? 'down' : grobid.error ? 'degraded' : 'ok',
      timestamp: new Date().toISOString(),
      service: 'openxiv-api',
      dependencies: {
        api: { status: 'up', latencyMs: 0 },
        postgres: probeStatus(postgres, true),
        redis: probeStatus(redis, true),
        minio: probeStatus(s3, true),
        grobid: probeStatus(grobid, false),
      },
      queues,
      saga24h,
    };
  });
}

function probeStatus<T>(
  probe: { ok: T | null; ms: number; error?: string },
  isCritical: boolean,
): DepStatus {
  if (probe.error) {
    return {
      status: 'down',
      latencyMs: probe.ms,
      detail: isCritical ? `CRITICAL: ${probe.error}` : probe.error,
    };
  }
  if (probe.ok === 'mock') {
    return { status: 'skipped', latencyMs: probe.ms, detail: 'mocked' };
  }
  return { status: 'up', latencyMs: probe.ms };
}

async function metricsDependencies(
  ctx: FastifyInstance['ctx'],
): Promise<Record<string, DepStatus>> {
  const [postgres, redis, s3, grobid] = await Promise.all([
    timed(async () => {
      await ctx.db.pool.query('select 1');
      return 'ok';
    }),
    timed(async () => {
      await ctx.redis.ping();
      return 'ok';
    }),
    timed(async () => {
      const r = await ctx.clients.storage.presignGet(
        'healthcheck/__ping__',
        HEALTH_STORAGE_PRESIGN_TTL_SECONDS,
      );
      if (r.isErr()) throw r.error;
      return 'ok';
    }),
    timed(async () => {
      if (ctx.env.USE_MOCK_CLIENTS || ctx.env.USE_MOCK_GROBID) return 'mock';
      const res = await fetchWithTimeoutRetry(`${ctx.env.GROBID_URL}/api/isalive`, {
        timeoutMs: HEALTH_GROBID_PROBE_TIMEOUT_MS,
        attempts: 1,
      });
      if (!res.ok) throw new Error(`grobid ${res.status}`);
      return 'ok';
    }),
  ]);

  return {
    api: { status: 'up', latencyMs: 0 },
    postgres: probeStatus(postgres, true),
    redis: probeStatus(redis, true),
    minio: probeStatus(s3, true),
    grobid: probeStatus(grobid, false),
  };
}

export function renderPrometheusMetrics(snapshot: MetricsSnapshot): string {
  const lines: string[] = [
    '# HELP openxiv_dependency_up OpenXiv dependency health, 1 for up or intentionally skipped, 0 for down.',
    '# TYPE openxiv_dependency_up gauge',
  ];
  for (const [name, dep] of Object.entries(snapshot.dependencies).sort()) {
    lines.push(
      `openxiv_dependency_up{dependency="${escapeLabel(name)}"} ${dep.status === 'down' ? 0 : 1}`,
    );
  }

  lines.push(
    '# HELP openxiv_dependency_latency_ms OpenXiv dependency probe latency in milliseconds.',
    '# TYPE openxiv_dependency_latency_ms gauge',
  );
  for (const [name, dep] of Object.entries(snapshot.dependencies).sort()) {
    lines.push(
      `openxiv_dependency_latency_ms{dependency="${escapeLabel(name)}"} ${formatMetricNumber(dep.latencyMs)}`,
    );
  }

  lines.push(
    '# HELP openxiv_queue_jobs BullMQ job counts by logical queue and state.',
    '# TYPE openxiv_queue_jobs gauge',
  );
  for (const [logicalQueue, counts] of Object.entries(snapshot.queues).sort()) {
    const queueName = queueMetricName(logicalQueue);
    for (const state of ['waiting', 'active', 'delayed', 'failed', 'completed'] as const) {
      lines.push(
        `openxiv_queue_jobs{queue="${escapeLabel(queueName)}",logical_queue="${escapeLabel(logicalQueue)}",state="${state}"} ${counts[state]}`,
      );
    }
  }

  lines.push(
    '# HELP openxiv_queue_dlq BullMQ dead-letter queue depth by logical queue.',
    '# TYPE openxiv_queue_dlq gauge',
  );
  for (const [logicalQueue, counts] of Object.entries(snapshot.queues).sort()) {
    const queueName = queueMetricName(logicalQueue);
    lines.push(
      `openxiv_queue_dlq{queue="${escapeLabel(queueName)}",logical_queue="${escapeLabel(logicalQueue)}"} ${counts.dlq}`,
    );
  }

  lines.push(
    '# HELP openxiv_saga_stage_total Submission saga stage outcomes over the last 24 hours.',
    '# TYPE openxiv_saga_stage_total counter',
  );
  for (const stage of SAGA_STAGE_ORDER) {
    const stats = snapshot.saga24h[stage];
    lines.push(
      `openxiv_saga_stage_total{stage="${stage}",outcome="succeeded",window="24h"} ${stats.succeeded}`,
      `openxiv_saga_stage_total{stage="${stage}",outcome="failed",window="24h"} ${stats.failed}`,
    );
  }

  lines.push(
    '# HELP openxiv_saga_stage_success_rate Submission saga stage success rate over the last 24 hours.',
    '# TYPE openxiv_saga_stage_success_rate gauge',
  );
  for (const stage of SAGA_STAGE_ORDER) {
    const stats = snapshot.saga24h[stage];
    lines.push(
      `openxiv_saga_stage_success_rate{stage="${stage}",window="24h"} ${formatMetricNumber(stats.successRate)}`,
    );
  }

  lines.push(
    '# HELP openxiv_bsky_did_resolution_total Bluesky DID resolver outcomes since process start.',
    '# TYPE openxiv_bsky_did_resolution_total counter',
  );
  for (const [outcome, count] of Object.entries(snapshot.bskyDidResolution).sort()) {
    lines.push(
      `openxiv_bsky_did_resolution_total{outcome="${escapeLabel(outcome)}"} ${count}`,
    );
  }

  return `${lines.join('\n')}\n`;
}

function queueMetricName(logicalQueue: string): string {
  return `openxiv.${logicalQueue.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`;
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function formatMetricNumber(value: number | null): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : 'NaN';
}

async function queueDepths(ctx: FastifyInstance['ctx']): Promise<
  Record<string, { waiting: number; active: number; delayed: number; failed: number; completed: number; dlq: number }>
> {
  const entries = Object.entries(ctx.queues).filter(([name]) => name !== 'close') as Array<
    [string, Queue]
  >;
  const out: Record<string, { waiting: number; active: number; delayed: number; failed: number; completed: number; dlq: number }> = {};
  await Promise.all(
    entries.map(async ([name, queue]) => {
      const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
      const dlq = await ctx.redis.llen(`worker:dlq:${queue.name}`).catch(() => 0);
      out[name] = {
        waiting: counts['waiting'] ?? 0,
        active: counts['active'] ?? 0,
        delayed: counts['delayed'] ?? 0,
        failed: counts['failed'] ?? 0,
        completed: counts['completed'] ?? 0,
        dlq,
      };
    }),
  );
  return out;
}

const SAGA_STAGE_COLUMNS: Record<SagaStage, string> = {
  stagePaperPersisted: 'stage_paper_persisted',
  stagePaperApproved: 'stage_paper_approved',
  stageIdAssigned: 'stage_id_assigned',
  stagePdsPaper: 'stage_pds_paper',
  stagePdsSummaryDisclosure: 'stage_pds_summary_disclosure',
  stageBlueskyBridge: 'stage_bluesky_bridge',
};

async function sagaSuccessRates24h(ctx: FastifyInstance['ctx']): Promise<
  Record<SagaStage, { succeeded: number; failed: number; successRate: number | null }>
> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const { rows } = await ctx.db.pool.query<Record<string, unknown>>(
    'select stage_paper_persisted, stage_paper_approved, stage_id_assigned, stage_pds_paper, stage_pds_summary_disclosure, stage_bluesky_bridge, last_error_stage from submission_sagas where updated_at >= $1',
    [since],
  );
  const out = {} as Record<SagaStage, { succeeded: number; failed: number; successRate: number | null }>;
  for (const stage of SAGA_STAGE_ORDER) {
    const column = SAGA_STAGE_COLUMNS[stage];
    const succeeded = rows.filter((row) => row[column] === true).length;
    const failed = rows.filter((row) => row['last_error_stage'] === stage).length;
    const total = succeeded + failed;
    out[stage] = {
      succeeded,
      failed,
      successRate: total > 0 ? succeeded / total : null,
    };
  }
  return out;
}
