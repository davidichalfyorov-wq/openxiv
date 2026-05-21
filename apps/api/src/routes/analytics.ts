import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors, openxivIdToUrl } from '@openxiv/shared';
import type { AppContext } from '../context.js';

const paramsSchema = z.object({
  id: z.string().min(1).max(256),
});

const profileParamsSchema = z.object({
  identifier: z.string().min(1).max(256),
});

const CACHE_PREFIX = 'analytics:paper:';
const CACHE_TTL_SECONDS = 300;

const VIEW_EVENTS = ['paper_view', 'feed_impression', 'card_expand'] as const;

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const services = app.services;

  app.get(
    '/papers/:id/analytics',
    { schema: { params: paramsSchema } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const paper = await resolvePaper(ctx, id);
      if (paper === null) {
        reply.status(404);
        return { kind: 'not_found' as const };
      }
      const cacheKey = CACHE_PREFIX + paper.id;
      try {
        const cached = await ctx.redis.get(cacheKey);
        if (cached) {
          reply.header('cache-control', 'public, max-age=60');
          return JSON.parse(cached);
        }
      } catch {
        // best-effort cache
      }
      const payload = await computeAnalytics(ctx, paper);
      try {
        await ctx.redis.set(cacheKey, JSON.stringify(payload), 'EX', CACHE_TTL_SECONDS);
      } catch {
        // best-effort cache
      }
      reply.header('cache-control', 'public, max-age=60');
      return payload;
    },
  );

  app.get('/me/insights', { preHandler: app.requireAuth }, async (req) => {
    if (!req.session) throw Errors.unauthorized();
    return authorInsights(ctx, req.session.did);
  });

  app.get(
    '/profiles/:identifier/insights',
    { preHandler: app.requireAuth, schema: { params: profileParamsSchema } },
    async (req) => {
      if (!req.session) throw Errors.unauthorized();
      const { identifier } = req.params as { identifier: string };
      const user = await resolveUser(ctx, identifier);
      if (!user) throw Errors.notFound('profile');
      if (user.did !== req.session.did && !services.users.isAdminDid(req.session.did)) {
        throw Errors.forbidden('own profile only');
      }
      return authorInsights(ctx, user.did);
    },
  );

  app.get('/admin/stats', { preHandler: app.requireAuth }, async (req) => {
    if (!req.session) throw Errors.unauthorized();
    if (!services.users.isAdminDid(req.session.did)) throw Errors.forbidden('admin only');
    return adminStats(ctx);
  });
}

interface ResolvedPaper {
  id: string;
  openxivId: string | null;
  openxivUrlId: string | null;
  uri: string | null;
  title: string;
  publishedAt: string | null;
  createdAt: string;
  targetUris: string[];
}

interface AnalyticsPayload {
  views24h: number;
  viewsTotal: number;
  downloadsTotal: number;
  htmlOpensTotal: number;
  endorsementsTotal: number;
  views7d: number;
  views30d: number;
  topReferrers: Array<{ host: string; count: number }>;
  countries: Array<{ country: string; count: number }>;
  sparkline: Array<{ ts: string; views: number; downloads: number; htmlOpens: number }>;
}

async function resolvePaper(
  ctx: AppContext,
  identifier: string,
): Promise<ResolvedPaper | null> {
  let row:
    | {
        id: string;
        openxivId: string | null;
        uri: string | null;
        title: string;
        publishedAt: Date | null;
        createdAt: Date;
      }
    | null = null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(identifier)) {
    const r = await ctx.repos.papers.findById(identifier);
    if (r.isErr()) throw r.error;
    row = r.value;
  } else {
    const prefixed = identifier.startsWith('openxiv:') ? identifier : `openxiv:${identifier}`;
    const r = await ctx.repos.papers.findByOpenxivId(prefixed);
    if (r.isErr()) throw r.error;
    row = r.value;
  }
  if (!row) return null;
  const openxivUrlId = row.openxivId ? openxivIdToUrl(row.openxivId) : null;
  return {
    id: row.id,
    openxivId: row.openxivId,
    openxivUrlId,
    uri: row.uri,
    title: row.title,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    targetUris: targetUrisForPaper(row),
  };
}

function targetUrisForPaper(paper: { id: string; openxivId: string | null; uri: string | null }): string[] {
  const out = new Set<string>();
  if (paper.uri) out.add(paper.uri);
  if (paper.openxivId) {
    out.add(paper.openxivId);
    out.add(paper.openxivId.replace(/^openxiv:/, ''));
    out.add(`openxiv:${paper.openxivId.replace(/^openxiv:/, '')}`);
    out.add(`at:openxiv:${paper.openxivId.replace(/^openxiv:/, '')}`);
  }
  out.add(paper.id);
  return [...out];
}

async function computeAnalytics(
  ctx: AppContext,
  paper: ResolvedPaper,
): Promise<AnalyticsPayload> {
  const pool = ctx.db.pool;
  const targets = paper.targetUris;
  const eventsSql = VIEW_EVENTS.map((e) => `'${e}'`).join(',');

  type TotalsRow = {
    views_24h: string | number;
    views_total: string | number;
    downloads_total: string | number;
    html_opens_total: string | number;
    views_7d: string | number;
    views_30d: string | number;
  };
  const totals = await pool.query<TotalsRow>(
    `SELECT
       COUNT(*) FILTER (WHERE event_type IN (${eventsSql}) AND ts >= now() - interval '24 hours') AS views_24h,
       COUNT(*) FILTER (WHERE event_type IN (${eventsSql})) AS views_total,
       COUNT(*) FILTER (WHERE event_type = 'pdf_download') AS downloads_total,
       COUNT(*) FILTER (WHERE event_type = 'html_open') AS html_opens_total,
       COUNT(*) FILTER (WHERE event_type IN (${eventsSql}) AND ts >= now() - interval '7 days') AS views_7d,
       COUNT(*) FILTER (WHERE event_type IN (${eventsSql}) AND ts >= now() - interval '30 days') AS views_30d
     FROM feed_events
     WHERE target_uri = ANY($1::text[])`,
    [targets],
  );

  type SeriesRow = {
    day: Date;
    views: string | number;
    downloads: string | number;
    html_opens: string | number;
  };
  const series = await pool.query<SeriesRow>(
    `SELECT
       date_trunc('day', ts) AS day,
       COUNT(*) FILTER (WHERE event_type IN (${eventsSql})) AS views,
       COUNT(*) FILTER (WHERE event_type = 'pdf_download') AS downloads,
       COUNT(*) FILTER (WHERE event_type = 'html_open') AS html_opens
     FROM feed_events
     WHERE target_uri = ANY($1::text[])
       AND ts >= now() - interval '30 days'
     GROUP BY 1
     ORDER BY 1 ASC`,
    [targets],
  );

  type RefRow = { host: string; count: string | number };
  const refResult = await pool.query<RefRow>(
    `SELECT (context_json ->> 'referrerHost') AS host, COUNT(*) AS count
     FROM feed_events
     WHERE target_uri = ANY($1::text[])
       AND ts >= now() - interval '30 days'
       AND context_json ? 'referrerHost'
     GROUP BY 1
     ORDER BY count DESC
     LIMIT 8`,
    [targets],
  );

  type CountryRow = { country: string; count: string | number };
  const countryResult = await pool.query<CountryRow>(
    `SELECT country_code AS country, COUNT(*) AS count
     FROM feed_events
     WHERE target_uri = ANY($1::text[])
       AND ts >= now() - interval '30 days'
       AND country_code IS NOT NULL
     GROUP BY 1
     ORDER BY count DESC
     LIMIT 12`,
    [targets],
  );

  const endorsementCount = await pool.query<{ count: string | number }>(
    `SELECT COUNT(*) AS count FROM endorsements WHERE paper_id = $1::uuid`,
    [paper.id],
  );
  const row = totals.rows[0];
  return {
    views24h: Number(row?.views_24h ?? 0),
    viewsTotal: Number(row?.views_total ?? 0),
    downloadsTotal: Number(row?.downloads_total ?? 0),
    htmlOpensTotal: Number(row?.html_opens_total ?? 0),
    endorsementsTotal: Number(endorsementCount.rows[0]?.count ?? 0),
    views7d: Number(row?.views_7d ?? 0),
    views30d: Number(row?.views_30d ?? 0),
    topReferrers: refResult.rows.filter((r) => r.host).map((r) => ({ host: r.host, count: Number(r.count) })),
    countries: countryResult.rows.filter((r) => r.country).map((r) => ({ country: r.country, count: Number(r.count) })),
    sparkline: series.rows.map((r) => ({
      ts: r.day instanceof Date ? r.day.toISOString() : String(r.day),
      views: Number(r.views),
      downloads: Number(r.downloads),
      htmlOpens: Number(r.html_opens),
    })),
  };
}

async function authorInsights(ctx: AppContext, did: string): Promise<{
  generatedAt: string;
  items: Array<ResolvedPaper & { analytics: AnalyticsPayload }>;
}> {
  const rows = await ctx.repos.papers.list({ status: 'published', submitterDid: did, limit: 100 });
  if (rows.isErr()) throw rows.error;
  const items: Array<ResolvedPaper & { analytics: AnalyticsPayload }> = [];
  for (const row of rows.value) {
    const paper = {
      id: row.id,
      openxivId: row.openxivId,
      openxivUrlId: row.openxivId ? openxivIdToUrl(row.openxivId) : null,
      uri: row.uri,
      title: row.title,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      targetUris: targetUrisForPaper(row),
    };
    items.push({ ...paper, analytics: await computeAnalytics(ctx, paper) });
  }
  return { generatedAt: new Date().toISOString(), items };
}

async function resolveUser(
  ctx: AppContext,
  identifier: string,
): Promise<{ did: string } | null> {
  if (identifier.startsWith('did:')) {
    const r = await ctx.repos.users.findByDid(identifier);
    if (r.isErr()) throw r.error;
    return r.value ? { did: r.value.did } : null;
  }
  const r = await ctx.repos.users.findByHandle(identifier.replace(/^@/, ''));
  if (r.isErr()) throw r.error;
  return r.value ? { did: r.value.did } : null;
}

async function adminStats(ctx: AppContext): Promise<{
  generatedAt: string;
  totalSubmissions: number;
  totalEndorsements: number;
  dau: number;
  trending: Array<{ targetUri: string; views24h: number }>;
}> {
  const pool = ctx.db.pool;
  const [submissions, endorsements, dau, trending] = await Promise.all([
    pool.query<{ count: string | number }>(`SELECT COUNT(*) AS count FROM papers`),
    pool.query<{ count: string | number }>(`SELECT COUNT(*) AS count FROM endorsements`),
    pool.query<{ count: string | number }>(
      `SELECT COUNT(DISTINCT session_id) AS count
       FROM feed_events
       WHERE ts >= now() - interval '24 hours'`,
    ),
    pool.query<{ target_uri: string; views: string | number }>(
      `SELECT target_uri, COUNT(*) AS views
       FROM feed_events
       WHERE event_type IN ('paper_view', 'feed_impression', 'card_expand')
         AND target_type IN ('openxiv_paper', 'external_paper')
         AND ts >= now() - interval '24 hours'
       GROUP BY target_uri
       ORDER BY views DESC
       LIMIT 20`,
    ),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    totalSubmissions: Number(submissions.rows[0]?.count ?? 0),
    totalEndorsements: Number(endorsements.rows[0]?.count ?? 0),
    dau: Number(dau.rows[0]?.count ?? 0),
    trending: trending.rows.map((r) => ({ targetUri: r.target_uri, views24h: Number(r.views) })),
  };
}
