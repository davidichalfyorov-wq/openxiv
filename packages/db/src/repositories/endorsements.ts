import { and, desc, eq, sql } from 'drizzle-orm';
import { Errors, type AppResultAsync, fromPromise } from '@openxiv/shared';
import type { Database } from '../client.js';
import { endorsements } from '../schema/social.js';

export type EndorsementRecord = typeof endorsements.$inferSelect;
export type NewEndorsement = typeof endorsements.$inferInsert;

export interface EndorsementStats {
  /** Total endorsements on this paper. */
  total: number;
  /** Distinct non-null verb values among them. */
  distinctVerbs: number;
  /** Counts grouped by verb — null verbs collapsed under `_legacy`. */
  byVerb: Record<string, number>;
}

export interface EndorsementsRepository {
  /**
   * Counts endorsements and the diversity of `verb` values for a paper.
   * Used by the Social Review lane of Trust Passport. If the `verb` column
   * does not yet exist (pre-migration 0008), distinct-verb count returns 0
   * but total count is still accurate.
   */
  statsForPaper(paperId: string): AppResultAsync<EndorsementStats>;
  forPaper(paperId: string, opts?: { verb?: string }): AppResultAsync<EndorsementRecord[]>;
  /**
   * Upsert one (paperId, endorserDid) pair: a single user can endorse a
   * paper exactly once, but can change their verb/note by re-submitting.
   * Returns the resulting row.
   */
  upsert(input: NewEndorsement): AppResultAsync<EndorsementRecord>;
  remove(paperId: string, endorserDid: string): AppResultAsync<void>;
}

export function makeEndorsementsRepository(db: Database): EndorsementsRepository {
  return {
    statsForPaper(paperId) {
      const withVerb = fromPromise(
        db.execute<{ verb: string | null; count: number }>(
          sql`SELECT verb, COUNT(*)::int AS count
              FROM endorsements
              WHERE paper_id = ${paperId}::uuid
              GROUP BY verb`,
        ),
        (cause) => Errors.internal('endorsements.statsForPaper', cause),
      ).map((res) => {
        const byVerb: Record<string, number> = {};
        let total = 0;
        let distinctVerbs = 0;
        for (const row of res.rows) {
          total += row.count;
          if (row.verb) {
            byVerb[row.verb] = row.count;
            distinctVerbs += 1;
          } else {
            byVerb['_legacy'] = (byVerb['_legacy'] ?? 0) + row.count;
          }
        }
        return { total, distinctVerbs, byVerb };
      });

      // If the verb column doesn't exist yet (pre-0008), fall through to a
      // verb-free count; Trust Passport's Social Review lane then stays
      // 'pending' until the migration lands.
      return withVerb.orElse(() =>
        fromPromise(
          db.execute<{ total: number }>(
            sql`SELECT COUNT(*)::int AS total FROM endorsements WHERE paper_id = ${paperId}::uuid`,
          ),
          (cause) => Errors.internal('endorsements.statsForPaper.fallback', cause),
        ).map((res) => ({
          total: res.rows[0]?.total ?? 0,
          distinctVerbs: 0,
          byVerb: {} as Record<string, number>,
        })),
      );
    },
    forPaper(paperId, opts) {
      const conditions = [eq(endorsements.paperId, paperId)];
      if (opts?.verb) conditions.push(eq(endorsements.verb, opts.verb));
      return fromPromise(
        db
          .select()
          .from(endorsements)
          .where(and(...conditions))
          .orderBy(desc(endorsements.createdAt)),
        (cause) => Errors.internal('endorsements.forPaper', cause),
      );
    },
    upsert(input) {
      return fromPromise(
        db
          .insert(endorsements)
          .values(input)
          .onConflictDoUpdate({
            target: [endorsements.paperId, endorsements.endorserDid],
            set: {
              verb: input.verb ?? null,
              note: input.note ?? null,
              uri: input.uri,
            },
          })
          .returning(),
        (cause) => Errors.internal('endorsements.upsert', cause),
      ).map((rows) => {
        const row = rows[0];
        if (!row) throw new Error('endorsements.upsert: missing row');
        return row;
      });
    },
    remove(paperId, endorserDid) {
      return fromPromise(
        db
          .delete(endorsements)
          .where(
            and(
              eq(endorsements.paperId, paperId),
              eq(endorsements.endorserDid, endorserDid),
            ),
          ),
        (cause) => Errors.internal('endorsements.remove', cause),
      ).map(() => undefined);
    },
  };
}
