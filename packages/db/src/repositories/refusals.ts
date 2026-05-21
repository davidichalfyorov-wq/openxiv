import { eq } from 'drizzle-orm';
import { Errors, type AppResultAsync, fromPromise } from '@openxiv/shared';
import type { Database } from '../client.js';
import {
  refusalPackets,
  REFUSAL_REASON_VALUES,
  type NewRefusalPacket,
  type RefusalPacketRecord,
} from '../schema/refusals.js';

export { REFUSAL_REASON_VALUES } from '../schema/refusals.js';
export type { RefusalReason, RefusalExample } from '../schema/refusals.js';

export interface RefusalsRepository {
  upsert(input: NewRefusalPacket): AppResultAsync<RefusalPacketRecord>;
  getByPaperId(paperId: string): AppResultAsync<RefusalPacketRecord | null>;
  rescind(paperId: string): AppResultAsync<void>;
}

export function makeRefusalsRepository(db: Database): RefusalsRepository {
  return {
    upsert(input) {
      // Defence-in-depth — the CHECK constraint in SQL prevents bad values,
      // but we'd rather fail fast in the repo with a typed error.
      if (!(REFUSAL_REASON_VALUES as readonly string[]).includes(input.reasonCategory)) {
        return fromPromise(
          Promise.reject(new Error(`invalid reason_category: ${input.reasonCategory}`)),
          (cause) => Errors.validation('invalid refusal reason category', cause),
        );
      }
      return fromPromise(
        db
          .insert(refusalPackets)
          .values(input)
          .onConflictDoUpdate({
            target: refusalPackets.paperId,
            set: {
              reasonCategory: input.reasonCategory,
              fixable: input.fixable ?? false,
              examples: input.examples ?? [],
              moderatorNote: input.moderatorNote,
              issuedByDid: input.issuedByDid,
              issuedAt: new Date(),
              rescindedAt: null,
            },
          })
          .returning(),
        (cause) => Errors.internal('refusals.upsert', cause),
      ).map((rows) => {
        const row = rows[0];
        if (!row) throw new Error('refusals.upsert: empty');
        return row;
      });
    },
    getByPaperId(paperId) {
      return fromPromise(
        db.select().from(refusalPackets).where(eq(refusalPackets.paperId, paperId)).limit(1),
        (cause) => Errors.internal('refusals.getByPaperId', cause),
      ).map((rows) => rows[0] ?? null);
    },
    rescind(paperId) {
      return fromPromise(
        db
          .update(refusalPackets)
          .set({ rescindedAt: new Date() })
          .where(eq(refusalPackets.paperId, paperId)),
        (cause) => Errors.internal('refusals.rescind', cause),
      ).map(() => undefined);
    },
  };
}
