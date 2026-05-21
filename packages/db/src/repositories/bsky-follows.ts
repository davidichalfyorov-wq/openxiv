import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { Errors, type AppResultAsync, fromPromise } from '@openxiv/shared';
import type { Database } from '../client.js';
import { bskyFollows } from '../schema/bluesky.js';

export type BskyFollowRecord = typeof bskyFollows.$inferSelect;
export type NewBskyFollow = typeof bskyFollows.$inferInsert;

export interface BskyFollowsRepository {
  /** Bulk-upsert a fresh set of follows for the signed-in user. */
  upsertFollows(input: {
    followerDid: string;
    follows: Array<{ did: string; handle?: string | null; displayName?: string | null }>;
  }): AppResultAsync<{ inserted: number }>;
  /** Has the follower mirrored anyone? Used to render "you follow on Bluesky". */
  follows(followerDid: string, candidateDids: string[]): AppResultAsync<string[]>;
  /** All follows for a follower DID, newest fetch first. Diagnostic only. */
  list(followerDid: string, limit?: number): AppResultAsync<BskyFollowRecord[]>;
  /** Clear all follows for a follower (opt-out). */
  forget(followerDid: string): AppResultAsync<void>;
  /** Remove one mirrored follow row after a remote unfollow. */
  remove(followerDid: string, followingDid: string): AppResultAsync<void>;
  /** When was the latest sync, for staleness-aware re-fetch logic. */
  latestFetchedAt(followerDid: string): AppResultAsync<Date | null>;
}

const STALE_AFTER_MS = 24 * 3600 * 1000;

export function makeBskyFollowsRepository(db: Database): BskyFollowsRepository {
  return {
    upsertFollows({ followerDid, follows }) {
      if (follows.length === 0) {
        return fromPromise(Promise.resolve(undefined), () =>
          Errors.internal('bskyFollows.upsertFollows.empty'),
        ).map(() => ({ inserted: 0 }));
      }
      const rows: NewBskyFollow[] = follows.map((f) => ({
        followerDid,
        followingDid: f.did,
        followingHandle: f.handle ?? null,
        followingDisplayName: f.displayName ?? null,
        fetchedAt: new Date(),
      }));
      return fromPromise(
        db
          .insert(bskyFollows)
          .values(rows)
          .onConflictDoUpdate({
            target: [bskyFollows.followerDid, bskyFollows.followingDid],
            set: {
              followingHandle: sql`excluded.following_handle`,
              followingDisplayName: sql`excluded.following_display_name`,
              fetchedAt: sql`excluded.fetched_at`,
            },
          }),
        (cause) => Errors.internal('bskyFollows.upsertFollows', cause),
      ).map(() => ({ inserted: rows.length }));
    },
    follows(followerDid, candidateDids) {
      if (candidateDids.length === 0) {
        return fromPromise(Promise.resolve([]), () =>
          Errors.internal('bskyFollows.follows.empty'),
        ) as AppResultAsync<string[]>;
      }
      return fromPromise(
        db
          .select({ following: bskyFollows.followingDid })
          .from(bskyFollows)
          .where(
            and(
              eq(bskyFollows.followerDid, followerDid),
              inArray(bskyFollows.followingDid, candidateDids),
            ),
          ),
        (cause) => Errors.internal('bskyFollows.follows', cause),
      ).map((rows) => rows.map((r) => r.following));
    },
    list(followerDid, limit = 200) {
      return fromPromise(
        db
          .select()
          .from(bskyFollows)
          .where(eq(bskyFollows.followerDid, followerDid))
          .orderBy(desc(bskyFollows.fetchedAt))
          .limit(limit),
        (cause) => Errors.internal('bskyFollows.list', cause),
      );
    },
    forget(followerDid) {
      return fromPromise(
        db.delete(bskyFollows).where(eq(bskyFollows.followerDid, followerDid)),
        (cause) => Errors.internal('bskyFollows.forget', cause),
      ).map(() => undefined);
    },
    remove(followerDid, followingDid) {
      return fromPromise(
        db
          .delete(bskyFollows)
          .where(
            and(
              eq(bskyFollows.followerDid, followerDid),
              eq(bskyFollows.followingDid, followingDid),
            ),
          ),
        (cause) => Errors.internal('bskyFollows.remove', cause),
      ).map(() => undefined);
    },
    latestFetchedAt(followerDid) {
      return fromPromise(
        db
          .select({ fetchedAt: bskyFollows.fetchedAt })
          .from(bskyFollows)
          .where(eq(bskyFollows.followerDid, followerDid))
          .orderBy(desc(bskyFollows.fetchedAt))
          .limit(1),
        (cause) => Errors.internal('bskyFollows.latestFetchedAt', cause),
      ).map((rows) => rows[0]?.fetchedAt ?? null);
    },
  };
}

export const __follows_testing = { STALE_AFTER_MS };
void gt; // re-exported intentionally for future delete-by-age
