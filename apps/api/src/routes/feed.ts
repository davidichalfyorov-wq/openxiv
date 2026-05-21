import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors, openxivIdToUrl } from '@openxiv/shared';
import type { FeedItem } from '../services/feed.js';
import type { UserRecord } from '@openxiv/db';

export async function feedRoutes(app: FastifyInstance): Promise<void> {
  const services = app.services;

  app.get(
    '/feed/home',
    {
      schema: { querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }) },
    },
    async (req) => {
      const { limit } = req.query as { limit: number };
      const viewerDid = req.session?.did ?? null;
      const result = await services.feed.homeFeed(viewerDid, limit);
      if (result.isErr()) throw result.error;
      return { items: result.value.map(serializeItem) };
    },
  );

  app.get(
    '/profiles/:did/stream',
    {
      schema: {
        params: z.object({ did: z.string() }),
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }),
      },
    },
    async (req) => {
      const { did } = req.params as { did: string };
      const { limit } = req.query as { limit: number };
      const result = await services.feed.profileStream(did, limit);
      if (result.isErr()) throw result.error;
      return { items: result.value.map(serializeItem) };
    },
  );

  app.get(
    '/feed/bsky',
    {
      preHandler: app.requireAuth,
      schema: {
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(100).default(30),
          cursor: z.string().max(512).optional(),
        }),
      },
    },
    async (req) => {
      if (!req.session) throw Errors.unauthorized();
      const { limit, cursor } = req.query as { limit: number; cursor?: string };
      const userResult = await app.ctx.repos.users.findById(req.session.uid);
      if (userResult.isErr()) throw userResult.error;
      const user = userResult.value;
      if (!user) throw Errors.unauthorized();
      const blueskyDid = resolveBlueskyDidForFeed(user);
      if (!blueskyDid) throw Errors.forbidden('Bluesky account is not linked');
      const session = await app.ctx.clients.bluesky.restoreSession(blueskyDid);
      if (session.isErr()) throw session.error;
      const timeline = await session.value.get<Record<string, unknown>>('app.bsky.feed.getTimeline', {
        limit: String(limit),
        ...(cursor ? { cursor } : {}),
      });
      if (timeline.isErr()) throw timeline.error;
      return timeline.value;
    },
  );
}

export function resolveBlueskyDidForFeed(user: UserRecord): string | null {
  return user.blueskyDid ?? (user.did.startsWith('did:plc:') ? user.did : null);
}

export function serializeItem(item: FeedItem): Record<string, unknown> {
  if (item.kind === 'paper') {
    const authorNames = item.authors
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((a) => a.displayName.trim())
      .filter(Boolean);
    return {
      kind: 'paper',
      createdAt: item.createdAt.toISOString(),
      trustPassport: item.trustPassport,
      paper: {
        id: item.paper.id,
        uri: item.paper.uri,
        openxivId: item.paper.openxivId,
        openxivUrlId: item.paper.openxivId ? openxivIdToUrl(item.paper.openxivId) : null,
        title: item.paper.title,
        primaryCategory: item.paper.primaryCategory,
        crossListings: item.paper.crossListings ?? [],
        submitterDid: item.paper.submitterDid,
        status: item.paper.status,
        publishedAt: item.paper.publishedAt?.toISOString() ?? null,
        createdAt: item.paper.createdAt.toISOString(),
        authorNames,
        authorLine: formatAuthorLine(authorNames),
      },
    };
  }
  return {
    kind: 'post',
    createdAt: item.createdAt.toISOString(),
    post: {
      id: item.post.id,
      uri: item.post.uri,
      authorDid: item.post.authorDid,
      text: item.post.text,
      embedPaperUri: item.post.embedPaperUri,
    },
  };
}

function formatAuthorLine(authorNames: readonly string[]): string {
  if (authorNames.length === 0) return 'OpenXiv author';
  if (authorNames.length <= 3) return authorNames.join(', ');
  return `${authorNames.slice(0, 3).join(', ')} et al.`;
}
