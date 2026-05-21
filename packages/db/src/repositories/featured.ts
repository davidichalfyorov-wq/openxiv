import { asc, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { Errors, type AppResultAsync, fromPromise } from '@openxiv/shared';
import type { Database } from '../client.js';
import {
  featuredItems,
  FEATURED_TARGET_TYPES,
  type FeaturedItemRecord,
  type NewFeaturedItem,
} from '../schema/featured.js';

export { FEATURED_TARGET_TYPES } from '../schema/featured.js';
export type { FeaturedTargetType, FeaturedItemRecord, NewFeaturedItem } from '../schema/featured.js';

export interface FeaturedRepository {
  /** Currently-active items, sorted by position ASC then startedAt DESC. */
  listActive(limit?: number): AppResultAsync<FeaturedItemRecord[]>;
  /** All items including expired — admin view. */
  listAll(limit?: number): AppResultAsync<FeaturedItemRecord[]>;
  get(id: string): AppResultAsync<FeaturedItemRecord | null>;
  create(input: NewFeaturedItem): AppResultAsync<FeaturedItemRecord>;
  update(
    id: string,
    patch: Partial<Pick<NewFeaturedItem, 'targetUri' | 'targetType' | 'reasonCardMd' | 'startedAt' | 'expiresAt' | 'position'>>,
  ): AppResultAsync<FeaturedItemRecord>;
  remove(id: string): AppResultAsync<void>;
}

export function makeFeaturedRepository(db: Database): FeaturedRepository {
  return {
    listActive(limit = 12) {
      return fromPromise(
        db
          .select()
          .from(featuredItems)
          .where(
            or(isNull(featuredItems.expiresAt), gt(featuredItems.expiresAt, new Date())),
          )
          .orderBy(asc(featuredItems.position), desc(featuredItems.startedAt))
          .limit(limit),
        (cause) => Errors.internal('featured.listActive', cause),
      );
    },
    listAll(limit = 100) {
      return fromPromise(
        db
          .select()
          .from(featuredItems)
          .orderBy(asc(featuredItems.position), desc(featuredItems.startedAt))
          .limit(limit),
        (cause) => Errors.internal('featured.listAll', cause),
      );
    },
    get(id) {
      return fromPromise(
        db.select().from(featuredItems).where(eq(featuredItems.id, id)).limit(1),
        (cause) => Errors.internal('featured.get', cause),
      ).map((rows) => rows[0] ?? null);
    },
    create(input) {
      if (!(FEATURED_TARGET_TYPES as readonly string[]).includes(input.targetType)) {
        return fromPromise(
          Promise.reject(new Error(`invalid target_type: ${input.targetType}`)),
          (cause) => Errors.validation('invalid target_type', cause),
        );
      }
      if (!input.reasonCardMd || input.reasonCardMd.length < 80) {
        return fromPromise(
          Promise.reject(new Error('reason_card_md must be at least 80 chars')),
          (cause) => Errors.validation('reason card too short', cause),
        );
      }
      return fromPromise(
        db.insert(featuredItems).values(input).returning(),
        (cause) => Errors.internal('featured.create', cause),
      ).map((rows) => {
        const r = rows[0];
        if (!r) throw new Error('featured.create: empty');
        return r;
      });
    },
    update(id, patch) {
      if (patch.reasonCardMd !== undefined && patch.reasonCardMd.length < 80) {
        return fromPromise(
          Promise.reject(new Error('reason_card_md must be at least 80 chars')),
          (cause) => Errors.validation('reason card too short', cause),
        );
      }
      return fromPromise(
        db.update(featuredItems).set(patch).where(eq(featuredItems.id, id)).returning(),
        (cause) => Errors.internal('featured.update', cause),
      ).map((rows) => {
        const r = rows[0];
        if (!r) throw new Error('featured.update: not found');
        return r;
      });
    },
    remove(id) {
      return fromPromise(
        db.delete(featuredItems).where(eq(featuredItems.id, id)),
        (cause) => Errors.internal('featured.remove', cause),
      ).map(() => undefined);
    },
  };
}

void sql;
