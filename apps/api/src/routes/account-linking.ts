import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors } from '@openxiv/shared';
import { makeAccountLinkingService } from '../services/account-linking.js';

/**
 * Account-linking REST surface.
 *
 *   GET    /me/links                 → list linked providers for current user
 *   POST   /me/links/:provider       → finalize a link (called by /auth/:provider/callback?intent=link)
 *   DELETE /me/links/:provider       → unlink a provider; safeguards described below
 *
 * The actual OAuth dance still flows through the existing /auth/:provider/login
 * endpoints. They accept `?intent=link` as a state-encoded marker; the
 * callback then routes through the linking service instead of treating
 * the response as a fresh signup. This route handles the IDPotent finalize
 * + diagnostic endpoints; the OAuth callback wiring is in auth.ts.
 */

const providerSchema = z.enum(['orcid', 'google', 'bluesky', 'mastodon']);

export async function accountLinkingRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const linking = makeAccountLinkingService(ctx);

  app.get('/me/links', async (req, reply) => {
    const session = req.session;
    if (!session) {
      reply.status(401);
      return { kind: 'unauthorized' as const };
    }
    const result = await linking.listFor(session.uid);
    if (result.isErr()) throw result.error;
    return {
      links: result.value.map((l) => ({
        id: l.id,
        provider: l.provider,
        subject: l.subject,
        linkedAt: l.linkedAt,
        linkedVia: l.linkedVia,
        mastodonInstanceUrl: l.mastodonInstanceUrl,
        mastodonAccountUrl: l.mastodonAccountUrl,
      })),
    };
  });

  app.delete(
    '/me/links/:provider',
    {
      schema: {
        params: z.object({ provider: providerSchema }),
      },
    },
    async (req, reply) => {
      const session = req.session;
      if (!session) {
        reply.status(401);
        return { kind: 'unauthorized' as const };
      }
      const provider = (req.params as { provider: 'orcid' | 'google' | 'bluesky' | 'mastodon' }).provider;
      const result = await linking.unlink({ userId: session.uid, provider });
      if (result.isErr()) throw result.error;
      const r = result.value;
      switch (r.kind) {
        case 'unlinked':
          return { ok: true, user: { did: r.user.did, handle: r.user.handle } };
        case 'last_provider':
          reply.status(400);
          return { kind: 'last_provider', message: 'cannot unlink the only sign-in provider' };
        case 'primary_not_promoted':
          reply.status(400);
          return {
            kind: 'primary_not_promoted',
            primary: r.primary,
            message: 'promote another provider to primary before unlinking this one',
          };
        case 'not_linked':
          reply.status(404);
          return { kind: 'not_linked' };
      }
    },
  );

}

void Errors;
