import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  FEED_DESCRIPTORS,
  FEED_NAMES,
  type FeedName,
  makeFeedSkeletonService,
} from '../services/feed-skeleton.js';

/**
 * Internal feed-skeleton API consumed by the feed-generator service. The
 * feed-generator is its own deployable; it calls these routes and forwards
 * the skeleton up to bsky's App View.
 *
 * The /feeds list is also surfaced on the public web at /feeds for one-click
 * subscribe (deep-link into bsky.app).
 */
export async function bskyFeedsRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const svc = makeFeedSkeletonService(ctx);

  /** Public: describe every feed we host. */
  app.get('/bsky/feeds', async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=300');
    return {
      did: ctx.env.PUBLIC_WEB_BASE.replace(/^https?:\/\//, 'did:web:').replace(/\/$/, ''),
      feeds: FEED_NAMES.map((n) => {
        const d = FEED_DESCRIPTORS[n];
        return {
          name: n,
          displayName: d.displayName,
          description: d.description,
        };
      }),
    };
  });

  /** Internal: a single feed's skeleton. Cursor + limit pagination. */
  app.get(
    '/bsky/feeds/:feed/skeleton',
    {
      schema: {
        params: z.object({ feed: z.string() }),
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(100).optional(),
          cursor: z.string().max(64).optional(),
        }),
      },
    },
    async (req, reply) => {
      const { feed } = req.params as { feed: string };
      const { limit, cursor } = req.query as { limit?: number; cursor?: string };
      const resolved = svc.resolve(feed) as FeedName | null;
      if (!resolved) {
        reply.status(404);
        return { error: 'UnknownFeed', message: `unknown feed: ${feed}` };
      }
      const result = await svc.getSkeleton({
        feed: resolved,
        ...(limit !== undefined ? { limit } : {}),
        ...(cursor !== undefined ? { cursor } : {}),
      });
      if (result.isErr()) throw result.error;
      reply.header('cache-control', 'public, max-age=60');
      return result.value;
    },
  );
}
