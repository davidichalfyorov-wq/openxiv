import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors } from '@openxiv/shared';

export async function followsRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;

  app.post(
    '/follows',
    {
      preHandler: app.requireAuth,
      schema: { body: z.object({ targetDid: z.string() }) },
    },
    async (req, reply) => {
      if (!req.session) throw Errors.unauthorized();
      const { targetDid } = req.body as { targetDid: string };
      if (targetDid === req.session.did) {
        throw Errors.validation('cannot follow yourself');
      }
      const result = await ctx.repos.follows.follow({
        followerDid: req.session.did,
        targetDid,
      });
      if (result.isErr()) throw result.error;
      reply.status(201);
      return { ok: true };
    },
  );

  app.delete(
    '/follows/:targetDid',
    {
      preHandler: app.requireAuth,
      schema: { params: z.object({ targetDid: z.string() }) },
    },
    async (req) => {
      if (!req.session) throw Errors.unauthorized();
      const { targetDid } = req.params as { targetDid: string };
      const result = await ctx.repos.follows.unfollow(req.session.did, targetDid);
      if (result.isErr()) throw result.error;
      return { ok: true };
    },
  );

  app.get(
    '/profiles/:did/follows',
    { schema: { params: z.object({ did: z.string() }) } },
    async (req) => {
      const { did } = req.params as { did: string };
      const result = await ctx.repos.follows.followingDids(did);
      if (result.isErr()) throw result.error;
      return { following: result.value };
    },
  );
}
