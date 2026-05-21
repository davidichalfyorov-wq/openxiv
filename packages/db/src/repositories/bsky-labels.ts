import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { Errors, type AppResultAsync, fromPromise } from '@openxiv/shared';
import type { Database } from '../client.js';
import { bskyLabels, type BskyLabelValue } from '../schema/bluesky.js';

export type BskyLabelRecord = typeof bskyLabels.$inferSelect;
export type NewBskyLabel = typeof bskyLabels.$inferInsert;

export interface BskyLabelsRepository {
  /**
   * Apply a label to a Bluesky post URI. Idempotent on (uri, val) — the
   * unique partial index `bsky_labels_unique_active_idx` enforces it at the
   * DB level; re-applying a label is a no-op. To toggle off the label, call
   * `negate(uri, val)` which inserts a new row with neg=true; the same
   * uri+val pair can be re-applied later (new row, new cts).
   */
  apply(input: { src: string; uri: string; cid?: string | null; val: BskyLabelValue }): AppResultAsync<BskyLabelRecord>;
  /** Negate a previously-applied label. */
  negate(input: { src: string; uri: string; val: BskyLabelValue }): AppResultAsync<void>;
  /** All currently-active labels on the given uri(s). */
  query(input: { uriPatterns: string[] }): AppResultAsync<BskyLabelRecord[]>;
  /** Count active labels by value (diagnostic dashboard). */
  countByVal(): AppResultAsync<Record<string, number>>;
}

export function makeBskyLabelsRepository(db: Database): BskyLabelsRepository {
  return {
    apply({ src, uri, cid, val }) {
      const insert: NewBskyLabel = {
        src,
        uri,
        cid: cid ?? null,
        val,
        neg: false,
      };
      return fromPromise(
        db
          .insert(bskyLabels)
          .values(insert)
          .onConflictDoUpdate({
            target: [bskyLabels.uri, bskyLabels.val],
            set: { cts: sql`now()`, cid: sql`excluded.cid` },
          })
          .returning(),
        (cause) => Errors.internal('bskyLabels.apply', cause),
      ).map((rows) => rows[0]!);
    },
    negate({ src, uri, val }) {
      return fromPromise(
        db.insert(bskyLabels).values({ src, uri, val, neg: true }),
        (cause) => Errors.internal('bskyLabels.negate', cause),
      ).map(() => undefined);
    },
    query({ uriPatterns }) {
      if (uriPatterns.length === 0) {
        return fromPromise(Promise.resolve([] as BskyLabelRecord[]), () =>
          Errors.internal('bskyLabels.query.empty'),
        );
      }
      return fromPromise(
        db
          .select()
          .from(bskyLabels)
          .where(and(inArray(bskyLabels.uri, uriPatterns), eq(bskyLabels.neg, false)))
          .orderBy(desc(bskyLabels.cts)),
        (cause) => Errors.internal('bskyLabels.query', cause),
      );
    },
    countByVal() {
      return fromPromise(
        db
          .select({ val: bskyLabels.val, count: sql<number>`count(*)::int` })
          .from(bskyLabels)
          .where(eq(bskyLabels.neg, false))
          .groupBy(bskyLabels.val),
        (cause) => Errors.internal('bskyLabels.countByVal', cause),
      ).map((rows) => Object.fromEntries(rows.map((r) => [r.val, r.count])));
    },
  };
}
