import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  FEED_DESCRIPTORS,
  FEED_NAMES,
  type FeedName,
  makeFeedSkeletonService,
} from '../services/feed-skeleton.js';

export function bskyFeedGeneratorDid(publicBase: string): string {
  return publicBase.replace(/^https?:\/\//, 'did:web:').replace(/\/$/, '');
}

export function feedNameFromUri(uri: string): FeedName | null {
  if ((FEED_NAMES as readonly string[]).includes(uri)) return uri as FeedName;
  const m = /^at:\/\/[^/]+\/app\.bsky\.feed\.generator\/(?<name>[^/]+)$/.exec(uri);
  const name = m?.groups?.['name'];
  if (name && (FEED_NAMES as readonly string[]).includes(name)) return name as FeedName;
  return null;
}

export async function bskyFeedGeneratorRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const svc = makeFeedSkeletonService(ctx);
  const did = bskyFeedGeneratorDid(ctx.env.PUBLIC_WEB_BASE);

  app.get('/xrpc/app.bsky.feed.describeFeedGenerator', async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=300');
    return {
      did,
      feeds: FEED_NAMES.map((name) => {
        const descriptor = FEED_DESCRIPTORS[name];
        return {
          uri: `at://${did}/app.bsky.feed.generator/${name}`,
          displayName: descriptor.displayName,
          description: descriptor.description,
        };
      }),
    };
  });

  app.get(
    '/xrpc/app.bsky.feed.getFeedSkeleton',
    {
      schema: {
        querystring: z.object({
          feed: z.string().min(1),
          limit: z.coerce.number().int().min(1).max(100).optional(),
          cursor: z.string().max(64).optional(),
        }),
      },
    },
    async (req, reply) => {
      const { feed, limit, cursor } = req.query as {
        feed: string;
        limit?: number;
        cursor?: string;
      };
      const name = feedNameFromUri(feed);
      if (!name) {
        reply.status(400);
        return { error: 'UnknownFeed', message: `unknown feed: ${feed}` };
      }
      const result = await svc.getSkeleton({
        feed: name,
        ...(limit !== undefined ? { limit } : {}),
        ...(cursor !== undefined ? { cursor } : {}),
      });
      if (result.isErr()) throw result.error;
      reply.header('cache-control', 'public, max-age=60');
      return result.value;
    },
  );
}
