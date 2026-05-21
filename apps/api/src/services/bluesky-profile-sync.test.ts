import { describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../context.js';
import type { UserRecord } from '@openxiv/db';
import { syncBlueskyProfileBestEffort } from './bluesky-profile-sync.js';

function user(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'user-1',
    did: 'did:plc:alice',
    handle: 'old.example',
    displayName: 'Old Name',
    avatarUrl: null,
    orcid: null,
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
    ...overrides,
  };
}

describe('syncBlueskyProfileBestEffort', () => {
  it('refreshes stale Bluesky profile fields from the restored session', async () => {
    const updated = user({
      handle: 'alice.bsky.social',
      displayName: 'Alice New',
      avatarUrl: 'https://cdn.bsky.app/img/avatar/plain/did:plc:alice/x@jpeg',
      updatedAt: new Date('2026-05-18T12:06:00Z'),
    });
    const upsertByDid = vi.fn(async () => ({
      isOk: () => true,
      isErr: () => false,
      value: updated,
    }));
    const ctx = {
      repos: {
        users: {
          findByHandle: vi.fn(async () => ({ isErr: () => false, value: null })),
          upsertByDid,
        },
      },
      clients: {
        bluesky: {
          restoreSession: vi.fn(async () => ({
            isErr: () => false,
            value: {
              get: vi.fn(async () => ({
                isErr: () => false,
                value: {
                  handle: 'alice.bsky.social',
                  displayName: 'Alice New',
                  avatar: 'https://cdn.bsky.app/img/avatar/plain/did:plc:alice/x@jpeg',
                },
              })),
            },
          })),
        },
      },
    } as unknown as AppContext;

    const result = await syncBlueskyProfileBestEffort(ctx, user(), {
      now: new Date('2026-05-18T12:06:00Z'),
    });

    expect(result).toBe(updated);
    expect(upsertByDid).toHaveBeenCalledWith({
      did: 'did:plc:alice',
      blueskyDid: 'did:plc:alice',
      displayName: 'Alice New',
      handle: 'alice.bsky.social',
      avatarUrl: 'https://cdn.bsky.app/img/avatar/plain/did:plc:alice/x@jpeg',
    });
  });

  it('does not touch fresh rows', async () => {
    const restoreSession = vi.fn();
    const ctx = {
      clients: { bluesky: { restoreSession } },
      repos: { users: {} },
    } as unknown as AppContext;
    const fresh = user({ updatedAt: new Date('2026-05-18T12:04:30Z') });

    const result = await syncBlueskyProfileBestEffort(ctx, fresh, {
      now: new Date('2026-05-18T12:05:00Z'),
    });

    expect(result).toBe(fresh);
    expect(restoreSession).not.toHaveBeenCalled();
  });
});
