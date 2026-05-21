import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors, parseOpenxivId } from '@openxiv/shared';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Allowed labels on Seminar Thread posts. The author of the paper can mark
 * a post as `best_unresolved` to elevate the most useful open question; the
 * author or a mod can mark a post as `resolved_by_v2` once a new version
 * addresses the concern.
 */
const labelSchema = z.enum(['best_unresolved', 'resolved_by_v2']).nullable();

const newCommentSchema = z.object({
  text: z.string().min(1).max(2000),
});

export async function discussionRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const services = app.services;

  /**
   * Public Seminar Thread for a paper. Pinned post first, then chronological.
   * Hidden-by-mod posts are excluded; mods get the queue via ?queue=1 when
   * authenticated as admin.
   */
  app.get(
    '/papers/:id/discussion',
    {
      schema: {
        params: z.object({ id: z.string() }),
        querystring: z.object({ queue: z.coerce.boolean().optional() }),
      },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const { queue } = req.query as { queue?: boolean };
      const paperRow = await resolvePaper(id);
      if (!paperRow) throw Errors.notFound('paper');

      const isAdmin =
        req.session !== undefined &&
        req.session !== null &&
        services.users.isAdminDid(req.session.did);
      const includeHidden = Boolean(queue) && isAdmin;

      const paperUri = paperRow.uri;
      if (!paperUri) {
        // Paper hasn't been written to PDS yet — no posts can target it.
        return { items: [], canDiscuss: false, reason: 'paper-not-yet-bridged' };
      }

      const r = await ctx.repos.posts.forPaperUri(paperUri, { includeHidden, limit: 200 });
      if (r.isErr()) throw r.error;
      return {
        items: r.value.map((p) => ({
          id: p.id,
          uri: p.uri,
          authorDid: p.authorDid,
          text: p.text,
          label: p.label,
          pinnedByAuthor: p.pinnedByAuthor,
          hiddenByMod: p.hiddenByMod,
          createdAt: p.createdAt.toISOString(),
        })),
        canDiscuss: true,
        viewerCanModerate: isAdmin,
        viewerIsAuthor:
          req.session !== undefined && req.session !== null && req.session.did === paperRow.submitterDid,
      };
    },
  );

  /**
   * Add a comment to the seminar thread. Stored as `app.openxiv.post` with
   * `embed_paper_uri` set to the paper. Auth required.
   */
  app.post(
    '/papers/:id/discussion',
    {
      preHandler: app.requireAuth,
      schema: {
        params: z.object({ id: z.string() }),
        body: newCommentSchema,
      },
    },
    async (req) => {
      if (!req.session) throw Errors.unauthorized();
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof newCommentSchema>;
      const paperRow = await resolvePaper(id);
      if (!paperRow) throw Errors.notFound('paper');
      if (!paperRow.uri) {
        throw Errors.conflict('paper has not been bridged to PDS yet — cannot accept comments');
      }
      // Use the existing posts service if available; otherwise insert directly.
      // The plain insertion path lacks the AT-Proto write that bridges this
      // to Bluesky — fine for MVP, the comment lives locally and we'll mirror
      // in a later pass when the social bridge worker handles non-paper posts.
      const tid = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const uri = `at://${req.session.did}/app.openxiv.post/${tid}`;
      const created = await ctx.repos.posts.create({
        uri,
        cid: null,
        authorDid: req.session.did,
        text: body.text,
        replyRootUri: null,
        replyParentUri: null,
        embedPaperUri: paperRow.uri,
        embedExternal: null,
        tags: null,
        langs: null,
      });
      if (created.isErr()) throw created.error;
      return {
        id: created.value.id,
        uri: created.value.uri,
        text: created.value.text,
        createdAt: created.value.createdAt.toISOString(),
      };
    },
  );

  /**
   * Label a post (best_unresolved / resolved_by_v2 / clear). Only the paper
   * author or a mod can label.
   */
  app.patch(
    '/discussion/:postId/label',
    {
      preHandler: app.requireAuth,
      schema: {
        params: z.object({ postId: z.string().uuid() }),
        body: z.object({ label: labelSchema }),
      },
    },
    async (req) => {
      if (!req.session) throw Errors.unauthorized();
      const { postId } = req.params as { postId: string };
      const { label } = req.body as { label: z.infer<typeof labelSchema> };
      const post = await ctx.repos.posts.findById(postId);
      if (post.isErr() || !post.value) throw Errors.notFound('post');
      if (!post.value.embedPaperUri) throw Errors.conflict('post is not paper-scoped');
      const paper = await ctx.repos.papers.findByUri(post.value.embedPaperUri);
      if (paper.isErr() || !paper.value) throw Errors.notFound('paper');
      const isAuthor = paper.value.submitterDid === req.session.did;
      const isAdmin = services.users.isAdminDid(req.session.did);
      if (!isAuthor && !isAdmin) throw Errors.forbidden('only paper author or admin can label');
      const r = await ctx.repos.posts.setLabel(postId, label);
      if (r.isErr()) throw r.error;
      return { id: r.value.id, label: r.value.label };
    },
  );

  /** Pin or unpin a post. Author-only. Setting null unpins all on the paper. */
  app.patch(
    '/papers/:id/discussion/pin',
    {
      preHandler: app.requireAuth,
      schema: {
        params: z.object({ id: z.string() }),
        body: z.object({ postId: z.string().uuid().nullable() }),
      },
    },
    async (req) => {
      if (!req.session) throw Errors.unauthorized();
      const { id } = req.params as { id: string };
      const { postId } = req.body as { postId: string | null };
      const paperRow = await resolvePaper(id);
      if (!paperRow) throw Errors.notFound('paper');
      if (paperRow.submitterDid !== req.session.did) {
        throw Errors.forbidden('only the paper author can pin posts');
      }
      if (!paperRow.uri) throw Errors.conflict('paper has no uri');
      const r = await ctx.repos.posts.setPinned(paperRow.uri, postId);
      if (r.isErr()) throw r.error;
      return { ok: true };
    },
  );

  /** Hide or unhide a post. Admin-only — moderation queue action. */
  app.patch(
    '/discussion/:postId/hidden',
    {
      preHandler: app.requireAuth,
      schema: {
        params: z.object({ postId: z.string().uuid() }),
        body: z.object({ hidden: z.boolean() }),
      },
    },
    async (req) => {
      if (!req.session) throw Errors.unauthorized();
      if (!services.users.isAdminDid(req.session.did)) {
        throw Errors.forbidden('mod-only action');
      }
      const { postId } = req.params as { postId: string };
      const { hidden } = req.body as { hidden: boolean };
      const r = await ctx.repos.posts.setHidden(postId, hidden);
      if (r.isErr()) throw r.error;
      return { id: r.value.id, hidden: r.value.hiddenByMod };
    },
  );

  async function resolvePaper(id: string): Promise<{ id: string; submitterDid: string; uri: string | null } | null> {
    if (UUID_REGEX.test(id)) {
      const row = await ctx.repos.papers.findById(id);
      if (row.isErr()) throw row.error;
      return row.value;
    }
    const parsed = parseOpenxivId(id);
    if (!parsed) return null;
    const canonical = `openxiv:${parsed.subject}.${parsed.year}.${String(parsed.seq).padStart(5, '0')}`;
    const row = await ctx.repos.papers.findByOpenxivId(canonical);
    if (row.isErr()) throw row.error;
    return row.value;
  }
}
