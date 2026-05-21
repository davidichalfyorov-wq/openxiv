import { Errors, openxivIdToUrl, parseOpenxivId } from '@openxiv/shared';
import type { AppContext } from '../context.js';

export interface EngagementStats {
  endorsements: {
    count: number;
    breakdown: Record<string, number>;
  };
  reads: {
    views: number;
    html_opens: number;
    pdf_downloads: number;
  };
  citations: number | null;
}

export interface EngagementOptions {
  fetchCrossref?: typeof fetch;
  bypassEngagementCache?: boolean;
}

interface PaperForEngagement {
  id: string;
  openxivId: string | null;
  uri: string | null;
  doi: string | null;
}

const ENGAGEMENT_CACHE_TTL_SECONDS = 5 * 60;
export const CROSSREF_CACHE_TTL_SECONDS = 4 * 60 * 60;
const CROSSREF_TIMEOUT_MS = 5_000;
const READ_ROLLUP_MAX_AGE_MS = 5 * 60 * 1000;
export const ANALYTICS_ROLLUP_REFRESHED_AT_KEY = 'analytics:rollup:last_refreshed_at';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveEngagementPaperId(
  ctx: AppContext,
  id: string,
): Promise<string | null> {
  if (UUID_REGEX.test(id)) {
    const row = await ctx.repos.papers.findById(id);
    if (row.isErr()) throw row.error;
    return row.value?.id ?? null;
  }
  const parsed = parseOpenxivId(id);
  if (!parsed) return null;
  const canonical = `openxiv:${parsed.subject}.${parsed.year}.${String(parsed.seq).padStart(5, '0')}`;
  const row = await ctx.repos.papers.findByOpenxivId(canonical);
  if (row.isErr()) throw row.error;
  return row.value?.id ?? null;
}

export async function getEngagement(
  ctx: AppContext,
  paperId: string,
  options: EngagementOptions = {},
): Promise<EngagementStats> {
  const cacheKey = engagementCacheKey(paperId);
  if (!options.bypassEngagementCache) {
    const cached = await redisGetJson<EngagementStats>(ctx, cacheKey);
    if (cached) return cached;
  }

  const paper = await loadPaper(ctx, paperId);
  if (!paper) throw Errors.notFound('paper');

  const [endorsements, reads, citations] = await Promise.all([
    loadEndorsementStats(ctx, paper.id),
    loadReadCounters(ctx, paper),
    loadCrossrefCitations(ctx, paper.doi, options.fetchCrossref ?? fetch),
  ]);

  const payload: EngagementStats = { endorsements, reads, citations };
  await redisSetJson(ctx, cacheKey, payload, ENGAGEMENT_CACHE_TTL_SECONDS);
  return payload;
}

export async function invalidateEngagementCache(ctx: AppContext, paperId: string): Promise<void> {
  try {
    await ctx.redis.del(engagementCacheKey(paperId));
  } catch {
    // Redis is an accelerator only. Endorsement mutations must still succeed.
  }
}

function engagementCacheKey(paperId: string): string {
  return `engagement:paper:${paperId}`;
}

async function loadPaper(ctx: AppContext, paperId: string): Promise<PaperForEngagement | null> {
  const row = await ctx.repos.papers.findById(paperId);
  if (row.isErr()) throw row.error;
  if (!row.value) return null;
  return {
    id: row.value.id,
    openxivId: row.value.openxivId,
    uri: row.value.uri,
    doi: row.value.doi,
  };
}

async function loadEndorsementStats(
  ctx: AppContext,
  paperId: string,
): Promise<EngagementStats['endorsements']> {
  const stats = await ctx.repos.endorsements.statsForPaper(paperId);
  if (stats.isErr()) throw stats.error;
  return {
    count: stats.value.total,
    breakdown: sortRecord(stats.value.byVerb),
  };
}

async function loadReadCounters(
  ctx: AppContext,
  paper: PaperForEngagement,
): Promise<EngagementStats['reads']> {
  const targets = targetUrisForPaper(paper);
  if (targets.length === 0) return { views: 0, html_opens: 0, pdf_downloads: 0 };

  if (await readRollupIsFresh(ctx)) {
    const fromRollup = await loadReadCountersFromRollup(ctx, targets);
    if (fromRollup) return fromRollup;
  }

  return loadReadCountersDirect(ctx, targets);
}

async function loadReadCountersFromRollup(
  ctx: AppContext,
  targets: string[],
): Promise<EngagementStats['reads'] | null> {
  try {
    const result = await ctx.db.pool.query<{
      views: string | number | null;
      html_opens: string | number | null;
      pdf_downloads: string | number | null;
    }>(
      `SELECT
         COALESCE(SUM(views), 0) AS views,
         COALESCE(SUM(html_opens), 0) AS html_opens,
         COALESCE(SUM(downloads), 0) AS pdf_downloads
       FROM papers_views_hourly
       WHERE paper_uri = ANY($1::text[])`,
      [targets],
    );
    const row = result.rows[0];
    return {
      views: Number(row?.views ?? 0),
      html_opens: Number(row?.html_opens ?? 0),
      pdf_downloads: Number(row?.pdf_downloads ?? 0),
    };
  } catch {
    return null;
  }
}

async function loadReadCountersDirect(
  ctx: AppContext,
  targets: string[],
): Promise<EngagementStats['reads']> {
  const result = await ctx.db.pool.query<{
    views: string | number;
    html_opens: string | number;
    pdf_downloads: string | number;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE event_type = 'paper_view') AS views,
       COUNT(*) FILTER (WHERE event_type = 'html_open') AS html_opens,
       COUNT(*) FILTER (WHERE event_type = 'pdf_download') AS pdf_downloads
     FROM feed_events
     WHERE target_uri = ANY($1::text[])
       AND target_type = 'openxiv_paper'`,
    [targets],
  );
  const row = result.rows[0];
  return {
    views: Number(row?.views ?? 0),
    html_opens: Number(row?.html_opens ?? 0),
    pdf_downloads: Number(row?.pdf_downloads ?? 0),
  };
}

async function readRollupIsFresh(ctx: AppContext): Promise<boolean> {
  try {
    const raw = await ctx.redis.get(ANALYTICS_ROLLUP_REFRESHED_AT_KEY);
    if (!raw) return false;
    const ts = Date.parse(raw);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts <= READ_ROLLUP_MAX_AGE_MS;
  } catch {
    return false;
  }
}

async function loadCrossrefCitations(
  ctx: AppContext,
  doi: string | null,
  fetchCrossref: typeof fetch,
): Promise<number | null> {
  const normalized = normalizeDoi(doi);
  if (!normalized) return null;

  const cacheKey = `engagement:crossref:${normalized.toLowerCase()}`;
  const cached = await redisGetJson<{ citations: number | null }>(ctx, cacheKey);
  if (cached) return cached.citations;

  const citations = await fetchCrossrefCitations(normalized, fetchCrossref);
  await redisSetJson(ctx, cacheKey, { citations }, CROSSREF_CACHE_TTL_SECONDS);
  return citations;
}

async function fetchCrossrefCitations(
  doi: string,
  fetchCrossref: typeof fetch,
): Promise<number | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CROSSREF_TIMEOUT_MS);
  try {
    const response = await fetchCrossref(
      `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
      {
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          'user-agent': 'OpenXiv engagement badge (https://openxiv.net)',
        },
      },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as {
      message?: { 'is-referenced-by-count'?: unknown };
    };
    const raw = body.message?.['is-referenced-by-count'];
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeDoi(doi: string | null | undefined): string | null {
  const trimmed = doi?.trim();
  if (!trimmed) return null;
  return trimmed
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:/i, '')
    .trim();
}

function targetUrisForPaper(paper: PaperForEngagement): string[] {
  const out = new Set<string>();
  if (paper.uri) out.add(paper.uri);
  if (paper.openxivId) {
    out.add(paper.openxivId);
    out.add(openxivIdToUrl(paper.openxivId));
    out.add(paper.openxivId.replace(/^openxiv:/, ''));
    out.add(`openxiv:${paper.openxivId.replace(/^openxiv:/, '')}`);
    out.add(`at:openxiv:${paper.openxivId.replace(/^openxiv:/, '')}`);
  }
  out.add(paper.id);
  return [...out];
}

function sortRecord(input: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)));
}

async function redisGetJson<T>(ctx: AppContext, key: string): Promise<T | null> {
  try {
    const raw = await ctx.redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function redisSetJson<T>(
  ctx: AppContext,
  key: string,
  value: T,
  ttlSeconds: number,
): Promise<void> {
  try {
    await ctx.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {
    // Best-effort cache.
  }
}
