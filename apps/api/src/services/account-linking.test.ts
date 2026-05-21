import { describe, expect, it, vi } from 'vitest';
import { ResultAsync } from '@openxiv/shared';
import type { AccountLinkRecord, UserRecord } from '@openxiv/db';
import type { AppContext } from '../context.js';
import { __testing, makeAccountLinkingService } from './account-linking.js';

const { didPriority } = __testing;

describe('didPriority', () => {
  it('did:plc beats did:web', () => {
    expect(didPriority('did:plc:abc')).toBeGreaterThan(
      didPriority('did:web:openxiv.net:u:orcid.0009'),
    );
  });

  it('orcid beats google', () => {
    expect(didPriority('did:web:openxiv.net:u:orcid.0009')).toBeGreaterThan(
      didPriority('did:web:openxiv.net:u:google.12345'),
    );
  });

  it('returns 0 for unknown DIDs', () => {
    expect(didPriority('did:something:else')).toBe(0);
  });
});

function user(): UserRecord {
  return {
    id: 'user-1',
    did: 'did:web:openxiv.net:u:orcid.0009',
    handle: 'alice',
    displayName: 'Alice',
    avatarUrl: null,
    orcid: '0009',
    googleSub: null,
    blueskyDid: 'did:plc:alice',
    email: null,
    role: 'author',
    isAdminPromoted: false,
    bio: null,
    legacyDids: [],
    publicSigningKey: null,
    encryptedSigningKey: null,
    signingKeyNonce: null,
    keyType: 'secp256k1',
    retiredPubkeys: [],
    blueskySigningKey: null,
    didResolutionStatus: 'native',
    createdAt: new Date('2026-05-18T12:00:00Z'),
    updatedAt: new Date('2026-05-18T12:00:00Z'),
  };
}

function link(overrides: Partial<AccountLinkRecord> = {}): AccountLinkRecord {
  return {
    id: overrides.id ?? 'link-1',
    userId: overrides.userId ?? 'user-1',
    provider: overrides.provider ?? 'bluesky',
    subject: overrides.subject ?? 'did:plc:alice',
    linkedVia: overrides.linkedVia ?? 'link',
    prevPrimaryDid: overrides.prevPrimaryDid ?? 'did:web:openxiv.net:u:orcid.0009',
    newPrimaryDid: overrides.newPrimaryDid ?? 'did:plc:alice',
    linkedAt: overrides.linkedAt ?? new Date('2026-05-18T12:00:00Z'),
    mastodonInstanceUrl: overrides.mastodonInstanceUrl ?? null,
    mastodonAccessToken: overrides.mastodonAccessToken ?? null,
    mastodonAccountUrl: overrides.mastodonAccountUrl ?? null,
  };
}

describe('makeAccountLinkingService', () => {
  it('treats linking an already-linked Bluesky subject to the same user as idempotent', async () => {
    const alice = user();
    const existingLink = link();
    const insert = vi.fn();
    const ctx = {
      repos: {
        accountLinks: {
          findByProviderSubject: vi.fn(() =>
            ResultAsync.fromSafePromise(Promise.resolve(existingLink)),
          ),
          insert,
          listForUser: vi.fn(),
          delete: vi.fn(),
        },
        users: {
          findById: vi.fn(() => ResultAsync.fromSafePromise(Promise.resolve(alice))),
          setCanonicalDid: vi.fn(),
          upsertByDid: vi.fn(),
        },
        reservedDids: {
          findByDid: vi.fn(),
          releaseFor: vi.fn(),
        },
      },
    } as unknown as AppContext;

    const result = await makeAccountLinkingService(ctx).link({
      userId: alice.id,
      provider: 'bluesky',
      subject: 'did:plc:alice',
      providerData: { did: 'did:plc:alice' },
      linkedVia: 'link',
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({
      kind: 'linked',
      user: alice,
      link: existingLink,
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it('treats unlinking an already-unlinked provider as idempotent for the current user', async () => {
    const alice = user();
    const deleteLink = vi.fn();
    const ctx = {
      repos: {
        accountLinks: {
          listForUser: vi.fn(() =>
            ResultAsync.fromSafePromise(
              Promise.resolve([link({ provider: 'orcid', subject: '0009' })]),
            ),
          ),
          delete: deleteLink,
        },
        users: {
          findById: vi.fn(() => ResultAsync.fromSafePromise(Promise.resolve(alice))),
        },
      },
    } as unknown as AppContext;

    const result = await makeAccountLinkingService(ctx).unlink({
      userId: alice.id,
      provider: 'bluesky',
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ kind: 'unlinked', user: alice });
    expect(deleteLink).not.toHaveBeenCalled();
  });

  it('allows unlinking a non-primary provider that did not promote the primary DID', async () => {
    const alice = { ...user(), did: 'did:plc:alice' };
    const mastodon = link({
      id: 'mastodon-link',
      provider: 'mastodon',
      subject: 'openxivtest@openxiv.net',
      prevPrimaryDid: 'did:plc:alice',
      newPrimaryDid: 'did:plc:alice',
    });
    const deleteLink = vi.fn(() => ResultAsync.fromSafePromise(Promise.resolve(undefined)));
    const ctx = {
      repos: {
        accountLinks: {
          listForUser: vi.fn(() =>
            ResultAsync.fromSafePromise(
              Promise.resolve([
                link({ id: 'bluesky-link', provider: 'bluesky', subject: 'did:plc:alice' }),
                mastodon,
              ]),
            ),
          ),
          delete: deleteLink,
        },
        users: {
          findById: vi.fn(() => ResultAsync.fromSafePromise(Promise.resolve(alice))),
        },
      },
    } as unknown as AppContext;

    const result = await makeAccountLinkingService(ctx).unlink({
      userId: alice.id,
      provider: 'mastodon',
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ kind: 'unlinked', user: alice });
    expect(deleteLink).toHaveBeenCalledWith('mastodon-link');
  });

  it('rejects linking a Bluesky subject already bound to a different user', async () => {
    const ctx = {
      repos: {
        accountLinks: {
          findByProviderSubject: vi.fn(() =>
            ResultAsync.fromSafePromise(
              Promise.resolve(link({ userId: 'already-linked-user' })),
            ),
          ),
          insert: vi.fn(),
        },
        users: {
          findById: vi.fn(),
        },
        reservedDids: {
          findByDid: vi.fn(),
        },
      },
    } as unknown as AppContext;

    const result = await makeAccountLinkingService(ctx).link({
      userId: 'new-user',
      provider: 'bluesky',
      subject: 'did:plc:alice',
      providerData: { did: 'did:plc:alice' },
      linkedVia: 'link',
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({
      kind: 'conflict',
      existingUserId: 'already-linked-user',
    });
    expect(ctx.repos.users.findById).not.toHaveBeenCalled();
    expect(ctx.repos.accountLinks.insert).not.toHaveBeenCalled();
  });
});
