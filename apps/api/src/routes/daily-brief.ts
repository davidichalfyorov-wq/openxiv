import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors } from '@openxiv/shared';
import { composeDailyBrief, type BriefComposition } from '../services/daily-brief.js';
import { FLAGS } from '../services/flags.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function dailyBriefRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const services = app.services;

  app.get('/daily-brief', async (req, reply) => {
    const enabled = await services.flags.isEnabled(FLAGS.DAILY_BRIEF, true);
    if (!enabled) {
      reply.header('cache-control', 'public, max-age=60');
      return emptyBrief();
    }
    const brief = await composeDailyBrief(ctx);
    reply.header('cache-control', 'public, max-age=600');
    return brief;
  });

  app.get(
    '/daily-brief/:date',
    { schema: { params: z.object({ date: z.string().regex(DATE_RE) }) } },
    async (req, reply) => {
      const { date } = req.params as { date: string };
      const r = await ctx.repos.dailyBriefs.get(date);
      if (r.isErr()) throw r.error;
      if (!r.value) throw Errors.notFound('no snapshot for ' + date);
      reply.header('cache-control', 'public, max-age=86400');
      return {
        date,
        items: r.value.itemsJson as BriefComposition['items'],
        generatedAt: r.value.snapshotAt.toISOString(),
      };
    },
  );

  app.post(
    '/admin/daily-brief/snapshot',
    { preHandler: app.requireAuth },
    async (req) => {
      if (!req.session) throw Errors.unauthorized();
      if (!services.users.isAdminDid(req.session.did)) throw Errors.forbidden('admin only');
      const brief = await composeDailyBrief(ctx);
      const r = await ctx.repos.dailyBriefs.upsert(brief.date, brief.items);
      if (r.isErr()) throw r.error;
      return { ok: true, date: brief.date };
    },
  );
}

function emptyBrief(): BriefComposition {
  const date = new Date().toISOString().slice(0, 10);
  return {
    date,
    items: [
      { kind: 'featured', present: false, title: null, href: null, blurb: 'Daily Brief paused by ops.' },
      { kind: 'claim', present: false, title: null, href: null, blurb: 'Daily Brief paused by ops.' },
      { kind: 'open_question', present: false, title: null, href: null, blurb: 'Daily Brief paused by ops.' },
      { kind: 'explainer', present: false, title: null, href: null, blurb: 'Daily Brief paused by ops.' },
      { kind: 'serendipity', present: false, title: null, href: null, blurb: 'Daily Brief paused by ops.' },
    ],
    generatedAt: new Date().toISOString(),
  };
}
