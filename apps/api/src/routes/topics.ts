import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { buildCategoryBrowse, getCategory } from '@openxiv/shared';
import type { TopicPaperHit } from '@openxiv/db';

/**
 * Topic Dossiers (P2 #19) — auto-generated topic pages keyed by either:
 *
 *   1. A category code (cs.AI, physics.gen-ph, q-bio.NC, …) — exact match
 *      against paper_categories.
 *   2. A keyword slug (machine-learning, topology, …) — matched against
 *      paper_keywords with both raw and slugified comparisons so an author
 *      typing "Machine Learning" still surfaces under /topics/machine-learning.
 *
 * The endpoint returns just enough metadata for the web page to render a
 * list, build the Atom feed, and emit Schema.org ItemList JSON-LD. The web
 * page can hop to /papers/:id for any individual paper's full relations.
 */
const topicQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

const CATEGORY_RE = /^[a-zA-Z0-9.-]{2,40}$/;
const KEYWORD_SLUG_RE = /^[a-z0-9-]{2,80}$/;

export async function topicsRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  app.get('/topics/categories', async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=60, s-maxage=300');
    // We fetch both the per-category counts AND the raw membership rows so
    // the browse builder can derive *distinct* paper counts at the group
    // and repository level. Without the memberships, the page shows
    // "5 categorized papers" when only 2 papers exist (each cross-listed
    // into a few categories) — the regression the author surfaced after
    // the first two real preprints landed.
    const [counts, memberships] = await Promise.all([
      ctx.repos.topics.categoryCounts(),
      ctx.repos.topics.categoryMemberships(),
    ]);
    if (counts.isErr()) throw counts.error;
    if (memberships.isErr()) throw memberships.error;
    return buildCategoryBrowse(
      Object.fromEntries(counts.value.map((row) => [row.code, row.count])),
      { memberships: memberships.value },
    );
  });

  app.get(
    '/topics/:slug',
    {
      schema: {
        params: z.object({ slug: z.string().min(1).max(80) }),
        querystring: topicQuerySchema,
      },
    },
    async (req, reply) => {
      const { slug } = req.params as { slug: string };
      const { limit } = req.query as z.infer<typeof topicQuerySchema>;

      // Cache topic pages briefly — the underlying corpus changes slowly and
      // a single Hacker News spike can pull thousands of crawler hits.
      reply.header('cache-control', 'public, max-age=60, s-maxage=300');

      let kind: 'category' | 'keyword';
      let papers: TopicPaperHit[] = [];
      let label = slug;
      let blurb: string | null = null;

      if (CATEGORY_RE.test(slug) && getCategory(slug)) {
        kind = 'category';
        const meta = getCategory(slug);
        label = meta ? `${meta.name} (${meta.group})` : slug;
        blurb = meta?.description ?? null;
        const r = await ctx.repos.topics.byCategory(slug, limit);
        if (r.isOk()) papers = r.value;
      } else if (KEYWORD_SLUG_RE.test(slug)) {
        kind = 'keyword';
        label = slug.replace(/-/g, ' ');
        const r = await ctx.repos.topics.byKeyword(slug, limit);
        if (r.isOk()) papers = r.value;
      } else {
        kind = slug.includes('.') ? 'category' : 'keyword';
      }

      return {
        slug,
        kind,
        label,
        blurb,
        oaiSetSpec: kind === 'category' && getCategory(slug) ? slug : null,
        papers,
      };
    },
  );
}
