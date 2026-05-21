import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { BskyLabelValue } from '@openxiv/db';

const VALID_VALS: readonly BskyLabelValue[] = [
  'openxiv-paper',
  'high-disclosure',
  'needs-question',
];

/**
 * AT-proto Labeler service. Implements the read side of
 * `com.atproto.label.queryLabels` so a Bluesky client can fetch the labels
 * OpenXiv has emitted over `app.bsky.feed.post` URIs that mention or quote an
 * OpenXiv paper. The write side (apply/negate) is invoked by the jetstream
 * worker and the admin endpoints below — there is intentionally no public
 * write API, since labels are derived signals, not user-submitted content.
 *
 * The labeler signs labels with the configured labeler key in production;
 * here we ship them unsigned (sig=null) — `com.atproto.label.queryLabels`
 * permits unsigned labels, but a subscription-based labeler would need full
 * sig support before federating.
 */
export async function bskyLabelerRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const labelerDid = ctx.env.PUBLIC_WEB_BASE.replace(/^https?:\/\//, 'did:web:').replace(/\/$/, '');

  app.get(
    '/xrpc/com.atproto.label.queryLabels',
    {
      schema: {
        querystring: z.object({
          uriPatterns: z.union([z.string(), z.array(z.string())]).optional(),
          sources: z.union([z.string(), z.array(z.string())]).optional(),
          limit: z.coerce.number().int().min(1).max(250).optional(),
          cursor: z.string().max(64).optional(),
        }),
      },
    },
    async (req, reply) => {
      const { uriPatterns: rawPatterns } = req.query as {
        uriPatterns?: string | string[];
        sources?: string | string[];
      };
      const patterns = Array.isArray(rawPatterns)
        ? rawPatterns
        : rawPatterns
          ? [rawPatterns]
          : [];
      if (patterns.length === 0) {
        return { cursor: undefined, labels: [] };
      }
      const result = await ctx.repos.bskyLabels.query({ uriPatterns: patterns });
      if (result.isErr()) throw result.error;
      reply.header('cache-control', 'public, max-age=60');
      return {
        cursor: undefined,
        labels: result.value.map((l) => ({
          ver: 1,
          src: l.src,
          uri: l.uri,
          ...(l.cid ? { cid: l.cid } : {}),
          val: l.val,
          neg: l.neg,
          cts: l.cts.toISOString(),
        })),
      };
    },
  );

  /** Admin-only: apply a label by hand. Useful for backfill / curation. */
  app.post(
    '/api/admin/bsky/labels/apply',
    {
      schema: {
        body: z.object({
          uri: z.string().startsWith('at://'),
          cid: z.string().optional(),
          val: z.enum(VALID_VALS as readonly [BskyLabelValue, ...BskyLabelValue[]]),
        }),
      },
    },
    async (req, reply) => {
      if (!isAdmin(ctx, req.session?.did ?? null)) {
        reply.status(403);
        return { error: 'forbidden', message: 'admin only' };
      }
      const { uri, cid, val } = req.body as { uri: string; cid?: string; val: BskyLabelValue };
      const result = await ctx.repos.bskyLabels.apply({ src: labelerDid, uri, val, ...(cid ? { cid } : {}) });
      if (result.isErr()) throw result.error;
      return { applied: result.value };
    },
  );

  app.post(
    '/api/admin/bsky/labels/negate',
    {
      schema: {
        body: z.object({
          uri: z.string().startsWith('at://'),
          val: z.enum(VALID_VALS as readonly [BskyLabelValue, ...BskyLabelValue[]]),
        }),
      },
    },
    async (req, reply) => {
      if (!isAdmin(ctx, req.session?.did ?? null)) {
        reply.status(403);
        return { error: 'forbidden', message: 'admin only' };
      }
      const { uri, val } = req.body as { uri: string; val: BskyLabelValue };
      const result = await ctx.repos.bskyLabels.negate({ src: labelerDid, uri, val });
      if (result.isErr()) throw result.error;
      return { ok: true };
    },
  );

  app.get('/api/admin/bsky/labels/stats', async (req, reply) => {
    if (!isAdmin(ctx, req.session?.did ?? null)) {
      reply.status(403);
      return { error: 'forbidden', message: 'admin only' };
    }
    const result = await ctx.repos.bskyLabels.countByVal();
    if (result.isErr()) throw result.error;
    return result.value;
  });
}

function isAdmin(ctx: { env: { ADMIN_DIDS: readonly string[] } }, did: string | null): boolean {
  if (!did) return false;
  return ctx.env.ADMIN_DIDS.includes(did);
}
