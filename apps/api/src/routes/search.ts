import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors } from '@openxiv/shared';

const querySchema = z.object({
  q: z.string().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  const services = app.services;
  const ctx = app.ctx;

  /**
   * Section-level semantic search. Returns highlighted snippets.
   *
   * Anonymous-accessible (a public preprint server needs anonymous search),
   * so we throttle aggressively per-IP and rely on the Redis-backed
   * SearchService cache to neutralise repeat queries without burning the
   * embedding budget. Per-day token cap is enforced inside SearchService.
   */
  app.get(
    '/search',
    {
      config: {
        rateLimit: {
          max: ctx.env.SEARCH_RATE_PER_IP_PER_MIN,
          timeWindow: 60_000,
          keyGenerator: (req: { ip: string }) => `search:${req.ip}`,
        },
      },
      schema: { querystring: querySchema },
    },
    async (req, reply) => {
      const { q, limit } = req.query as z.infer<typeof querySchema>;
      const result = await services.search.search(q, limit);
      if (result.isErr()) throw result.error;
      // Public cache hint — repeat queries from a CDN can also be served
      // from there for the duration of our Redis cache TTL.
      reply.header(
        'cache-control',
        `public, max-age=${Math.max(0, Math.floor(ctx.env.SEARCH_CACHE_TTL_SECONDS))}`,
      );
      return { q, count: result.value.length, results: result.value };
    },
  );

  /** Lookup by external identifier — used by the arXiv overlay extension. */
  app.get(
    '/lookup',
    {
      schema: {
        querystring: z.object({
          arxiv_id: z.string().optional(),
          doi: z.string().optional(),
        }),
      },
    },
    async (req, reply) => {
      const { arxiv_id, doi } = req.query as { arxiv_id?: string; doi?: string };
      if (!arxiv_id && !doi) throw Errors.validation('arxiv_id or doi required');
      reply.header('cache-control', 'public, max-age=120');
      if (doi) {
        const lookup = await ctx.repos.papers.findByDoi(doi);
        if (lookup.isErr()) throw lookup.error;
        const match = lookup.value;
        if (match) {
          return {
            id: match.id,
            openxivId: match.openxivId,
            openxivUrlId: match.openxivId?.replace(/^openxiv:/, '') ?? null,
          };
        }
      }
      // arxiv_id mapping is Phase-2; no index column yet.
      reply.status(404);
      return { id: null, reason: 'no matching paper indexed yet' };
    },
  );
}
