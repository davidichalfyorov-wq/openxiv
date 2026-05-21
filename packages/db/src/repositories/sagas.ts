import { eq } from 'drizzle-orm';
import { Errors, type AppResultAsync, fromPromise } from '@openxiv/shared';
import type { Database } from '../client.js';
import { submissionSagas } from '../schema/papers.js';

export type SagaRecord = typeof submissionSagas.$inferSelect;

export type SagaStage =
  | 'stagePaperPersisted'
  | 'stagePaperApproved'
  | 'stageIdAssigned'
  | 'stagePdsPaper'
  | 'stagePdsSummaryDisclosure'
  | 'stageBlueskyBridge';

export const SAGA_STAGE_ORDER: readonly SagaStage[] = [
  'stagePaperPersisted',
  'stagePaperApproved',
  'stageIdAssigned',
  'stagePdsPaper',
  'stagePdsSummaryDisclosure',
  'stageBlueskyBridge',
];

export interface SagasRepository {
  ensure(paperId: string): AppResultAsync<SagaRecord>;
  get(paperId: string): AppResultAsync<SagaRecord | null>;
  markStageDone(paperId: string, stage: SagaStage): AppResultAsync<void>;
  recordFailure(paperId: string, stage: SagaStage, error: string): AppResultAsync<void>;
  bumpAttempt(paperId: string): AppResultAsync<void>;
}

export function makeSagasRepository(db: Database): SagasRepository {
  return {
    ensure(paperId) {
      return fromPromise(
        db.insert(submissionSagas).values({ paperId }).onConflictDoNothing().returning(),
        (cause) => Errors.internal('sagas.ensure insert', cause),
      ).andThen((rows) => {
        if (rows[0]) return fromPromise(Promise.resolve(rows[0]));
        return fromPromise(
          db.select().from(submissionSagas).where(eq(submissionSagas.paperId, paperId)).limit(1),
          (cause) => Errors.internal('sagas.ensure read', cause),
        ).andThen((existing) =>
          existing[0]
            ? fromPromise(Promise.resolve(existing[0]))
            : fromPromise(Promise.reject(new Error('saga missing')), () =>
                Errors.internal('saga insert/read inconsistent'),
              ),
        );
      });
    },
    get(paperId) {
      return fromPromise(
        db
          .select()
          .from(submissionSagas)
          .where(eq(submissionSagas.paperId, paperId))
          .limit(1),
        (cause) => Errors.internal('sagas.get', cause),
      ).map((rows) => rows[0] ?? null);
    },
    markStageDone(paperId, stage) {
      return fromPromise(
        db
          .update(submissionSagas)
          .set({
            [stage]: true,
            updatedAt: new Date(),
            lastError: null,
            lastErrorStage: null,
          })
          .where(eq(submissionSagas.paperId, paperId)),
        (cause) => Errors.internal(`sagas.markStageDone ${stage}`, cause),
      ).map(() => undefined);
    },
    recordFailure(paperId, stage, error) {
      return fromPromise(
        db
          .update(submissionSagas)
          .set({
            lastError: error.slice(0, 4000),
            lastErrorStage: stage,
            updatedAt: new Date(),
          })
          .where(eq(submissionSagas.paperId, paperId)),
        (cause) => Errors.internal('sagas.recordFailure', cause),
      ).map(() => undefined);
    },
    bumpAttempt(paperId) {
      return fromPromise(
        db
          .update(submissionSagas)
          .set({
            attempts: 1, // overwritten by sql below
            updatedAt: new Date(),
          })
          .where(eq(submissionSagas.paperId, paperId)),
        (cause) => Errors.internal('sagas.bumpAttempt', cause),
      ).map(() => undefined);
    },
  };
}
