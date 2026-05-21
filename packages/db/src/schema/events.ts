import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const FEED_EVENT_TYPES = [
  'feed_impression',
  'card_expand',
  'summary_level_click',
  'save',
  'hide',
  'question_asked',
  'paper_view',
  'pdf_download',
  'html_open',
  'profile_view',
  'endorse_click',
  'endorse_submit',
  'search_query',
  'signup_complete',
  'submit_complete',
] as const;
export type FeedEventType = (typeof FEED_EVENT_TYPES)[number];

export const FEED_EVENT_TARGET_TYPES = [
  'openxiv_paper',
  'external_paper',
  'section',
  'post',
  'profile',
  'search',
  'auth',
  'submission',
  'other',
] as const;
export type FeedEventTargetType = (typeof FEED_EVENT_TARGET_TYPES)[number];

export const feedEvents = pgTable(
  'feed_events',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userDid: text('user_did'),
    sessionId: text('session_id').notNull(),
    eventType: text('event_type').notNull(),
    targetUri: text('target_uri').notNull(),
    targetType: text('target_type').notNull(),
    contextJson: jsonb('context_json').$type<Record<string, unknown>>(),
    ipHashDaily: text('ip_hash_daily'),
    countryCode: text('country_code'),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sessionIdx: index('feed_events_session_idx').on(t.sessionId, t.eventType, t.targetUri),
    targetIdx: index('feed_events_target_idx').on(t.targetUri, t.eventType, t.ts),
    tsIdx: index('feed_events_ts_idx').on(t.ts),
    countryIdx: index('feed_events_country_idx').on(t.countryCode, t.ts),
  }),
);

export type FeedEventRecord = typeof feedEvents.$inferSelect;
export type NewFeedEvent = typeof feedEvents.$inferInsert;
