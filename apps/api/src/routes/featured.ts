import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors } from '@openxiv/shared';
import { FEATURED_TARGET_TYPES } from '@openxiv/db';
import { renderSafeMarkdown } from '../services/markdown-safe.js';
import { FLAGS } from '../services/flags.js';

const createSchema = z.object({
  targetUri: z.string().min(1).max(500),
  targetType: z.enum(FEATURED_TARGET_TYPES),
  reasonCardMd: z.string().min(80).max(4000),
  position: z.number().int().min(0).max(1000).default(0),
  expiresAt: z
    .string()
    .datetime({ offset: true })
    .transform((s) => new Date(s))
    .optional()
    .nullable(),
});

const updateSchema = z.object({
  targetUri: z.string().min(1).max(500).optional(),
  targetType: z.enum(FEATURED_TARGET_TYPES).optional(),
  reasonCardMd: z.string().min(80).max(4000).optional(),
  position: z.number().int().min(0).max(1000).optional(),
  expiresAt: z
    .string()
    .datetime({ offset: true })
    .transform((s) => new Date(s))
    .nullable()
    .optional(),
  startedAt: z
    .string()
    .datetime({ offset: true })
    .transform((s) => new Date(s))
    .optional(),
});

export async function featuredRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const services = app.services;

  /**
   * Public list of currently-active featured items. Pre-rendered reason
   * HTML is included so the homepage doesn't need to ship a markdown
   * renderer to clients.
   */
  app.get('/featured', async (req, reply) => {
    const enabled = await services.flags.isEnabled(FLAGS.FEATURED, true);
    if (!enabled) {
      reply.header('cache-control', 'public, max-age=60');
      return { items: [] };
    }
    const r = await ctx.repos.featured.listActive(12);
    if (r.isErr()) throw r.error;
    reply.header('cache-control', 'public, max-age=60');
    return {
      items: r.value.map((row) => ({
        id: row.id,
        targetUri: row.targetUri,
        targetType: row.targetType,
        reasonCardMd: row.reasonCardMd,
        reasonCardHtml: renderSafeMarkdown(row.reasonCardMd),
        curatorDid: row.curatorDid,
        position: row.position,
        startedAt: row.startedAt.toISOString(),
        expiresAt: row.expiresAt?.toISOString() ?? null,
      })),
    };
  });

  /** Admin list — includes expired. */
  app.get(
    '/admin/featured',
    { preHandler: app.requireAuth },
    async (req) => {
      if (!req.session) throw Errors.unauthorized();
      if (!services.users.isAdminDid(req.session.did)) throw Errors.forbidden('admin only');
      const r = await ctx.repos.featured.listAll(200);
      if (r.isErr()) throw r.error;
      return {
        items: r.value.map((row) => ({
          id: row.id,
          targetUri: row.targetUri,
          targetType: row.targetType,
          reasonCardMd: row.reasonCardMd,
          curatorDid: row.curatorDid,
          position: row.position,
          startedAt: row.startedAt.toISOString(),
          expiresAt: row.expiresAt?.toISOString() ?? null,
        })),
      };
    },
  );

  app.post(
    '/admin/featured',
    {
      preHandler: app.requireAuth,
      schema: { body: createSchema },
    },
    async (req) => {
      if (!req.session) throw Errors.unauthorized();
      if (!services.users.isAdminDid(req.session.did)) throw Errors.forbidden('admin only');
      const body = createSchema.parse(req.body);
      const r = await ctx.repos.featured.create({
        targetUri: body.targetUri,
        targetType: body.targetType,
        reasonCardMd: body.reasonCardMd,
        curatorDid: req.session.did,
        position: body.position,
        expiresAt: body.expiresAt ?? null,
      });
      if (r.isErr()) throw r.error;
      return { id: r.value.id };
    },
  );

  app.patch(
    '/admin/featured/:id',
    {
      preHandler: app.requireAuth,
      schema: { params: z.object({ id: z.string().uuid() }), body: updateSchema },
    },
    async (req) => {
      if (!req.session) throw Errors.unauthorized();
      if (!services.users.isAdminDid(req.session.did)) throw Errors.forbidden('admin only');
      const { id } = req.params as { id: string };
      const body = updateSchema.parse(req.body);
      const r = await ctx.repos.featured.update(id, body);
      if (r.isErr()) throw r.error;
      return { id: r.value.id };
    },
  );

  app.delete(
    '/admin/featured/:id',
    { preHandler: app.requireAuth, schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      if (!req.session) throw Errors.unauthorized();
      if (!services.users.isAdminDid(req.session.did)) throw Errors.forbidden('admin only');
      const { id } = req.params as { id: string };
      const r = await ctx.repos.featured.remove(id);
      if (r.isErr()) throw r.error;
      return { ok: true };
    },
  );
}
