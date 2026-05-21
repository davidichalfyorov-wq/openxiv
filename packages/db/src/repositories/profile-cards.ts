import { and, eq } from 'drizzle-orm';
import { Errors, type AppResultAsync, fromPromise } from '@openxiv/shared';
import type { Database } from '../client.js';
import {
  profileCards,
  PROFILE_CARD_TYPES,
  type ProfileCardRecord,
  type ProfileCardType,
} from '../schema/profile-cards.js';

export { PROFILE_CARD_TYPES } from '../schema/profile-cards.js';
export type {
  ProfileCardType,
  ProfileCardRecord,
  AiPolicyContent,
  ReadingGuideContent,
} from '../schema/profile-cards.js';

export interface ProfileCardsRepository {
  /** Both cards for a user — missing entries returned as null in the map. */
  forUser(userId: string): AppResultAsync<Record<string, ProfileCardRecord>>;
  get(userId: string, cardType: ProfileCardType): AppResultAsync<ProfileCardRecord | null>;
  upsert(input: {
    userId: string;
    cardType: ProfileCardType;
    content: Record<string, unknown>;
  }): AppResultAsync<ProfileCardRecord>;
  remove(userId: string, cardType: ProfileCardType): AppResultAsync<void>;
}

export function makeProfileCardsRepository(db: Database): ProfileCardsRepository {
  return {
    forUser(userId) {
      return fromPromise(
        db.select().from(profileCards).where(eq(profileCards.userId, userId)),
        (cause) => Errors.internal('profileCards.forUser', cause),
      ).map((rows) => {
        const out: Record<string, ProfileCardRecord> = {};
        for (const r of rows) out[r.cardType] = r;
        return out;
      });
    },
    get(userId, cardType) {
      return fromPromise(
        db
          .select()
          .from(profileCards)
          .where(and(eq(profileCards.userId, userId), eq(profileCards.cardType, cardType)))
          .limit(1),
        (cause) => Errors.internal('profileCards.get', cause),
      ).map((rows) => rows[0] ?? null);
    },
    upsert(input) {
      if (!(PROFILE_CARD_TYPES as readonly string[]).includes(input.cardType)) {
        return fromPromise(
          Promise.reject(new Error(`invalid card_type: ${input.cardType}`)),
          (cause) => Errors.validation('invalid card_type', cause),
        );
      }
      return fromPromise(
        db
          .insert(profileCards)
          .values({
            userId: input.userId,
            cardType: input.cardType,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            contentJson: input.content as any,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [profileCards.userId, profileCards.cardType],
            set: {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              contentJson: input.content as any,
              updatedAt: new Date(),
            },
          })
          .returning(),
        (cause) => Errors.internal('profileCards.upsert', cause),
      ).map((rows) => {
        const r = rows[0];
        if (!r) throw new Error('profileCards.upsert: empty');
        return r;
      });
    },
    remove(userId, cardType) {
      return fromPromise(
        db
          .delete(profileCards)
          .where(and(eq(profileCards.userId, userId), eq(profileCards.cardType, cardType))),
        (cause) => Errors.internal('profileCards.remove', cause),
      ).map(() => undefined);
    },
  };
}
