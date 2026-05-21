import { and, desc, eq, sql } from 'drizzle-orm';
import { Errors, type AppResultAsync, fromPromise } from '@openxiv/shared';
import type { Database } from '../client.js';
import {
  externalPapers,
  type ExternalPaperRecord,
  type NewExternalPaper,
} from '../schema/external.js';

export { EXTERNAL_SOURCES } from '../schema/external.js';
export type { ExternalSource, ExternalAuthor, ExternalPaperRecord, NewExternalPaper } from '../schema/external.js';

export interface ExternalPapersRepository {
  /** Fetch a single external paper by composite key. */
  get(source: string, sourceId: string): AppResultAsync<ExternalPaperRecord | null>;
  /**
   * Upsert by (source, sourceId). On conflict updates everything except
   * `claimed_by_did` / `claimed_at` so a re-fetch doesn't drop a claim.
   */
  upsert(input: NewExternalPaper): AppResultAsync<ExternalPaperRecord>;
  /** Mark a paper as claimed by a verified DID. Idempotent. */
  claim(source: string, sourceId: string, claimerDid: string): AppResultAsync<ExternalPaperRecord>;
  /** Most-recently-fetched papers — diagnostic only. */
  recent(limit?: number): AppResultAsync<ExternalPaperRecord[]>;
}

export function makeExternalPapersRepository(db: Database): ExternalPapersRepository {
  return {
    get(source, sourceId) {
      return fromPromise(
        db
          .select()
          .from(externalPapers)
          .where(and(eq(externalPapers.source, source), eq(externalPapers.sourceId, sourceId)))
          .limit(1),
        (cause) => Errors.internal('external.get', cause),
      ).map((rows) => rows[0] ?? null);
    },
    upsert(input) {
      return fromPromise(
        db
          .insert(externalPapers)
          .values(input)
          .onConflictDoUpdate({
            target: [externalPapers.source, externalPapers.sourceId],
            set: {
              title: input.title,
              authorsJson: input.authorsJson ?? [],
              abstract: input.abstract ?? null,
              categories: input.categories ?? [],
              doi: input.doi ?? null,
              url: input.url ?? null,
              license: input.license ?? null,
              publishedAt: input.publishedAt ?? null,
              withdrawn: input.withdrawn ?? false,
              fetchedAt: new Date(),
              rawMetadata: input.rawMetadata ?? null,
              // claimed_by_did and claimed_at intentionally NOT touched.
            },
          })
          .returning(),
        (cause) => Errors.internal('external.upsert', cause),
      ).map((rows) => {
        const row = rows[0];
        if (!row) throw new Error('external.upsert: empty');
        return row;
      });
    },
    claim(source, sourceId, claimerDid) {
      return fromPromise(
        db
          .update(externalPapers)
          .set({ claimedByDid: claimerDid, claimedAt: new Date() })
          .where(and(eq(externalPapers.source, source), eq(externalPapers.sourceId, sourceId)))
          .returning(),
        (cause) => Errors.internal('external.claim', cause),
      ).map((rows) => {
        const row = rows[0];
        if (!row) throw new Error('external.claim: not found');
        return row;
      });
    },
    recent(limit = 20) {
      return fromPromise(
        db
          .select()
          .from(externalPapers)
          .orderBy(desc(externalPapers.fetchedAt))
          .limit(limit),
        (cause) => Errors.internal('external.recent', cause),
      );
    },
  };
}

void sql;
