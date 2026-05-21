import { describe, expect, it, vi } from 'vitest';
import { ok, ResultAsync } from '@openxiv/shared';
import type { AppContext } from '../context.js';
import type { UserRecord } from '@openxiv/db';
import { enqueueBskyFollowJob, processBskyFollowJob } from './bsky-follow-queue.js';

function user(overrides: Partial<UserRecord> = {}): UserRecord & { blueskyDid: string } {
  return {
    id: 'user-1',
    did: 'did:web:openxiv.net:u:alice',
    handle: 'alice',
    displayName: 'Alice',
    avatarUrl: null,
    orcid: null,
    googleSub: null,
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
    blueskyDid: overrides.blueskyDid ?? 'did:plc:alice',
  };
}

describe('enqueueBskyFollowJob', () => {
  it('queues follow work with a deterministic per-action job id', async () => {
    const add = vi.fn(async () => ({ id: 'queued-job' }));
    const ctx = {
      queues: {
        bskyFollow: { add },
      },
    } as unknown as AppContext;

    const result = await enqueueBskyFollowJob(ctx, user(), {
      action: 'follow',
      targetDid: 'did:plc:bob',
      handle: 'bob.bsky.social',
      displayName: 'Bob',
    });

    expect(result).toEqual({ queued: true, jobId: 'queued-job' });
    expect(add).toHaveBeenCalledWith(
      'bsky-follow',
      {
        action: 'follow',
        followerDid: 'did:plc:alice',
        targetDid: 'did:plc:bob',
        handle: 'bob.bsky.social',
        displayName: 'Bob',
      },
      expect.objectContaining({
        jobId: 'bsky-follow|follow|did%3Aplc%3Aalice|did%3Aplc%3Abob',
        attempts: 5,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: true,
      }),
    );
  });

  it('keeps follow jobs isolated per follower DID', async () => {
    const add = vi.fn(async (_name, _data, opts) => ({ id: opts.jobId }));
    const ctx = {
      queues: {
        bskyFollow: { add },
      },
    } as unknown as AppContext;

    const target = {
      action: 'follow' as const,
      targetDid: 'did:plc:target',
      handle: 'target.bsky.social',
      displayName: 'Target',
    };

    const alice = await enqueueBskyFollowJob(
      ctx,
      user({ id: 'user-1', blueskyDid: 'did:plc:alice' }),
      target,
    );
    const carol = await enqueueBskyFollowJob(
      ctx,
      user({ id: 'user-2', blueskyDid: 'did:plc:carol' }),
      target,
    );

    expect(alice.jobId).toBe('bsky-follow|follow|did%3Aplc%3Aalice|did%3Aplc%3Atarget');
    expect(carol.jobId).toBe('bsky-follow|follow|did%3Aplc%3Acarol|did%3Aplc%3Atarget');
    expect(add).toHaveBeenNthCalledWith(
      1,
      'bsky-follow',
      expect.objectContaining({ followerDid: 'did:plc:alice' }),
      expect.any(Object),
    );
    expect(add).toHaveBeenNthCalledWith(
      2,
      'bsky-follow',
      expect.objectContaining({ followerDid: 'did:plc:carol' }),
      expect.any(Object),
    );
  });
});

describe('processBskyFollowJob', () => {
  it('does not create a duplicate remote follow record when one already exists', async () => {
    const get = vi.fn(() =>
      ResultAsync.fromSafePromise(
        Promise.resolve({
          records: [
            {
              uri: 'at://did:plc:alice/app.bsky.graph.follow/oldrkey',
              value: { subject: 'did:plc:bob' },
            },
          ],
        }),
      ),
    );
    const post = vi.fn();
    const upsertFollows = vi.fn(() =>
      ResultAsync.fromSafePromise(Promise.resolve({ inserted: 1 })),
    );
    const ctx = {
      clients: {
        bluesky: {
          restoreSession: vi.fn(() =>
            ResultAsync.fromSafePromise(Promise.resolve({ did: 'did:plc:alice', get, post })),
          ),
        },
      },
      repos: {
        bskyFollows: { upsertFollows },
      },
    } as unknown as AppContext;

    const result = await processBskyFollowJob(ctx, {
      action: 'follow',
      followerDid: 'did:plc:alice',
      targetDid: 'did:plc:bob',
      handle: 'bob.bsky.social',
      displayName: 'Bob',
    });

    expect(result).toEqual({
      ok: true,
      action: 'follow',
      alreadyExisted: true,
      uri: 'at://did:plc:alice/app.bsky.graph.follow/oldrkey',
    });
    expect(post).not.toHaveBeenCalled();
    expect(upsertFollows).toHaveBeenCalledWith({
      followerDid: 'did:plc:alice',
      follows: [{ did: 'did:plc:bob', handle: 'bob.bsky.social', displayName: 'Bob' }],
    });
  });
});

void ok;
