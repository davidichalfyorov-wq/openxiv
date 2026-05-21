import type { BlueskyAgentSession } from '@openxiv/clients';
import type { UserRecord } from '@openxiv/db';
import { Errors } from '@openxiv/shared';
import type { AppContext } from '../context.js';

export const BSKY_FOLLOW_QUEUE_RATE_LIMIT = {
  max: 50,
  duration: 60_000,
} as const;

export interface BskyFollowJobData {
  action: 'follow' | 'unfollow';
  followerDid: string;
  targetDid: string;
  handle?: string | null;
  displayName?: string | null;
}

interface BskyListFollowRecordsResponse {
  cursor?: string;
  records: Array<{
    uri: string;
    value?: { subject?: string };
  }>;
}

export async function enqueueBskyFollowJob(
  ctx: AppContext,
  user: UserRecord & { blueskyDid: string },
  input: {
    action: 'follow' | 'unfollow';
    targetDid: string;
    handle?: string | null;
    displayName?: string | null;
  },
): Promise<{ queued: true; jobId: string }> {
  if (input.targetDid === user.blueskyDid) {
    throw Errors.validation('cannot follow yourself');
  }
  const data: BskyFollowJobData = {
    action: input.action,
    followerDid: user.blueskyDid,
    targetDid: input.targetDid,
    ...(input.handle !== undefined ? { handle: input.handle } : {}),
    ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
  };
  const deterministicId = [
    'bsky-follow',
    input.action,
    encodeURIComponent(user.blueskyDid),
    encodeURIComponent(input.targetDid),
  ].join('|');
  const job = await ctx.queues.bskyFollow.add('bsky-follow', data, {
    jobId: deterministicId,
    attempts: 5,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: true,
    removeOnFail: { count: 1000, age: 3_600 * 24 * 30 },
  });
  return { queued: true, jobId: job.id ?? deterministicId };
}

export async function processBskyFollowJob(
  ctx: AppContext,
  data: BskyFollowJobData,
): Promise<
  | { ok: true; action: 'follow'; alreadyExisted: boolean; uri: string }
  | { ok: true; action: 'unfollow'; deleted: boolean }
> {
  const sessionResult = await ctx.clients.bluesky.restoreSession(data.followerDid);
  if (sessionResult.isErr()) throw sessionResult.error;
  const session = sessionResult.value;

  if (data.action === 'follow') {
    const existing = await findFollowRecord(session, data.targetDid);
    if (existing) {
      await mirrorFollow(ctx, data);
      return { ok: true, action: 'follow', alreadyExisted: true, uri: existing.uri };
    }
    const written = await session.post<{ uri: string; cid: string }>(
      'com.atproto.repo.createRecord',
      {
        repo: session.did,
        collection: 'app.bsky.graph.follow',
        record: {
          $type: 'app.bsky.graph.follow',
          subject: data.targetDid,
          createdAt: new Date().toISOString(),
        },
      },
    );
    if (written.isErr()) throw written.error;
    await mirrorFollow(ctx, data);
    return { ok: true, action: 'follow', alreadyExisted: false, uri: written.value.uri };
  }

  const found = await findFollowRecord(session, data.targetDid);
  if (found) {
    const deleted = await session.post('com.atproto.repo.deleteRecord', {
      repo: session.did,
      collection: 'app.bsky.graph.follow',
      rkey: found.rkey,
    });
    if (deleted.isErr()) throw deleted.error;
  }
  const mirrored = await ctx.repos.bskyFollows.remove(data.followerDid, data.targetDid);
  if (mirrored.isErr()) throw mirrored.error;
  return { ok: true, action: 'unfollow', deleted: Boolean(found) };
}

async function mirrorFollow(ctx: AppContext, data: BskyFollowJobData): Promise<void> {
  const mirrored = await ctx.repos.bskyFollows.upsertFollows({
    followerDid: data.followerDid,
    follows: [
      {
        did: data.targetDid,
        handle: data.handle ?? null,
        displayName: data.displayName ?? null,
      },
    ],
  });
  if (mirrored.isErr()) throw mirrored.error;
}

async function findFollowRecord(
  session: BlueskyAgentSession,
  targetDid: string,
): Promise<{ uri: string; rkey: string } | null> {
  let cursor: string | undefined;
  for (let pageNo = 0; pageNo < 20; pageNo++) {
    const page = await session.get<BskyListFollowRecordsResponse>('com.atproto.repo.listRecords', {
      repo: session.did,
      collection: 'app.bsky.graph.follow',
      limit: '100',
      ...(cursor ? { cursor } : {}),
    });
    if (page.isErr()) throw page.error;
    for (const record of page.value.records) {
      if (record.value?.subject === targetDid) {
        const rkey = record.uri.split('/').pop();
        return rkey ? { uri: record.uri, rkey } : null;
      }
    }
    if (!page.value.cursor) return null;
    cursor = page.value.cursor;
  }
  return null;
}
