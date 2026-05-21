import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { Errors, type AppResultAsync, fromPromise } from '@openxiv/shared';
import type { Database } from '../client.js';
import { posts } from '../schema/social.js';

export type PostRecord = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;

export interface PostsRepository {
  create(input: NewPost): AppResultAsync<PostRecord>;
  findById(id: string): AppResultAsync<PostRecord | null>;
  findByUri(uri: string): AppResultAsync<PostRecord | null>;
  listByAuthor(did: string, limit?: number, offset?: number): AppResultAsync<PostRecord[]>;
  feedFromDids(dids: string[], limit?: number): AppResultAsync<PostRecord[]>;
  listRecent(limit?: number): AppResultAsync<PostRecord[]>;
  /**
   * Seminar Thread for a paper: all posts whose embedPaperUri matches.
   * `includeHidden` defaults to false — mods toggle on for the queue view.
   * Pinned posts come first, then chronological.
   */
  forPaperUri(paperUri: string, opts?: { includeHidden?: boolean; limit?: number }): AppResultAsync<PostRecord[]>;
  setLabel(id: string, label: string | null): AppResultAsync<PostRecord>;
  setPinned(paperUri: string, postId: string | null): AppResultAsync<void>;
  setHidden(id: string, hidden: boolean): AppResultAsync<PostRecord>;
}

export function makePostsRepository(db: Database): PostsRepository {
  return {
    create(input) {
      return fromPromise(
        db.insert(posts).values(input).returning(),
        (cause) => Errors.internal('posts.create', cause),
      ).andThen((rows) => {
        const row = rows[0];
        return row
          ? fromPromise(Promise.resolve(row))
          : fromPromise(Promise.reject(new Error('no row')), (c) =>
              Errors.internal('posts.create empty', c),
            );
      });
    },
    findById(id) {
      return fromPromise(
        db.select().from(posts).where(eq(posts.id, id)).limit(1),
        (cause) => Errors.internal('posts.findById', cause),
      ).map((rows) => rows[0] ?? null);
    },
    findByUri(uri) {
      return fromPromise(
        db.select().from(posts).where(eq(posts.uri, uri)).limit(1),
        (cause) => Errors.internal('posts.findByUri', cause),
      ).map((rows) => rows[0] ?? null);
    },
    listByAuthor(did, limit = 20, offset = 0) {
      return fromPromise(
        db
          .select()
          .from(posts)
          .where(eq(posts.authorDid, did))
          .orderBy(desc(posts.createdAt))
          .limit(limit)
          .offset(offset),
        (cause) => Errors.internal('posts.listByAuthor', cause),
      );
    },
    feedFromDids(dids, limit = 50) {
      if (dids.length === 0) {
        return fromPromise(Promise.resolve<PostRecord[]>([]));
      }
      return fromPromise(
        db
          .select()
          .from(posts)
          .where(inArray(posts.authorDid, dids))
          .orderBy(desc(posts.createdAt))
          .limit(limit),
        (cause) => Errors.internal('posts.feedFromDids', cause),
      );
    },
    listRecent(limit = 50) {
      return fromPromise(
        db.select().from(posts).orderBy(desc(posts.createdAt)).limit(limit),
        (cause) => Errors.internal('posts.listRecent', cause),
      );
    },
    forPaperUri(paperUri, opts = {}) {
      const conditions = [eq(posts.embedPaperUri, paperUri)];
      if (!opts.includeHidden) conditions.push(eq(posts.hiddenByMod, false));
      return fromPromise(
        db
          .select()
          .from(posts)
          .where(and(...conditions))
          // pinned first, then newest first.
          .orderBy(desc(posts.pinnedByAuthor), asc(posts.createdAt))
          .limit(opts.limit ?? 100),
        (cause) => Errors.internal('posts.forPaperUri', cause),
      );
    },
    setLabel(id, label) {
      return fromPromise(
        db.update(posts).set({ label }).where(eq(posts.id, id)).returning(),
        (cause) => Errors.internal('posts.setLabel', cause),
      ).map((rows) => {
        const row = rows[0];
        if (!row) throw new Error('posts.setLabel: no row');
        return row;
      });
    },
    setPinned(paperUri, postId) {
      const work = async (): Promise<void> => {
        // Clear any existing pin for this paper, then optionally set the new
        // one. Done in one transaction so a brief overlapping-pin state
        // can't exist for concurrent readers.
        await db.transaction(async (tx) => {
          await tx
            .update(posts)
            .set({ pinnedByAuthor: false })
            .where(and(eq(posts.embedPaperUri, paperUri), eq(posts.pinnedByAuthor, true)));
          if (postId) {
            await tx
              .update(posts)
              .set({ pinnedByAuthor: true })
              .where(and(eq(posts.id, postId), eq(posts.embedPaperUri, paperUri)));
          }
        });
      };
      return fromPromise(work(), (cause) => Errors.internal('posts.setPinned', cause));
    },
    setHidden(id, hidden) {
      return fromPromise(
        db.update(posts).set({ hiddenByMod: hidden }).where(eq(posts.id, id)).returning(),
        (cause) => Errors.internal('posts.setHidden', cause),
      ).map((rows) => {
        const row = rows[0];
        if (!row) throw new Error('posts.setHidden: no row');
        return row;
      });
    },
  };
}

void sql;
