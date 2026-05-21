import { boolean, index, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * Mirror of the user's Bluesky follow graph at sign-in time. Lets profile
 * pages render "you follow on Bluesky" without proxying live XRPC calls.
 * Refreshed on a TTL (default 24h) — opt-out lives on `users`.
 */
export const bskyFollows = pgTable(
  'bsky_follows',
  {
    followerDid: text('follower_did').notNull(),
    followingDid: text('following_did').notNull(),
    followingHandle: text('following_handle'),
    followingDisplayName: text('following_display_name'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.followerDid, t.followingDid] }),
    followingIdx: index('bsky_follows_following_idx').on(t.followingDid),
    fetchedIdx: index('bsky_follows_fetched_idx').on(t.fetchedAt),
  }),
);

export type BskyLabelValue = 'openxiv-paper' | 'high-disclosure' | 'needs-question';

/**
 * Labels OpenXiv's labeler service has emitted on app.bsky.feed.post records
 * that mention or quote an OpenXiv paper. Served via
 * com.atproto.label.queryLabels.
 */
export const bskyLabels = pgTable(
  'bsky_labels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    src: text('src').notNull(),
    uri: text('uri').notNull(),
    cid: text('cid'),
    val: text('val').$type<BskyLabelValue>().notNull(),
    neg: boolean('neg').notNull().default(false),
    cts: timestamp('cts', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uriIdx: index('bsky_labels_uri_idx').on(t.uri),
    valIdx: index('bsky_labels_val_idx').on(t.val),
    uniqueActiveIdx: uniqueIndex('bsky_labels_unique_active_idx').on(t.uri, t.val),
  }),
);
