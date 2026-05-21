import { and, eq } from 'drizzle-orm';
import { Errors, type AppResultAsync, fromPromise } from '@openxiv/shared';
import type { Database } from '../client.js';
import { follows } from '../schema/users.js';

export type FollowRecord = typeof follows.$inferSelect;

export interface FollowsRepository {
  follow(input: { followerDid: string; targetDid: string; uri?: string }): AppResultAsync<void>;
  unfollow(followerDid: string, targetDid: string): AppResultAsync<void>;
  followingDids(followerDid: string): AppResultAsync<string[]>;
  followerDids(targetDid: string): AppResultAsync<string[]>;
}

export function makeFollowsRepository(db: Database): FollowsRepository {
  return {
    follow(input) {
      return fromPromise(
        db
          .insert(follows)
          .values({ followerDid: input.followerDid, targetDid: input.targetDid, uri: input.uri ?? null })
          .onConflictDoNothing(),
        (cause) => Errors.internal('follows.follow', cause),
      ).map(() => undefined);
    },
    unfollow(followerDid, targetDid) {
      return fromPromise(
        db
          .delete(follows)
          .where(and(eq(follows.followerDid, followerDid), eq(follows.targetDid, targetDid))),
        (cause) => Errors.internal('follows.unfollow', cause),
      ).map(() => undefined);
    },
    followingDids(followerDid) {
      return fromPromise(
        db
          .select({ did: follows.targetDid })
          .from(follows)
          .where(eq(follows.followerDid, followerDid)),
        (cause) => Errors.internal('follows.followingDids', cause),
      ).map((rows) => rows.map((r) => r.did));
    },
    followerDids(targetDid) {
      return fromPromise(
        db
          .select({ did: follows.followerDid })
          .from(follows)
          .where(eq(follows.targetDid, targetDid)),
        (cause) => Errors.internal('follows.followerDids', cause),
      ).map((rows) => rows.map((r) => r.did));
    },
  };
}
