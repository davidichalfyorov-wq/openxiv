import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Errors } from '@openxiv/shared';
import { readSessionCookie, verifySession, type SessionPayload } from '../auth/session.js';

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    session?: SessionPayload;
  }
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  const ctx = app.ctx;

  app.addHook('onRequest', async (req) => {
    const token = readSessionCookie(req);
    if (!token) return;
    try {
      req.session = await verifySession(ctx.env.SESSION_SECRET, token);
    } catch {
      // ignore — anonymous request
    }
  });

  app.decorate('requireAuth', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.session) {
      const e = Errors.unauthorized('sign in required');
      reply.status(e.toStatusCode()).send(e.toJSON());
    }
  });
});
