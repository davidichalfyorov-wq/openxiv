import { sql } from 'drizzle-orm';
import { jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

export const PROFILE_CARD_TYPES = ['ai_policy', 'reading_guide'] as const;
export type ProfileCardType = (typeof PROFILE_CARD_TYPES)[number];

/**
 * AI policy card shape (lexicon: app.openxiv.profileAiPolicy).
 * Every field is optional so an author can fill in what they actually
 * use and leave the rest blank rather than guess.
 */
export interface AiPolicyContent {
  models_used?: string[];
  models_avoided?: string[];
  use_cases?: string[];
  verification_practice?: string;
  failure_modes?: string;
}

/**
 * Reading guide card shape — pinned to the profile so a curious reader
 * can pick up the author's work without flailing.
 */
export interface ReadingGuideContent {
  prerequisites?: string;
  start_here?: string;
  avoid_starting_with?: string;
  common_pitfalls?: string;
}

export const profileCards = pgTable(
  'profile_cards',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    cardType: text('card_type').notNull(),
    contentJson: jsonb('content_json').$type<AiPolicyContent | ReadingGuideContent>().notNull().default(sql`'{}'::jsonb`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.cardType] }),
  }),
);

export type ProfileCardRecord = typeof profileCards.$inferSelect;
export type NewProfileCard = typeof profileCards.$inferInsert;
