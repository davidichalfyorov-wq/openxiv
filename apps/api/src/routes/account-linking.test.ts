import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { ResultAsync } from '@openxiv/shared';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { AccountLinkRecord } from '@openxiv/db';
import type { SessionPayload } from '../auth/session.js';
import type { AppContext } from '../context.js';
import { accountLinkingRoutes } from './account-linking.js';

function orcidLink(overrides: Partial<AccountLinkRecord> = {}): AccountLinkRecord {
  return {
    id: overrides.id ?? 'orcid-link',
    userId: overrides.userId ?? 'user-1',
    provider: 'orcid',
    subject: overrides.subject ?? '0000-0001-2345-6789',
    linkedVia: overrides.linkedVia ?? 'link',
    prevPrimaryDid: overrides.prevPrimaryDid ?? 'did:web:openxiv.net:u:orcid.0000',
    newPrimaryDid: overrides.newPrimaryDid ?? 'did:web:openxiv.net:u:orcid.0000',
    linkedAt: overrides.linkedAt ?? new Date('2026-05-19T00:00:00Z'),
    mastodonInstanceUrl: overrides.mastodonInstanceUrl ?? null,
    mastodonAccessToken: overrides.mastodonAccessToken ?? null,
    mastodonAccountUrl: overrides.mastodonAccountUrl ?? null,
  };
}

describe('accountLinkingRoutes ORCID link surface', () => {
  it('treats ORCID links as identification-only public account links', async () => {
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('ctx', {
      repos: {
        accountLinks: {
          listForUser: vi.fn(() =>
            ResultAsync.fromSafePromise(Promise.resolve([orcidLink()])),
          ),
        },
      },
    } as unknown as AppContext);
    app.addHook('preHandler', async (req) => {
      (req as typeof req & { session?: SessionPayload }).session = {
        uid: 'user-1',
        did: 'did:web:openxiv.net:u:orcid.0000',
        role: 'author',
      };
    });
    await app.register(accountLinkingRoutes);

    const res = await app.inject({
      method: 'GET',
      url: '/me/links',
    });

    expect(res.statusCode).toBe(200);
    const link = res.json().links[0];
    expect(link).toMatchObject({
      provider: 'orcid',
      subject: '0000-0001-2345-6789',
    });
    expect(Object.keys(link).filter((key) => key.toLowerCase().includes('orcid'))).toEqual([]);
    await app.close();
  });

  it('does not register an ORCID settings endpoint beyond linking/unlinking', async () => {
    const update = vi.fn();
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.decorate('ctx', {
      repos: {
        accountLinks: {
          listForUser: vi.fn(() =>
            ResultAsync.fromSafePromise(Promise.resolve([orcidLink()])),
          ),
          update,
        },
      },
    } as unknown as AppContext);
    app.addHook('preHandler', async (req) => {
      (req as typeof req & { session?: SessionPayload }).session = {
        uid: 'user-1',
        did: 'did:web:openxiv.net:u:orcid.0000',
        role: 'author',
      };
    });
    await app.register(accountLinkingRoutes);

    const res = await app.inject({
      method: 'PATCH',
      url: '/me/links/orcid/settings',
      payload: { enabled: true },
    });

    expect(res.statusCode).toBe(404);
    expect(update).not.toHaveBeenCalled();
    await app.close();
  });
});
