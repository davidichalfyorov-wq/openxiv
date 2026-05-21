import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { Errors } from '@openxiv/shared';
import { decodeOrcidState, type OAuthProfile } from '@openxiv/clients';
import {
  SESSION_COOKIE,
  clearSessionCookie,
  setSessionCookie,
  signSession,
} from '../auth/session.js';
import { makeAccountLinkingService } from '../services/account-linking.js';

const PROVIDERS = ['orcid', 'google', 'bluesky'] as const;
type Provider = (typeof PROVIDERS)[number];

// The legacy /auth/:provider/login + /auth/:provider/callback endpoints work
// for ORCID and Google but cannot model atproto OAuth, which needs a handle
// up-front and processes the entire callback URL through its own state
// machine. Bluesky gets dedicated endpoints below.
const LEGACY_OAUTH_PROVIDERS = ['orcid', 'google'] as const;
type LegacyOAuthProvider = (typeof LEGACY_OAUTH_PROVIDERS)[number];

const querySchema = z.object({
  redirect_after: z.string().optional(),
  intent: z.enum(['signin', 'link']).optional(),
});

/**
 * Allow only same-origin relative paths. Rejects `//evil.com` (protocol-
 * relative, browsers treat as scheme://evil.com), `\\evil.com`, schemes
 * like `javascript:`, and any absolute URL. Falls back to `/`.
 *
 * Exported so the unit test (`auth.redirect.test.ts`) can exercise the
 * adversarial inputs without spinning Fastify.
 */
export function sanitizeRedirect(target: string): string {
  if (typeof target !== 'string' || target.length === 0) return '/';
  if (target.length > 2048) return '/';
  if (!target.startsWith('/')) return '/';
  if (target.startsWith('//') || target.startsWith('/\\')) return '/';
  if (/[\x00-\x1f]/.test(target)) return '/';
  if (/^\/[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)) return '/';
  return target;
}

export function selectBlueskyCallbackMode(input: {
  intent?: 'signin' | 'link';
  hasSession: boolean;
}): 'signin' | 'link' {
  return input.intent === 'link' && input.hasSession ? 'link' : 'signin';
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const services = app.services;

  const legacyOauthClient = (provider: LegacyOAuthProvider) => {
    return provider === 'orcid' ? ctx.clients.orcid : ctx.clients.google;
  };

  // Strict rate limit on every auth-adjacent endpoint: 10/min/IP. The global
  // limiter is 60/min/IP; auth is tighter because one valid callback code
  // creates a session.
  const authRateLimit = {
    rateLimit: {
      max: 10,
      timeWindow: 60_000,
      keyGenerator: (req: { ip: string }) => `auth:${req.ip}`,
    },
  };

  /** Build provider authorize URL (legacy OAuth: ORCID/Google). */
  app.get(
    '/auth/:provider/login',
    {
      config: authRateLimit,
      schema: {
        params: z.object({ provider: z.enum(LEGACY_OAUTH_PROVIDERS) }),
        querystring: querySchema,
      },
    },
    async (req) => {
      const { provider } = req.params as { provider: LegacyOAuthProvider };
      const { redirect_after, intent } = req.query as {
        redirect_after?: string;
        intent?: 'signin' | 'link';
      };
      const client = legacyOauthClient(provider);
      const result = await client.authorizeUrl(redirect_after, {
        ...(intent ? { intent } : {}),
      });
      if (result.isErr()) throw result.error;
      return result.value;
    },
  );

  /** OAuth provider callback (legacy: ORCID/Google). */
  app.get(
    '/auth/:provider/callback',
    {
      config: authRateLimit,
      schema: {
        params: z.object({ provider: z.enum(LEGACY_OAUTH_PROVIDERS) }),
        querystring: z.object({
          code: z.string().min(1).max(2048),
          state: z.string().min(1).max(512),
          code_verifier: z.string().min(43).max(128).optional(),
          redirect_after: z.string().max(2048).optional(),
        }),
      },
    },
    async (req, reply) => {
      const { provider } = req.params as { provider: LegacyOAuthProvider };
      const { code, state, code_verifier, redirect_after } = req.query as {
        code: string;
        state: string;
        code_verifier?: string;
        redirect_after?: string;
      };
      const client = legacyOauthClient(provider);
      const exchange = await client.exchange({
        code,
        state,
        ...(code_verifier ? { codeVerifier: code_verifier } : {}),
      });
      if (exchange.isErr()) throw exchange.error;

      const orcidState = provider === 'orcid' ? decodeOrcidState(state) : null;
      const intent = orcidState?.intent;
      const redirectAfter = redirect_after ?? orcidState?.redirectAfter ?? '/';
      if (provider === 'orcid' && intent === 'link' && req.session) {
        const linking = makeAccountLinkingService(ctx);
        const profile = exchange.value;
        const link = await linking.link({
          userId: req.session.uid,
          provider: 'orcid',
          subject: profile.subject,
          providerData: {
            displayName: profile.displayName,
            ...(profile.orcid ? { orcid: profile.orcid } : {}),
          },
          linkedVia: 'link',
        });
        if (link.isErr()) throw link.error;
        switch (link.value.kind) {
          case 'linked': {
            const token = await signSession(ctx.env.SESSION_SECRET, link.value.user, ctx.env.JWT_TTL_SECONDS);
            setSessionCookie(reply, token, ctx.env.JWT_TTL_SECONDS);
            const target = new URL(sanitizeRedirect(redirectAfter), ctx.env.PUBLIC_WEB_BASE);
            reply.redirect(target.toString());
            return;
          }
          case 'conflict':
            throw Errors.conflict('provider account already linked to another user', {
              existingUserId: link.value.existingUserId,
            });
          case 'reserved':
            throw Errors.forbidden('ORCID DID is reserved for another user');
          case 'unauthorized':
            throw Errors.unauthorized();
        }
      }

      await issueSessionAndRedirect(reply, exchange.value, redirectAfter);
    },
  );

  /**
   * Bluesky atproto OAuth: takes the user's handle (or DID) up front.
   * Returns `{ url }` where the browser navigates; the underlying lib has
   * already persisted PAR + DPoP state in Redis keyed by `state`.
   */
  app.post(
    '/auth/bluesky/start',
    {
      config: authRateLimit,
      schema: {
        body: z.object({
          handle: z.string().trim().min(3).max(253),
          redirect_after: z.string().max(2048).optional(),
          intent: z.enum(['signin', 'link']).optional(),
        }),
      },
    },
    async (req) => {
      const { handle, redirect_after, intent } = req.body as {
        handle: string;
        redirect_after?: string;
        intent?: 'signin' | 'link';
      };
      const result = await ctx.clients.bluesky.authorize({
        handle,
        ...(redirect_after ? { redirectAfter: redirect_after } : {}),
        ...(intent ? { intent } : {}),
      });
      if (result.isErr()) throw result.error;
      return result.value;
    },
  );

  /** Bluesky atproto OAuth callback. The lib parses the full query string. */
  app.get(
    '/auth/bluesky/callback',
    {
      config: authRateLimit,
    },
    async (req, reply) => {
      // We deliberately accept the raw query without zod-validating each key:
      // the atproto lib's `client.callback()` does its own strict validation
      // and refuses unknown response shapes. Letting zod gate this prevented
      // forward compatibility with new params (e.g. `iss`).
      const params = new URLSearchParams(req.url.split('?')[1] ?? '');
      const result = await ctx.clients.bluesky.callback(params);
      if (result.isErr()) throw result.error;
      const { profile, redirectAfter, intent } = result.value;
      if (selectBlueskyCallbackMode({ intent, hasSession: Boolean(req.session) }) === 'link') {
        if (!req.session) throw Errors.unauthorized();
        const linking = makeAccountLinkingService(ctx);
        const link = await linking.link({
          userId: req.session.uid,
          provider: 'bluesky',
          subject: profile.subject,
          providerData: {
            did: profile.did ?? profile.subject,
            displayName: profile.displayName,
            ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
          },
          linkedVia: 'link',
        });
        if (link.isErr()) throw link.error;
        switch (link.value.kind) {
          case 'linked': {
            const token = await signSession(ctx.env.SESSION_SECRET, link.value.user, ctx.env.JWT_TTL_SECONDS);
            setSessionCookie(reply, token, ctx.env.JWT_TTL_SECONDS);
            const target = new URL(sanitizeRedirect(redirectAfter ?? '/settings/identity'), ctx.env.PUBLIC_WEB_BASE);
            reply.redirect(target.toString());
            return;
          }
          case 'conflict':
            throw Errors.conflict('provider account already linked to another user', {
              existingUserId: link.value.existingUserId,
            });
          case 'reserved':
            throw Errors.forbidden('Bluesky DID is reserved for another user');
          case 'unauthorized':
            throw Errors.unauthorized();
        }
      }
      await issueSessionAndRedirect(reply, profile, redirectAfter ?? '/');
    },
  );

  /**
   * Public client metadata JSON. AT-proto OAuth Authorization Servers fetch
   * this document from `client_id` to learn our redirect URIs, scopes, and
   * cryptographic capabilities. Must be served over HTTPS in production.
   */
  app.get('/oauth/client-metadata.json', { config: authRateLimit }, async (_req, reply) => {
    reply.header('content-type', 'application/json');
    reply.header('cache-control', 'public, max-age=300');
    return ctx.clients.bluesky.clientMetadata();
  });

  /**
   * Dev/mock callback. The mock OAuth client returns a base64url-encoded
   * profile in `code`. This endpoint accepts it directly so the web client
   * can simulate the full OAuth flow without a real IdP.
   *
   * Hard-disabled in production NODE_ENV — would otherwise be a complete
   * auth bypass since anyone can mint a session by submitting an arbitrary
   * profile blob in `code`.
   */
  app.get(
    '/auth/dev/mock-callback',
    {
      config: authRateLimit,
      schema: {
        querystring: z.object({
          provider: z.enum(PROVIDERS),
          code: z.string().min(1).max(8192),
          state: z.string().max(512).optional(),
          redirect_after: z.string().max(2048).optional(),
        }),
      },
    },
    async (req, reply) => {
      if (ctx.env.NODE_ENV === 'production' && !ctx.env.USE_MOCK_CLIENTS) {
        throw Errors.notFound('endpoint disabled in production');
      }
      const { provider, code, redirect_after } = req.query as {
        provider: Provider;
        code: string;
        redirect_after?: string;
      };
      let profile: OAuthProfile;
      if (provider === 'bluesky') {
        const params = new URLSearchParams({ code, state: 'mock' });
        const callback = await ctx.clients.bluesky.callback(params);
        if (callback.isErr()) throw callback.error;
        profile = callback.value.profile;
      } else {
        const client = legacyOauthClient(provider);
        const exchange = await client.exchange({ code, state: 'mock' });
        if (exchange.isErr()) throw exchange.error;
        profile = exchange.value;
      }
      await issueSessionAndRedirect(reply, profile, redirect_after ?? '/');
    },
  );

  app.post('/auth/logout', { config: authRateLimit }, async (_req, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/auth/me', async (req) => {
    if (!req.session) return { authenticated: false };
    const user = await services.users.getById(req.session.uid);
    if (user.isErr()) {
      return { authenticated: false };
    }
    return {
      authenticated: true,
      user: {
        id: user.value.id,
        did: user.value.did,
        displayName: user.value.displayName,
        handle: user.value.handle,
        avatarUrl: user.value.avatarUrl,
        email: user.value.email,
        orcid: user.value.orcid,
        role: user.value.role,
      },
    };
  });

  async function issueSessionAndRedirect(
    reply: FastifyReply,
    profile: OAuthProfile,
    redirectAfter: string,
  ): Promise<void> {
    const user = await services.users.upsertFromOAuth(profile);
    if (user.isErr()) throw user.error;
    const token = await signSession(ctx.env.SESSION_SECRET, user.value, ctx.env.JWT_TTL_SECONDS);
    setSessionCookie(reply, token, ctx.env.JWT_TTL_SECONDS);
    const target = new URL(sanitizeRedirect(redirectAfter), ctx.env.PUBLIC_WEB_BASE);
    reply.redirect(target.toString());
  }

  // exporting for typescript completeness
  void Errors;
  void SESSION_COOKIE;
}
