import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DEFAULT_HTTP_TIMEOUT_MS, fetchWithTimeoutRetry } from '@openxiv/clients';
import { Errors, randomToken } from '@openxiv/shared';
import { makeAccountLinkingService } from '../services/account-linking.js';
import { normalizeInstanceUrl } from '../services/mastodon-crosspost.js';
import { sanitizeRedirect } from './auth.js';

interface MastodonOAuthState {
  readonly userId: string;
  readonly instanceUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly redirectAfter: string;
}

export async function authMastodonRoutes(app: FastifyInstance): Promise<void> {
  const ctx = app.ctx;
  const authRateLimit = {
    rateLimit: {
      max: 10,
      timeWindow: 60_000,
      keyGenerator: (req: { ip: string }) => `auth:mastodon:${req.ip}`,
    },
  };

  app.post(
    '/auth/mastodon/start',
    {
      config: authRateLimit,
      preHandler: app.requireAuth,
      schema: {
        body: z.object({
          instanceUrl: z.string().trim().min(3).max(255),
          redirect_after: z.string().max(2048).optional(),
        }),
      },
    },
    async (req) => {
      if (!req.session) throw Errors.unauthorized();
      const { instanceUrl: rawInstanceUrl, redirect_after } = req.body as {
        instanceUrl: string;
        redirect_after?: string;
      };
      const instanceUrl = normalizeInstanceUrl(rawInstanceUrl);
      const redirectUri = process.env['MASTODON_REDIRECT_URI'] ?? defaultMastodonRedirectUri(ctx.env.PUBLIC_WEB_BASE);
      const appRegistration = await registerMastodonApp(instanceUrl, redirectUri, ctx.env.PUBLIC_WEB_BASE);
      const state = randomToken(24);
      const oauthState: MastodonOAuthState = {
        userId: req.session.uid,
        instanceUrl,
        clientId: appRegistration.clientId,
        clientSecret: appRegistration.clientSecret,
        redirectUri,
        redirectAfter: sanitizeRedirect(redirect_after ?? '/settings/identity'),
      };
      await ctx.redis.setex(`mastodon:oauth:${state}`, 600, JSON.stringify(oauthState));
      const url = new URL(`${instanceUrl}/oauth/authorize`);
      url.searchParams.set('client_id', appRegistration.clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'read:accounts write:statuses');
      url.searchParams.set('state', state);
      return { url: url.toString() };
    },
  );

  app.get(
    '/auth/mastodon/callback',
    {
      config: authRateLimit,
      schema: {
        querystring: z.object({
          code: z.string().min(1).max(4096),
          state: z.string().min(1).max(256),
        }),
      },
    },
    async (req, reply) => {
      const { code, state } = req.query as { code: string; state: string };
      const raw = await ctx.redis.get(`mastodon:oauth:${state}`);
      if (!raw) throw Errors.unauthorized('Mastodon OAuth state expired');
      await ctx.redis.del(`mastodon:oauth:${state}`).catch(() => {});
      const stored = JSON.parse(raw) as MastodonOAuthState;
      if (!req.session || req.session.uid !== stored.userId) {
        throw Errors.unauthorized('Mastodon callback session mismatch');
      }
      const token = await exchangeMastodonCode(stored, code);
      const account = await verifyMastodonCredentials(stored.instanceUrl, token.accessToken);
      const subject = account.acct.includes('@')
        ? account.acct
        : `${account.acct}@${new URL(stored.instanceUrl).hostname}`;
      const linking = makeAccountLinkingService(ctx);
      const result = await linking.link({
        userId: req.session.uid,
        provider: 'mastodon',
        subject,
        providerData: {
          displayName: account.displayName || subject,
          ...(account.avatar ? { avatarUrl: account.avatar } : {}),
        },
        providerSecrets: {
          mastodonInstanceUrl: stored.instanceUrl,
          mastodonAccessToken: token.accessToken,
          ...(account.url ? { mastodonAccountUrl: account.url } : {}),
        },
        linkedVia: 'link',
      });
      if (result.isErr()) throw result.error;
      switch (result.value.kind) {
        case 'linked':
          reply.redirect(new URL(stored.redirectAfter, ctx.env.PUBLIC_WEB_BASE).toString());
          return;
        case 'conflict':
          throw Errors.conflict('provider account already linked to another user', {
            existingUserId: result.value.existingUserId,
          });
        case 'reserved':
          throw Errors.forbidden('Mastodon DID is reserved for another user');
        case 'unauthorized':
          throw Errors.unauthorized();
      }
    },
  );
}

export function defaultMastodonRedirectUri(publicWebBase: string): string {
  return `${publicWebBase.replace(/\/$/, '')}/api-proxy/auth/mastodon/callback`;
}

async function registerMastodonApp(
  instanceUrl: string,
  redirectUri: string,
  website: string,
): Promise<{ clientId: string; clientSecret: string }> {
  const res = await fetchWithTimeoutRetry(`${instanceUrl}/api/v1/apps`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'OpenXiv',
      redirect_uris: redirectUri,
      scopes: 'read:accounts write:statuses',
      website,
    }),
    timeoutMs: DEFAULT_HTTP_TIMEOUT_MS,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw Errors.externalInvalidResponse('mastodon.app.register', `HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }
  const json = (await res.json()) as { client_id?: string; client_secret?: string };
  if (!json.client_id || !json.client_secret) {
    throw Errors.externalInvalidResponse('mastodon.app.register', 'missing client credentials');
  }
  return { clientId: json.client_id, clientSecret: json.client_secret };
}

async function exchangeMastodonCode(
  state: MastodonOAuthState,
  code: string,
): Promise<{ accessToken: string }> {
  const res = await fetchWithTimeoutRetry(`${state.instanceUrl}/oauth/token`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: state.clientId,
      client_secret: state.clientSecret,
      redirect_uri: state.redirectUri,
      grant_type: 'authorization_code',
      code,
      scope: 'read:accounts write:statuses',
    }),
    timeoutMs: DEFAULT_HTTP_TIMEOUT_MS,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw Errors.externalInvalidResponse('mastodon.token', `HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw Errors.externalInvalidResponse('mastodon.token', 'missing access token');
  return { accessToken: json.access_token };
}

async function verifyMastodonCredentials(instanceUrl: string, accessToken: string): Promise<{
  acct: string;
  displayName: string;
  avatar: string | null;
  url: string | null;
}> {
  const res = await fetchWithTimeoutRetry(`${instanceUrl}/api/v1/accounts/verify_credentials`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    timeoutMs: DEFAULT_HTTP_TIMEOUT_MS,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw Errors.externalInvalidResponse('mastodon.verify', `HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    acct?: string;
    display_name?: string;
    avatar?: string;
    url?: string;
  };
  if (!json.acct) throw Errors.externalInvalidResponse('mastodon.verify', 'missing acct');
  return {
    acct: json.acct,
    displayName: json.display_name ?? json.acct,
    avatar: json.avatar ?? null,
    url: json.url ?? null,
  };
}
