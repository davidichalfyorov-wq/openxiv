import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const FEATURED_TARGET_TYPES = ['openxiv_paper', 'external_paper'] as const;
export type FeaturedTargetType = (typeof FEATURED_TARGET_TYPES)[number];

export const featuredItems = pgTable(
  'featured_items',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    targetUri: text('target_uri').notNull(),
    targetType: text('target_type').notNull(),
    reasonCardMd: text('reason_card_md').notNull(),
    curatorDid: text('curator_did').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    position: integer('position').notNull().default(0),
  },
  (t) => ({
    positionIdx: index('featured_items_position_idx').on(t.position, t.startedAt),
    expiresIdx: index('featured_items_expires_idx').on(t.expiresAt),
  }),
);

export type FeaturedItemRecord = typeof featuredItems.$inferSelect;
export type NewFeaturedItem = typeof featuredItems.$inferInsert;
