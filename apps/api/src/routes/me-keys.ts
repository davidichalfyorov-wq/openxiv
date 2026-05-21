import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors } from '@openxiv/shared';
import { makeUserKeysService } from '../services/user-keys.js';

/**
 * Endpoints for the logged-in user to inspect and rotate their signing
 * key material.
 *
 *   GET  /me/did/key-info   →  { active: {...}|null, retired: [...] }
 *   POST /me/did/rotate-key →  { newPublicMultibase, retired: [...] }
 *
 * Mounted under /api so the canonical surface is
 * /api/me/did/{key-info,rotate-key}. Both require an authenticated
 * session. No private-key material is ever exposed.
 */

const rotateBodySchema = z.object({
  reason: z.enum(['rotation', 'compromise', 'manual']).optional(),
});

export async function meKeyRoutes(app: FastifyInstance): Promise<void> {
  const keys = makeUserKeysService(app.ctx);

  app.get('/me/did/key-info', async (req, reply) => {
    const session = req.session;
    if (!session) {
      reply.status(401);
      return { kind: 'unauthorized' as const };
    }
    const result = await keys.getVerificationMethods(session.uid);
    if (result.isErr()) throw result.error;
    return result.value;
  });

  app.post(
    '/me/did/rotate-key',
    { schema: { body: rotateBodySchema } },
    async (req, reply) => {
      const session = req.session;
      if (!session) {
        reply.status(401);
        return { kind: 'unauthorized' as const };
      }
      const body = (req.body ?? {}) as z.infer<typeof rotateBodySchema>;
      const reason = body.reason ?? 'rotation';
      const result = await keys.rotateKeypair(session.uid, reason);
      if (result.isErr()) {
        // Wrap KEK-related env errors as 503 — operator needs to fix
        // configuration, the user can't do anything about it.
        const msg = result.error.message ?? '';
        if (msg.includes('OPENXIV_KEK_BASE64')) {
          reply.status(503);
          return { kind: 'kek_unavailable' as const, message: 'signing key store offline' };
        }
        throw result.error;
      }
      return result.value;
    },
  );
}

void Errors;
