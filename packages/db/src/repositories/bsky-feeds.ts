import { sql } from 'drizzle-orm';
import { Errors, type AppResultAsync, fromPromise } from '@openxiv/shared';
import type { Database } from '../client.js';

/**
 * SQL access for Bluesky feed skeletons. Each method maps to one custom feed
 * the app hosts; the API layer wraps these with cursor/limit decoding and
 * caching.
 *
 * All feeds share an invariant: only rows where the bridge has emitted a
 * Bluesky post (`paper_versions.bridge_status='posted'`) are visible — the
 * App View can't hydrate a paper-only URI, and showing dead entries would
 * waste the user's scroll. They also surface only the *latest bridged
 * version*, so v2-as-reply doesn't double-count in /latest.
 */
export type BskyFeedName =
  | 'openxiv-latest'
  | 'openxiv-featured'
  | 'openxiv-questions'
  | 'openxiv-disclosed'
  | 'openxiv-beginner'
  | 'openxiv-claims';

export interface BskyFeedSkeletonRow {
  bskyPostUri: string;
}

export interface BskyFeedsRepository {
  skeleton(input: {
    feed: BskyFeedName;
    limit: number;
    offset: number;
  }): AppResultAsync<BskyFeedSkeletonRow[]>;
}

export function makeBskyFeedsRepository(db: Database): BskyFeedsRepository {
  return {
    skeleton({ feed, limit, offset }) {
      const q = feedQuery(feed, limit, offset);
      return fromPromise(
        db.execute<{ bsky_post_uri: string }>(q),
        (cause) => Errors.internal(`bskyFeeds.skeleton.${feed}`, cause),
      ).map((res) =>
        res.rows.map((r) => ({ bskyPostUri: r.bsky_post_uri })),
      );
    },
  };
}

function feedQuery(feed: BskyFeedName, limit: number, offset: number): ReturnType<typeof sql> {
  // Common subquery: latest bridged version per paper. We do this as a
  // correlated subquery on MAX(version_number) rather than a window function
  // so the row order is stable on Postgres 14+ without additional indexes.
  const base = sql`
    FROM paper_versions pv
    JOIN papers p ON p.id = pv.paper_id
    WHERE p.status = 'published'
      AND pv.bridge_status = 'posted'
      AND pv.bsky_post_uri IS NOT NULL
      AND pv.version_number = (
        SELECT MAX(pv2.version_number)
        FROM paper_versions pv2
        WHERE pv2.paper_id = p.id AND pv2.bridge_status = 'posted'
      )
  `;
  switch (feed) {
    case 'openxiv-latest':
      return sql`
        SELECT pv.bsky_post_uri ${base}
        ORDER BY pv.bridge_attempted_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    case 'openxiv-featured':
      return sql`
        SELECT pv.bsky_post_uri ${base}
          AND EXISTS (
            SELECT 1 FROM featured_items fi
            WHERE fi.paper_id = p.id AND fi.expires_at > now()
          )
        ORDER BY pv.bridge_attempted_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    case 'openxiv-questions':
      return sql`
        SELECT pv.bsky_post_uri ${base}
          AND p.one_hard_question IS NOT NULL
          AND length(p.one_hard_question) > 12
        ORDER BY pv.bridge_attempted_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    case 'openxiv-disclosed':
      return sql`
        SELECT pv.bsky_post_uri ${base}
          AND EXISTS (
            SELECT 1 FROM disclosures d
            WHERE d.paper_id = p.id AND d.level = 'primary'
          )
        ORDER BY pv.bridge_attempted_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    case 'openxiv-beginner':
      return sql`
        SELECT pv.bsky_post_uri ${base}
          AND EXISTS (
            SELECT 1 FROM summaries s
            WHERE s.paper_id = p.id AND s.tier = 'school' AND length(s.text) > 200
          )
        ORDER BY pv.bridge_attempted_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    case 'openxiv-claims':
      return sql`
        SELECT pv.bsky_post_uri ${base}
          AND jsonb_array_length(COALESCE(p.launch_kit -> 'claimCards', '[]'::jsonb)) >= 2
        ORDER BY pv.bridge_attempted_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
  }
}

export const __feeds_testing = { feedQuery };
