import { describe, expect, it, vi } from 'vitest';
import { ResultAsync } from '@openxiv/shared';
import type { AppContext } from '../context.js';
import type { UserRecord } from '@openxiv/db';
import { syncStaleBlueskyProfiles } from './bluesky-profile-sync-loop.js';

function user(id: string): UserRecord {
  return {
    id,
    did: `did:web:openxiv.net:u:${id}`,
    handle: `${id}.old`,
    displayName: 'Old Name',
    avatarUrl: null,
    orcid: null,
    googleSub: null,
    blueskyDid: `did:plc:${id}`,
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

describe('syncStaleBlueskyProfiles', () => {
  it('loads stale linked profiles and forces a best-effort profile refresh', async () => {
    const stale = user('alice');
    const listBlueskySyncCandidates = vi.fn(() =>
      ResultAsync.fromSafePromise(Promise.resolve([stale])),
    );
    const upsertByDid = vi.fn(() =>
      ResultAsync.fromSafePromise(
        Promise.resolve({
          ...stale,
          handle: 'alice.bsky.social',
          displayName: 'Alice New',
          updatedAt: new Date('2026-05-18T12:06:00Z'),
        }),
      ),
    );
    const ctx = {
      repos: {
        users: {
          listBlueskySyncCandidates,
          findByHandle: vi.fn(() => ResultAsync.fromSafePromise(Promise.resolve(null))),
          upsertByDid,
        },
      },
      clients: {
        bluesky: {
          hasSession: vi.fn(() => ResultAsync.fromSafePromise(Promise.resolve(true))),
          restoreSession: vi.fn(() =>
            ResultAsync.fromSafePromise(
              Promise.resolve({
                get: vi.fn(() =>
                  ResultAsync.fromSafePromise(
                    Promise.resolve({
                      handle: 'alice.bsky.social',
                      displayName: 'Alice New',
                    }),
                  ),
                ),
              }),
            ),
          ),
        },
      },
    } as unknown as AppContext;

    const result = await syncStaleBlueskyProfiles(ctx, {
      now: new Date('2026-05-18T12:06:00Z'),
      limit: 25,
    });

    expect(result).toEqual({ checked: 1, refreshed: 1 });
    expect(listBlueskySyncCandidates).toHaveBeenCalledWith(
      new Date('2026-05-18T12:01:00Z'),
      25,
    );
    expect(upsertByDid).toHaveBeenCalledWith(
      expect.objectContaining({
        blueskyDid: 'did:plc:alice',
        displayName: 'Alice New',
        handle: 'alice.bsky.social',
      }),
    );
  });

  it('skips stale linked profiles when no local Bluesky OAuth session exists', async () => {
    const stale = user('alice');
    const listBlueskySyncCandidates = vi.fn(() =>
      ResultAsync.fromSafePromise(Promise.resolve([stale])),
    );
    const restoreSession = vi.fn(() =>
      ResultAsync.fromSafePromise(
        Promise.resolve({
          get: vi.fn(),
        }),
      ),
    );
    const ctx = {
      repos: {
        users: {
          listBlueskySyncCandidates,
          findByHandle: vi.fn(() => ResultAsync.fromSafePromise(Promise.resolve(null))),
          upsertByDid: vi.fn(),
        },
      },
      clients: {
        bluesky: {
          hasSession: vi.fn(() => ResultAsync.fromSafePromise(Promise.resolve(false))),
          restoreSession,
        },
      },
    } as unknown as AppContext;

    const result = await syncStaleBlueskyProfiles(ctx, {
      now: new Date('2026-05-18T12:06:00Z'),
    });

    expect(result).toEqual({ checked: 1, refreshed: 0 });
    expect(restoreSession).not.toHaveBeenCalled();
  });

  it('refreshes each stale user through that user-specific Bluesky DID', async () => {
    const alice = user('alice');
    const carol = user('carol');
    const listBlueskySyncCandidates = vi.fn(() =>
      ResultAsync.fromSafePromise(Promise.resolve([alice, carol])),
    );
    const hasSession = vi.fn((did: string) =>
      ResultAsync.fromSafePromise(Promise.resolve(did === 'did:plc:alice' || did === 'did:plc:carol')),
    );
    const get = vi.fn((_nsid: string, query: Record<string, string>) =>
      ResultAsync.fromSafePromise(
        Promise.resolve({
          handle: `${String(query['actor']).replace('did:plc:', '')}.bsky.social`,
          displayName: `${String(query['actor']).replace('did:plc:', '')} new`,
        }),
      ),
    );
    const restoreSession = vi.fn(() =>
      ResultAsync.fromSafePromise(Promise.resolve({ get })),
    );
    const upsertByDid = vi.fn((input: { blueskyDid: string }) =>
      ResultAsync.fromSafePromise(
        Promise.resolve({
          ...(input.blueskyDid.endsWith('alice') ? alice : carol),
          updatedAt: new Date('2026-05-18T12:06:00Z'),
        }),
      ),
    );
    const ctx = {
      repos: {
        users: {
          listBlueskySyncCandidates,
          findByHandle: vi.fn(() => ResultAsync.fromSafePromise(Promise.resolve(null))),
          upsertByDid,
        },
      },
      clients: {
        bluesky: {
          hasSession,
          restoreSession,
        },
      },
    } as unknown as AppContext;

    const result = await syncStaleBlueskyProfiles(ctx, {
      now: new Date('2026-05-18T12:06:00Z'),
    });

    expect(result).toEqual({ checked: 2, refreshed: 2 });
    expect(hasSession).toHaveBeenCalledWith('did:plc:alice');
    expect(hasSession).toHaveBeenCalledWith('did:plc:carol');
    expect(restoreSession).toHaveBeenCalledWith('did:plc:alice');
    expect(restoreSession).toHaveBeenCalledWith('did:plc:carol');
    expect(get).toHaveBeenCalledWith('app.bsky.actor.getProfile', {
      actor: 'did:plc:alice',
    });
    expect(get).toHaveBeenCalledWith('app.bsky.actor.getProfile', {
      actor: 'did:plc:carol',
    });
  });
});
