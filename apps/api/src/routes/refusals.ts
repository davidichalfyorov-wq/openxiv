import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors, parseOpenxivId } from '@openxiv/shared';
import { REFUSAL_REASON_VALUES, type RefusalExample } from '@openxiv/db';
import { resolveModerationActor } from '../services/moderation.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const exampleSchema = z.object({
  section: z.string().max(100).optional(),
  problem: z.string().min(1).max(500),
  suggestion: z.string().max(500).optional(),
});

const refusalBodySchema = z.object({
  reasonCategory: z.enum(REFUSAL_REASON_VALUES),
  fixable: z.boolean(),
  examples: z.array(exampleSchema).max(20),
  moderatorNote: z.string().min(1).max(4000),
});

export async function refusalsRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const services = app.services;

  /**
   * Public refusal packet. Anyone can read — refusal transparency is the
   * whole point. Returns 404 if no packet exists (i.e., the paper is not
   * refused, or refused without a structured packet).
   */
  app.get(
    '/papers/:id/refusal',
    { schema: { params: z.object({ id: z.string() }) } },
    async (req) => {
      const { id } = req.params as { id: string };
      const paperRow = await resolvePaper(id);
      if (!paperRow) throw Errors.notFound('paper');
      const r = await ctx.repos.refusals.getByPaperId(paperRow.id);
      if (r.isErr()) throw r.error;
      if (!r.value) throw Errors.notFound('refusal packet');
      return {
        paperId: paperRow.id,
        reasonCategory: r.value.reasonCategory,
        fixable: r.value.fixable,
        examples: r.value.examples as RefusalExample[],
        moderatorNote: r.value.moderatorNote,
        issuedByDid: r.value.issuedByDid,
        issuedAt: r.value.issuedAt.toISOString(),
        rescindedAt: r.value.rescindedAt?.toISOString() ?? null,
      };
    },
  );

  /**
   * Issue (or update) a refusal packet. Admin-only. Also sets the paper
   * status to `withdrawn` so it's hidden from feeds and the homepage.
   */
  app.post(
    '/papers/:id/refusal',
    {
      preHandler: app.requireAuth,
      schema: {
        params: z.object({ id: z.string() }),
        body: refusalBodySchema,
      },
    },
    async (req) => {
      if (!req.session) throw Errors.unauthorized();
      const actor = await resolveModerationActor(services, req.session);
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof refusalBodySchema>;
      const paperRow = await resolvePaper(id);
      if (!paperRow) throw Errors.notFound('paper');

      const upserted = await ctx.repos.refusals.upsert({
        paperId: paperRow.id,
        reasonCategory: body.reasonCategory,
        fixable: body.fixable,
        examples: body.examples,
        moderatorNote: body.moderatorNote,
        issuedByDid: actor.did,
      });
      if (upserted.isErr()) throw upserted.error;

      // Mark the paper withdrawn so list endpoints and the home feed stop
      // serving it. The packet remains visible at /abs/{id}/refusal even
      // after withdrawal — that's the whole point of "transparency".
      const setStatus = await ctx.repos.papers.setStatus(paperRow.id, 'withdrawn');
      if (setStatus.isErr()) throw setStatus.error;

      return {
        paperId: paperRow.id,
        reasonCategory: upserted.value.reasonCategory,
        fixable: upserted.value.fixable,
        issuedAt: upserted.value.issuedAt.toISOString(),
      };
    },
  );

  /** Rescind a refusal — marks the packet as withdrawn but keeps the record. */
  app.delete(
    '/papers/:id/refusal',
    {
      preHandler: app.requireAuth,
      schema: { params: z.object({ id: z.string() }) },
    },
    async (req) => {
      if (!req.session) throw Errors.unauthorized();
      await resolveModerationActor(services, req.session);
      const { id } = req.params as { id: string };
      const paperRow = await resolvePaper(id);
      if (!paperRow) throw Errors.notFound('paper');
      const r = await ctx.repos.refusals.rescind(paperRow.id);
      if (r.isErr()) throw r.error;
      return { ok: true };
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
