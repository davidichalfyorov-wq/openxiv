import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  Errors,
  type AppResultAsync,
  formatOpenxivId,
  fromPromise,
} from '@openxiv/shared';
import type { Database } from '../client.js';
import { papers } from '../schema/papers.js';

export interface IdAllocator {
  /** Atomically allocate the next sequence number for (subject, year). */
  allocate(subject: string, year: number): AppResultAsync<{ seq: number; openxivId: string }>;
  /** Inspect the next value without claiming. */
  peek(subject: string, year: number): AppResultAsync<number>;
  /**
   * Allocate-and-claim in a single transaction. Returns the existing id if
   * the paper already has one — guaranteed safe against concurrent retries
   * of the same saga stage. Counter never advances if claim raced.
   */
  allocateAndClaim(
    paperId: string,
    subject: string,
    year: number,
  ): AppResultAsync<{ openxivId: string }>;
}

export function makeIdAllocator(db: Database): IdAllocator {
  return {
    allocate(subject, year) {
      const query = sql<{ next_value: number }>`
        INSERT INTO id_counters AS c (subject, year, next_value)
        VALUES (${subject}, ${year}, 1)
        ON CONFLICT (subject, year)
        DO UPDATE SET next_value = c.next_value + 1
        RETURNING next_value
      `;
      return fromPromise(db.execute(query), (cause) =>
        Errors.internal(`id_counters allocate ${subject}/${year}`, cause),
      ).andThen((res) => {
        const row = (res.rows as Array<{ next_value: number | string }>)[0];
        if (!row) {
          return fromPromise(
            Promise.reject(new Error('id allocate returned no row')),
            () => Errors.internal('id allocate empty'),
          );
        }
        const seq = typeof row.next_value === 'string' ? Number.parseInt(row.next_value, 10) : row.next_value;
        return fromPromise(
          Promise.resolve({ seq, openxivId: formatOpenxivId(subject, year, seq) }),
        );
      });
    },
    peek(subject, year) {
      const query = sql<{ next_value: number }>`
        SELECT next_value FROM id_counters WHERE subject = ${subject} AND year = ${year}
      `;
      return fromPromise(db.execute(query), (cause) =>
        Errors.internal('id_counters peek', cause),
      ).map((res) => {
        const row = (res.rows as Array<{ next_value: number | string }>)[0];
        if (!row) return 1;
        return typeof row.next_value === 'string' ? Number.parseInt(row.next_value, 10) : row.next_value;
      });
    },
    allocateAndClaim(paperId, subject, year) {
      const work = async (): Promise<{ openxivId: string }> => {
        return db.transaction(async (tx) => {
          // SELECT FOR UPDATE pins the row so a concurrent claim blocks here.
          const existing = await tx
            .select({ openxivId: papers.openxivId })
            .from(papers)
            .where(eq(papers.id, paperId))
            .for('update');
          if (!existing[0]) {
            throw new Error(`paper ${paperId} not found`);
          }
          if (existing[0].openxivId) {
            return { openxivId: existing[0].openxivId };
          }
          const allocRes = await tx.execute(sql<{ next_value: number | string }>`
            INSERT INTO id_counters AS c (subject, year, next_value)
            VALUES (${subject}, ${year}, 1)
            ON CONFLICT (subject, year)
            DO UPDATE SET next_value = c.next_value + 1
            RETURNING next_value
          `);
          const row = (allocRes.rows as Array<{ next_value: number | string }>)[0];
          if (!row) throw new Error('id_counters returned no row');
          const seq =
            typeof row.next_value === 'string'
              ? Number.parseInt(row.next_value, 10)
              : row.next_value;
          const openxivId = formatOpenxivId(subject, year, seq);
          const updated = await tx
            .update(papers)
            .set({ openxivId, updatedAt: new Date() })
            .where(and(eq(papers.id, paperId), isNull(papers.openxivId)))
            .returning({ openxivId: papers.openxivId });
          // The SELECT FOR UPDATE should make this race impossible, but if
          // a parallel transaction claimed via a different code path, the
          // returning() will be empty — fall back to whatever is there.
          if (updated.length === 0) {
            const reread = await tx
              .select({ openxivId: papers.openxivId })
              .from(papers)
              .where(eq(papers.id, paperId));
            if (reread[0]?.openxivId) return { openxivId: reread[0].openxivId };
            throw new Error('claim lost and re-read empty');
          }
          return { openxivId };
        });
      };
      return fromPromise(work(), (cause) =>
        Errors.internal(`allocateAndClaim ${subject}/${year}/${paperId}`, cause),
      );
    },
  };
}
