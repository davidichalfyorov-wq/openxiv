import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors } from '@openxiv/shared';
import { makeArxivFetcher } from '../services/arxiv-fetcher.js';
import { FLAGS } from '../services/flags.js';

const STALE_AFTER_MS = 24 * 60 * 60 * 1000; // re-fetch arxiv metadata after 24h

const sourceSchema = z.enum(['arxiv']);
const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9.\-/_]+$/, 'invalid source id');

export async function lensRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const services = app.services;
  const fetcher = makeArxivFetcher(ctx);

  /**
   * GET /api/lens/:source/:id — proxy view of an external paper.
   *
   * Flow:
   *  1. Lookup cached row.
   *  2. If missing or fetched > 24h ago, schedule a live fetch (synchronous
   *     when missing, async refresh when stale so the user never waits).
   *  3. Return the cached or freshly-fetched row.
   *
   * Resilience: if the lens flag is off OR the fetcher returns null, we
   * return 404 — the route never lets a hung arXiv server stall the page.
   */
  app.get(
    '/lens/:source/:id',
    {
      schema: {
        params: z.object({ source: sourceSchema, id: idSchema }),
      },
      config: {
        rateLimit: {
          // 30/min/IP is plenty — readers usually open one Lens page at a
          // time, not browse-scrape a corpus.
          max: 30,
          timeWindow: 60_000,
        },
      },
    },
    async (req) => {
      const { source, id } = req.params as { source: 'arxiv'; id: string };
      const enabled = await services.flags.isEnabled(FLAGS.OPENXIV_LENS, true);
      if (!enabled) throw Errors.notFound('lens disabled');

      const cached = await ctx.repos.externalPapers.get(source, id);
      if (cached.isErr()) throw cached.error;
      let row = cached.value;
      const stale = row && Date.now() - row.fetchedAt.getTime() > STALE_AFTER_MS;

      if (!row || stale) {
        try {
          const fetched = await fetcher.fetchById(id);
          if (!fetched && !row) throw Errors.notFound('paper not on ' + source);
          if (fetched) {
            const upserted = await ctx.repos.externalPapers.upsert(fetched.paper);
            if (upserted.isOk()) row = upserted.value;
          }
        } catch (e) {
          if (!row) throw e;
          // Stale-while-error: return last good copy if upstream is down.
          req.log.warn({ err: (e as Error).message }, 'lens refresh failed, serving stale');
        }
      }

      if (!row) throw Errors.notFound('paper not on ' + source);
      return {
        source: row.source,
        sourceId: row.sourceId,
        title: row.title,
        authors: row.authorsJson,
        abstract: row.abstract,
        categories: row.categories,
        doi: row.doi,
        url: row.url,
        license: row.license,
        publishedAt: row.publishedAt?.toISOString() ?? null,
        withdrawn: row.withdrawn,
        fetchedAt: row.fetchedAt.toISOString(),
        claimedByDid: row.claimedByDid,
        claimedAt: row.claimedAt?.toISOString() ?? null,
      };
    },
  );

  /**
   * GET /api/lens/:source/:id/ai-question — LLM-generated "hard question"
   * about the external paper, surfaced to the reader as a starting point
   * for engagement. Always marked AI in the UI (caller's responsibility).
   * Cached in Redis for 7 days keyed by (source, id) so we don't burn
   * tokens on every page-view.
   */
  app.get(
    '/lens/:source/:id/ai-question',
    {
      schema: { params: z.object({ source: sourceSchema, id: idSchema }) },
      config: { rateLimit: { max: 10, timeWindow: 60_000 } },
    },
    async (req) => {
      const enabled = await services.flags.isEnabled(FLAGS.OPENXIV_LENS, true);
      if (!enabled) throw Errors.notFound('lens disabled');
      const { source, id } = req.params as { source: 'arxiv'; id: string };
      const cacheKey = `lens:hq:${source}:${id}`;
      try {
        const cached = await ctx.redis.get(cacheKey);
        if (cached) return { question: cached, cached: true };
      } catch {
        // best-effort
      }
      const row = await ctx.repos.externalPapers.get(source, id);
      if (row.isErr() || !row.value) throw Errors.notFound('paper');
      const abstract = row.value.abstract ?? '';
      if (abstract.length < 80) {
        return { question: null, cached: false, reason: 'no_abstract' };
      }
      const prompt =
        `You are a skeptical scientific reviewer. Read the abstract below and ` +
        `produce ONE hard, specific question that a serious peer reviewer would ` +
        `ask — about the methodology, the claim's scope, or what evidence ` +
        `would actually establish it. Avoid generic questions and adjectives.\n\n` +
        `Title: ${row.value.title}\nAbstract: ${abstract}\n\n` +
        `Output JUST the question, no preamble.`;
      const result = await ctx.clients.llm.generateText(prompt, {
        maxTokens: 200,
        model: ctx.env.DEEPSEEK_MODEL_TEXT,
      });
      if (result.isErr()) {
        // LLM down — return null question, the page still renders.
        req.log.warn({ err: result.error.message }, 'hard-question generation failed');
        return { question: null, cached: false, reason: 'llm_unavailable' };
      }
      const text = result.value.trim().replace(/^"+|"+$/g, '').slice(0, 400);
      try {
        await ctx.redis.set(cacheKey, text, 'EX', 7 * 24 * 3600);
      } catch {
        // cache miss is non-fatal
      }
      return { question: text, cached: false };
    },
  );

  /**
   * POST /api/lens/:source/:id/claim — current user asserts ownership of
   * the external paper. For MVP this is best-effort: any authenticated user
   * can claim, and the row records who; verification (ORCID match against
   * arXiv's author list) is a Phase-2 nice-to-have.
   */
  app.post(
    '/lens/:source/:id/claim',
    {
      preHandler: app.requireAuth,
      schema: { params: z.object({ source: sourceSchema, id: idSchema }) },
    },
    async (req) => {
      if (!req.session) throw Errors.unauthorized();
      const enabled = await services.flags.isEnabled(FLAGS.OPENXIV_LENS, true);
      if (!enabled) throw Errors.notFound('lens disabled');
      const { source, id } = req.params as { source: 'arxiv'; id: string };
      const existing = await ctx.repos.externalPapers.get(source, id);
      if (existing.isErr()) throw existing.error;
      if (!existing.value) throw Errors.notFound('paper');
      if (existing.value.claimedByDid && existing.value.claimedByDid !== req.session.did) {
        throw Errors.conflict('already claimed by a different DID');
      }
      const claimed = await ctx.repos.externalPapers.claim(source, id, req.session.did);
      if (claimed.isErr()) throw claimed.error;
      return {
        source,
        sourceId: id,
        claimedByDid: claimed.value.claimedByDid,
        claimedAt: claimed.value.claimedAt?.toISOString() ?? null,
      };
    },
  );
}
