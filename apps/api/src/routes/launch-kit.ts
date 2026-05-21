import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors, parseOpenxivId } from '@openxiv/shared';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const launchKitSchema = z.object({
  bridgeThread: z.array(z.string().max(300)).max(5).optional(),
  reviewerInvites: z.array(z.string().max(400)).max(10).optional(),
  figureAltText: z.record(z.string(), z.string().max(500)).optional(),
  claimCards: z
    .array(z.object({ headline: z.string().min(1).max(140), supporting: z.string().max(500) }))
    .max(5)
    .optional(),
});

const patchSchema = z.object({
  oneHardQuestion: z.string().max(400).nullable().optional(),
  launchKit: launchKitSchema.nullable().optional(),
});

export async function launchKitRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const services = app.services;

  app.patch(
    '/papers/:id/launch-kit',
    {
      preHandler: app.requireAuth,
      schema: { params: z.object({ id: z.string() }), body: patchSchema },
    },
    async (req) => {
      if (!req.session) throw Errors.unauthorized();
      const { id } = req.params as { id: string };
      const body = patchSchema.parse(req.body);
      const paperRow = await resolvePaper(id);
      if (!paperRow) throw Errors.notFound('paper');
      const isAuthor = paperRow.submitterDid === req.session.did;
      const isAdmin = services.users.isAdminDid(req.session.did);
      if (!isAuthor && !isAdmin) throw Errors.forbidden('only paper author or admin');

      const r = await ctx.repos.papers.setLaunchKit(paperRow.id, {
        ...(body.oneHardQuestion !== undefined ? { oneHardQuestion: body.oneHardQuestion ?? null } : {}),
        ...(body.launchKit !== undefined ? { launchKit: body.launchKit ?? null } : {}),
      });
      if (r.isErr()) throw r.error;
      return {
        oneHardQuestion: r.value.oneHardQuestion,
        launchKit: r.value.launchKit,
      };
    },
  );

  async function resolvePaper(id: string): Promise<{ id: string; submitterDid: string } | null> {
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
