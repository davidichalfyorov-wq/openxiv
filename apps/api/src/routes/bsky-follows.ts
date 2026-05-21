import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isFeatureEnabled } from '../services/flags.js';
import { Errors } from '@openxiv/shared';
import type { UserRecord } from '@openxiv/db';
import { enqueueBskyFollowJob } from '../services/bsky-follow-queue.js';

interface BskyGetFollowsResponse {
  cursor?: string;
  follows: Array<{
    did: string;
    handle?: string;
    displayName?: string;
  }>;
}

/**
 * Import the signed-in user's Bluesky follow graph. The endpoint is
 * authenticated; it uses the user's restored OAuth session to call
 * `app.bsky.graph.getFollows` against their PDS, then bulk-upserts results
 * into the local mirror.
 *
 * - Idempotent: calling twice in a row is fine; rows update in place.
 * - Opt-out: `DELETE /api/me/bluesky/follows` forgets all mirrored rows.
 * - Rate-limited at the API gateway via the global limiter (300/min).
 */
export async function bskyFollowsRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  async function getBlueskyUser(
    req: { session?: { uid: string } },
  ): Promise<UserRecord & { blueskyDid: string }> {
    const session = req.session;
    if (!session) throw Errors.unauthorized();
    const userResult = await ctx.repos.users.findById(session.uid);
    if (userResult.isErr()) throw userResult.error;
    const user = userResult.value;
    if (!user || !user.blueskyDid) {
      throw Errors.forbidden('Bluesky account is not linked');
    }
    return user as UserRecord & { blueskyDid: string };
  }

  app.post('/me/bluesky/follows/import', async (req, reply) => {
    const session = req.session;
    if (!session) {
      reply.status(401);
      return { error: 'unauthenticated' };
    }
    if (!(await isFeatureEnabled(ctx, 'bluesky_follows', true))) {
      reply.status(503);
      return { error: 'feature_disabled' };
    }
    // The session DID may be a bluesky DID directly, or an ORCID/Google user
    // who linked Bluesky. Either way: only if `users.blueskyDid` is set do
    // we have a credential to use.
    // Session JWT carries the canonical user UUID. Avoid findByDid here:
    // after a Bluesky link rotates the primary DID, the cookie still
    // holds the old did:web form, which lives only in legacy_dids.
    const userResult = await ctx.repos.users.findById(session.uid);
    if (userResult.isErr()) throw userResult.error;
    const user = userResult.value;
    if (!user || !user.blueskyDid) {
      reply.status(412);
      return { error: 'no_bluesky_link', message: 'sign in via Bluesky first' };
    }
    const sessionResult = await ctx.clients.bluesky.restoreSession(user.blueskyDid);
    if (sessionResult.isErr()) {
      reply.status(503);
      return { error: 'session_unavailable', message: sessionResult.error.message };
    }
    const agentSession = sessionResult.value;

    // Page through getFollows. Bluesky returns up to 100 at a time; cap total
    // pages so a malicious user can't run us forever.
    const MAX_PAGES = 50; // 5000 follows max
    let cursor: string | undefined;
    const all: Array<{ did: string; handle?: string; displayName?: string }> = [];
    for (let i = 0; i < MAX_PAGES; i++) {
      const query: Record<string, string> = { actor: user.blueskyDid, limit: '100' };
      if (cursor) query['cursor'] = cursor;
      const page = await agentSession.get<BskyGetFollowsResponse>(
        'app.bsky.graph.getFollows',
        query,
      );
      if (page.isErr()) {
        reply.status(502);
        return { error: 'bsky_unavailable', message: page.error.message };
      }
      for (const f of page.value.follows) {
        all.push({
          did: f.did,
          ...(f.handle ? { handle: f.handle } : {}),
          ...(f.displayName ? { displayName: f.displayName } : {}),
        });
      }
      if (!page.value.cursor) break;
      cursor = page.value.cursor;
    }

    const inserted = await ctx.repos.bskyFollows.upsertFollows({
      followerDid: user.blueskyDid,
      follows: all,
    });
    if (inserted.isErr()) throw inserted.error;
    return { count: inserted.value.inserted, capped: all.length >= MAX_PAGES * 100 };
  });

  app.get('/me/bsky-follows', async (req, reply) => {
    try {
      const user = await getBlueskyUser(req);
      const rows = await ctx.repos.bskyFollows.list(user.blueskyDid, 500);
      if (rows.isErr()) throw rows.error;
      return {
        items: rows.value.map((r) => ({
          did: r.followingDid,
          handle: r.followingHandle,
          displayName: r.followingDisplayName,
          fetchedAt: r.fetchedAt.toISOString(),
        })),
      };
    } catch (err) {
      if (err instanceof Error && 'kind' in err && (err as { kind?: string }).kind === 'unauthorized') {
        reply.status(401);
        return { items: [] };
      }
      throw err;
    }
  });

  app.post(
    '/me/bluesky/follows',
    {
      schema: {
        body: z.object({
          did: z.string().startsWith('did:'),
          handle: z.string().optional(),
          displayName: z.string().optional(),
        }),
      },
    },
    async (req, reply) => {
      const user = await getBlueskyUser(req);
      const { did, handle, displayName } = req.body as {
        did: string;
        handle?: string;
        displayName?: string;
      };
      const queued = await enqueueBskyFollowJob(ctx, user, {
        action: 'follow',
        targetDid: did,
        handle: handle ?? null,
        displayName: displayName ?? null,
      });
      reply.status(202);
      return { ok: true, ...queued };
    },
  );

  app.delete(
    '/me/bluesky/follows/:did',
    {
      schema: { params: z.object({ did: z.string().startsWith('did:') }) },
    },
    async (req, reply) => {
      const user = await getBlueskyUser(req);
      const { did } = req.params as { did: string };
      const queued = await enqueueBskyFollowJob(ctx, user, {
        action: 'unfollow',
        targetDid: did,
      });
      reply.status(202);
      return { ok: true, ...queued };
    },
  );

  app.delete('/me/bluesky/follows', async (req, reply) => {
    const session = req.session;
    if (!session) {
      reply.status(401);
      return { error: 'unauthenticated' };
    }
    // Session JWT carries the canonical user UUID. Avoid findByDid here:
    // after a Bluesky link rotates the primary DID, the cookie still
    // holds the old did:web form, which lives only in legacy_dids.
    const userResult = await ctx.repos.users.findById(session.uid);
    if (userResult.isErr()) throw userResult.error;
    const user = userResult.value;
    if (!user || !user.blueskyDid) {
      return { count: 0 };
    }
    const cleared = await ctx.repos.bskyFollows.forget(user.blueskyDid);
    if (cleared.isErr()) throw cleared.error;
    return { count: -1 };
  });

  /**
   * Public: given a candidate DID, does the *viewer* follow that DID on
   * Bluesky? Returns just a boolean — used on /u/{handle} pages to surface
   * "you follow on Bluesky" without leaking the viewer's full follow list.
   */
  app.get(
    '/me/bluesky/follows/check',
    {
      schema: {
        querystring: z.object({
          did: z.string().startsWith('did:'),
        }),
      },
    },
    async (req, reply) => {
      const session = req.session;
      if (!session) return { follows: false };
      // Session JWT carries the canonical user UUID. Avoid findByDid here:
      // after a Bluesky link rotates the primary DID, the cookie still
      // holds the old did:web form, which lives only in legacy_dids.
      const userResult = await ctx.repos.users.findById(session.uid);
      if (userResult.isErr() || !userResult.value?.blueskyDid) return { follows: false };
      const { did } = req.query as { did: string };
      const r = await ctx.repos.bskyFollows.follows(userResult.value.blueskyDid, [did]);
      if (r.isErr()) {
        reply.status(503);
        return { follows: false, error: 'lookup_failed' };
      }
      return { follows: r.value.includes(did) };
    },
  );
}
