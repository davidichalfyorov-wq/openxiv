import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  applyModerationDecision,
  listPendingModeration,
  moderationDecisionSchema,
  resolveModerationActor,
} from '../services/moderation.js';

export async function moderationRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const services = app.services;

  app.get('/admin/moderation', { preHandler: app.requireAuth }, async (req) => {
    const actor = await resolveModerationActor(services, req.session);
    const pending = await listPendingModeration(ctx);
    if (pending.isErr()) throw pending.error;
    return {
      actor,
      items: pending.value,
    };
  });

  app.post(
    '/admin/moderation/papers/:id/decision',
    {
      preHandler: app.requireAuth,
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: moderationDecisionSchema,
      },
    },
    async (req) => {
      const actor = await resolveModerationActor(services, req.session);
      const { id } = req.params as { id: string };
      const decision = moderationDecisionSchema.parse(req.body);
      const result = await applyModerationDecision(ctx, {
        paperId: id,
        actorDid: actor.did,
        decision,
      });
      if (result.isErr()) throw result.error;
      return { ok: true, ...result.value };
    },
  );
}
