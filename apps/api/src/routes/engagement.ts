import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors } from '@openxiv/shared';
import { getEngagement, resolveEngagementPaperId } from '../services/engagement-stats.js';

const paramsSchema = z.object({
  id: z.string().min(1).max(256),
});

export async function engagementRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  app.get(
    '/papers/:id/engagement',
    { schema: { params: paramsSchema } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const paperId = await resolveEngagementPaperId(ctx, id);
      if (!paperId) throw Errors.notFound('paper');
      const payload = await getEngagement(ctx, paperId);
      reply.header('cache-control', 'public, max-age=60');
      return payload;
    },
  );
}
