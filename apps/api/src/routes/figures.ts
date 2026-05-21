import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';

/**
 * GET /papers/:id/figures
 *
 * Returns the latest-version figure gallery for a paper. Empty array
 * plus `extraction.status=complete` means the worker ran and found no
 * figures. Empty array with `pending` means the worker has not completed
 * yet. This distinction matters because many papers legitimately have
 * no figure assets.
 *
 * The paper page uses this to render thumbnails. The route is read-only
 * and cheap (single indexed query), so we don't bother with a Redis
 * cache — the materialised view route does, this one doesn't.
 *
 * Resolution:
 *   - UUID → papers.id
 *   - "openxiv:foo" / "foo" → papers.openxiv_id
 *
 * Mirror of /papers/:id/analytics resolution logic; kept inlined here
 * because both routes are tiny and abstracting would obscure them.
 */

const paramsSchema = z.object({
  id: z.string().min(1).max(64),
});

export async function figuresRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  app.get(
    '/papers/:id/figures',
    { schema: { params: paramsSchema } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const paperId = await resolvePaperId(ctx, id);
      if (paperId === null) {
        reply.status(404);
        return { kind: 'not_found' as const };
      }
      const r = await ctx.repos.paperFigures.forPaperLatest(paperId);
      if (r.isErr()) throw r.error;
      const extraction = await ctx.repos.paperFigures.extractionForPaperLatest(paperId);
      if (extraction.isErr()) throw extraction.error;
      reply.header('cache-control', 'public, max-age=60');
      return {
        figures: r.value.map((f) => ({
          idx: f.idx,
          imageUrl: f.imageUrl,
          caption: f.caption,
          page: f.page,
          type: f.type,
          version: f.version,
        })),
        extraction: extraction.value
          ? {
              status: 'complete' as const,
              source: extraction.value.source,
              reason: extraction.value.reason,
              figureCount: extraction.value.figureCount,
              completedAt: extraction.value.completedAt.toISOString(),
            }
          : { status: 'pending' as const },
      };
    },
  );
}

async function resolvePaperId(
  ctx: AppContext,
  identifier: string,
): Promise<string | null> {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(identifier)) {
    const r = await ctx.repos.papers.findById(identifier);
    if (r.isErr() || !r.value) return null;
    return r.value.id;
  }
  const a = await ctx.repos.papers.findByOpenxivId(`openxiv:${identifier}`);
  if (a.isOk() && a.value) return a.value.id;
  const b = await ctx.repos.papers.findByOpenxivId(identifier);
  if (b.isOk() && b.value) return b.value.id;
  return null;
}
