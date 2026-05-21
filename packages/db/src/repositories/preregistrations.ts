import { desc, eq } from 'drizzle-orm';
import { Errors, type AppResultAsync, fromPromise } from '@openxiv/shared';
import type { Database } from '../client.js';
import { preregistrations } from '../schema/papers.js';

export type PreregistrationRecord = typeof preregistrations.$inferSelect;
export type NewPreregistration = typeof preregistrations.$inferInsert;

export interface PreregistrationsRepository {
  create(input: NewPreregistration): AppResultAsync<PreregistrationRecord>;
  listByAuthor(did: string, limit?: number): AppResultAsync<PreregistrationRecord[]>;
  listByPaper(paperId: string): AppResultAsync<PreregistrationRecord[]>;
  findById(id: string): AppResultAsync<PreregistrationRecord | null>;
}

export function makePreregistrationsRepository(db: Database): PreregistrationsRepository {
  return {
    create(input) {
      return fromPromise(
        db.insert(preregistrations).values(input).returning(),
        (cause) => Errors.internal('preregistrations.create', cause),
      ).andThen((rows) => {
        const row = rows[0];
        return row
          ? fromPromise(Promise.resolve(row))
          : fromPromise(Promise.reject(new Error('no row')), () =>
              Errors.internal('preregistrations insert empty'),
            );
      });
    },
    listByAuthor(did, limit = 50) {
      return fromPromise(
        db
          .select()
          .from(preregistrations)
          .where(eq(preregistrations.authorDid, did))
          .orderBy(desc(preregistrations.registeredAt))
          .limit(limit),
        (cause) => Errors.internal('preregistrations.listByAuthor', cause),
      );
    },
    listByPaper(paperId) {
      return fromPromise(
        db
          .select()
          .from(preregistrations)
          .where(eq(preregistrations.paperId, paperId))
          .orderBy(desc(preregistrations.registeredAt)),
        (cause) => Errors.internal('preregistrations.listByPaper', cause),
      );
    },
    findById(id) {
      return fromPromise(
        db.select().from(preregistrations).where(eq(preregistrations.id, id)).limit(1),
        (cause) => Errors.internal('preregistrations.findById', cause),
      ).map((rows) => rows[0] ?? null);
    },
  };
}
