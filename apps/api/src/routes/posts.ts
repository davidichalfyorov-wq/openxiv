import type { FastifyInstance } from 'fastify';
import { Errors } from '@openxiv/shared';
import { z } from 'zod';

const createSchema = z.object({
  text: z.string().min(1).max(3000),
  replyParentUri: z.string().optional(),
  replyRootUri: z.string().optional(),
  embedPaperUri: z.string().optional(),
  tags: z.array(z.string().max(64)).max(8).optional(),
  langs: z.array(z.string().max(8)).max(3).optional(),
});

export async function postsRoutes(app: FastifyInstance): Promise<void> {
  const services = app.services;
  const ctx = app.ctx;

  app.post(
    '/posts',
    {
      preHandler: app.requireAuth,
      schema: { body: createSchema },
    },
    async (req, reply) => {
      if (!req.session) throw Errors.unauthorized();
      const body = req.body as z.infer<typeof createSchema>;
      const result = await services.posts.create({
        authorDid: req.session.did,
        ...body,
      });
      if (result.isErr()) throw result.error;
      reply.status(201);
      return {
        id: result.value.id,
        uri: result.value.uri,
        cid: result.value.cid,
        text: result.value.text,
        createdAt: result.value.createdAt.toISOString(),
      };
    },
  );

  app.get(
    '/posts',
    {
      schema: {
        querystring: z.object({
          author: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(20),
        }),
      },
    },
    async (req) => {
      const { author, limit } = req.query as { author?: string; limit: number };
      const list = author
        ? await ctx.repos.posts.listByAuthor(author, limit)
        : await ctx.repos.posts.listRecent(limit);
      if (list.isErr()) throw list.error;
      return { items: list.value.map(serializePost) };
    },
  );
}

function serializePost(p: {
  id: string;
  uri: string;
  authorDid: string;
  text: string;
  embedPaperUri: string | null;
  tags: string[] | null;
  langs: string[] | null;
  createdAt: Date;
}): Record<string, unknown> {
  return {
    id: p.id,
    uri: p.uri,
    authorDid: p.authorDid,
    text: p.text,
    embedPaperUri: p.embedPaperUri,
    tags: p.tags,
    langs: p.langs,
    createdAt: p.createdAt.toISOString(),
  };
}
