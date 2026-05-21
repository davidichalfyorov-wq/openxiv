import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors } from '@openxiv/shared';

/**
 * Proxy endpoint that serves objects from the in-memory mock storage. Only
 * mounted when USE_MOCK_CLIENTS is true (or per-service mock flags). Real
 * deployments use presigned S3/R2 URLs and never hit this path.
 */
export async function mockStorageRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  if (!ctx.env.USE_MOCK_CLIENTS) return;

  app.get(
    '/__mock-storage/:key',
    { schema: { params: z.object({ key: z.string() }) } },
    async (req, reply) => {
      const { key: encodedKey } = req.params as { key: string };
      const key = decodeURIComponent(encodedKey);
      const obj = await ctx.clients.storage.get(key);
      if (obj.isErr()) {
        throw Errors.notFound(`object ${key}`);
      }
      reply.header('content-type', obj.value.contentType);
      reply.header('cache-control', 'no-store');
      reply.send(obj.value.body);
    },
  );
}
