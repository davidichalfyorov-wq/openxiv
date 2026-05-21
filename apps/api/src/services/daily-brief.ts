/**
 * Daily Science Brief composer (P1 #5).
 *
 * Returns exactly five items in a fixed order so the page renders the same
 * shape every day even when categories are sparse:
 *
 *   1. featured       — top hand-curated featured item
 *   2. claim          — most-recently-claimed external paper
 *   3. open_question  — a post labeled `best_unresolved`
 *   4. explainer      — a paper that has a school-tier plain summary
 *   5. serendipity    — a random recent paper (pgvector-distance from the
 *                       other four is Phase 2)
 *
 * Empty categories fall back to a friendly stub item (kind retained, but
 * `present: false`) so the brief is always 5 entries — the UI never has
 * to render gaps.
 */
import type { AppContext } from '../context.js';

export interface BriefItem {
  kind: 'featured' | 'claim' | 'open_question' | 'explainer' | 'serendipity';
  present: boolean;
  title: string | null;
  href: string | null;
  blurb: string | null;
}

export interface BriefComposition {
  date: string; // YYYY-MM-DD UTC
  items: BriefItem[];
  generatedAt: string;
}

const CACHE_TTL_SECONDS = 60 * 60;

export async function composeDailyBrief(ctx: AppContext): Promise<BriefComposition> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const cacheKey = `brief:live:${todayIso}`;
  try {
    const cached = await ctx.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as BriefComposition;
  } catch {
    // ignore
  }

  const [featured, claim, openQ, explainer, serendipity] = await Promise.all([
    pickFeatured(ctx),
    pickClaim(ctx),
    pickOpenQuestion(ctx),
    pickExplainer(ctx),
    pickSerendipity(ctx),
  ]);

  const composition: BriefComposition = {
    date: todayIso,
    items: [featured, claim, openQ, explainer, serendipity],
    generatedAt: new Date().toISOString(),
  };
  try {
    await ctx.redis.set(cacheKey, JSON.stringify(composition), 'EX', CACHE_TTL_SECONDS);
  } catch {
    // best-effort
  }
  return composition;
}

async function pickFeatured(ctx: AppContext): Promise<BriefItem> {
  const r = await ctx.repos.featured.listActive(1);
  if (r.isOk() && r.value.length > 0) {
    const f = r.value[0]!;
    return {
      kind: 'featured',
      present: true,
      title: f.targetUri,
      href: featuredHref(f.targetUri, f.targetType),
      blurb: f.reasonCardMd.split(/\n+/)[0] ?? null,
    };
  }
  return { kind: 'featured', present: false, title: null, href: null, blurb: 'No featured pick today.' };
}

async function pickClaim(ctx: AppContext): Promise<BriefItem> {
  const r = await ctx.repos.dailyBriefs.latestClaimedExternal();
  if (r.isOk() && r.value) {
    const row = r.value;
    return {
      kind: 'claim',
      present: true,
      title: row.title,
      href: `/lens/${row.source}/${encodeURIComponent(row.sourceId)}`,
      blurb: `Claimed by ${row.claimedByDid.slice(0, 24)} — the OpenXiv layer just gained a new authoritative view.`,
    };
  }
  return { kind: 'claim', present: false, title: null, href: null, blurb: 'No new claims yet.' };
}

async function pickOpenQuestion(ctx: AppContext): Promise<BriefItem> {
  const r = await ctx.repos.dailyBriefs.latestBestUnresolved();
  if (r.isOk() && r.value) {
    const row = r.value;
    const href =
      row.embedPaperUri && row.embedPaperUri.startsWith('openxiv:')
        ? `/abs/${row.embedPaperUri.replace(/^openxiv:/, '')}`
        : null;
    return {
      kind: 'open_question',
      present: true,
      title: row.text.slice(0, 120),
      href,
      blurb: 'Open question the author wants the community to engage with.',
    };
  }
  return {
    kind: 'open_question',
    present: false,
    title: null,
    href: null,
    blurb: 'No best-unresolved questions surfaced yet.',
  };
}

async function pickExplainer(ctx: AppContext): Promise<BriefItem> {
  const r = await ctx.repos.dailyBriefs.latestSchoolExplainer();
  if (r.isOk() && r.value) {
    const row = r.value;
    const slug = row.openxivId?.replace(/^openxiv:/, '') ?? row.paperId;
    return {
      kind: 'explainer',
      present: true,
      title: row.title,
      href: `/abs/${slug}/explain/school`,
      blurb: row.text.slice(0, 180),
    };
  }
  return {
    kind: 'explainer',
    present: false,
    title: null,
    href: null,
    blurb: 'No school-tier explainer ready today.',
  };
}

async function pickSerendipity(ctx: AppContext): Promise<BriefItem> {
  const r = await ctx.repos.dailyBriefs.randomPublishedPaper();
  if (r.isOk() && r.value) {
    const row = r.value;
    const slug = row.openxivId?.replace(/^openxiv:/, '') ?? row.id;
    return {
      kind: 'serendipity',
      present: true,
      title: row.title,
      href: `/abs/${slug}`,
      blurb: row.abstract?.slice(0, 200) ?? 'A random paper from the corpus.',
    };
  }
  return {
    kind: 'serendipity',
    present: false,
    title: null,
    href: null,
    blurb: 'No serendipitous pick today.',
  };
}

function featuredHref(targetUri: string, targetType: string): string {
  if (targetType === 'openxiv_paper') return `/abs/${targetUri.replace(/^openxiv:/, '')}`;
  const [src, ...rest] = targetUri.split(':');
  if (!src || rest.length === 0) return '/';
  return `/lens/${src}/${encodeURIComponent(rest.join(':'))}`;
}
