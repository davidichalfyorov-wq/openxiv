import { type AppResultAsync } from '@openxiv/shared';
import type { AppContext } from '../context.js';
import type { BskyFeedName } from '@openxiv/db';

/**
 * Bluesky feed skeleton compositor. Each feed maps a SQL query to a stream
 * of bridged Bluesky post URIs (paper_versions.bsky_post_uri) — the App View
 * hydrates those URIs against the bskyverse, so the user sees the actual
 * embed-rich post in their client.
 *
 * Cursor is a simple numeric offset stringified for opacity. We don't expose
 * pagination beyond the latest 5000 items per feed.
 */

export const FEED_NAMES = [
  'openxiv-latest',
  'openxiv-featured',
  'openxiv-questions',
  'openxiv-disclosed',
  'openxiv-beginner',
  'openxiv-claims',
] as const;
export type FeedName = BskyFeedName;

export interface FeedDescriptor {
  readonly name: FeedName;
  readonly displayName: string;
  readonly description: string;
}

export const FEED_DESCRIPTORS: Readonly<Record<FeedName, FeedDescriptor>> = {
  'openxiv-latest': {
    name: 'openxiv-latest',
    displayName: 'OpenXiv — latest papers',
    description: 'Every new paper as it lands. Embed-rich Bluesky posts with one-tap to abstract.',
  },
  'openxiv-featured': {
    name: 'openxiv-featured',
    displayName: 'OpenXiv — featured',
    description: 'Editor picks: papers worth your attention right now, with reasons.',
  },
  'openxiv-questions': {
    name: 'openxiv-questions',
    displayName: 'OpenXiv — hard questions',
    description: 'Papers whose authors pinned one hard, unresolved question.',
  },
  'openxiv-disclosed': {
    name: 'openxiv-disclosed',
    displayName: 'OpenXiv — fully disclosed',
    description: 'Papers with primary-author AI disclosure: machine + human transparency.',
  },
  'openxiv-beginner': {
    name: 'openxiv-beginner',
    displayName: 'OpenXiv — explain like I\'m new',
    description: 'Each paper has a school-level summary — read these to learn a new field.',
  },
  'openxiv-claims': {
    name: 'openxiv-claims',
    displayName: 'OpenXiv — claim cards',
    description: 'Papers shipped with 2+ author-claim cards: easier to scan, easier to dispute.',
  },
};

export interface SkeletonItem {
  readonly post: string;
}

export interface SkeletonPage {
  readonly feed: SkeletonItem[];
  readonly cursor?: string;
}

const MAX_FEED_OFFSET = 5000;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

function clampLimit(input: number | string | undefined): number {
  const n = typeof input === 'number' ? input : Number.parseInt(String(input ?? ''), 10);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(n)));
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const n = Number.parseInt(cursor, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(MAX_FEED_OFFSET, n);
}

export interface FeedSkeletonService {
  resolve(feed: string): FeedName | null;
  getSkeleton(input: {
    feed: FeedName;
    limit?: number | string;
    cursor?: string;
  }): AppResultAsync<SkeletonPage>;
}

export function makeFeedSkeletonService(ctx: AppContext): FeedSkeletonService {
  return {
    resolve(feed) {
      return (FEED_NAMES as readonly string[]).includes(feed)
        ? (feed as FeedName)
        : null;
    },
    getSkeleton({ feed, limit, cursor }) {
      const lim = clampLimit(limit);
      const offset = decodeCursor(cursor);
      // Query a slightly larger window so we can detect whether a next page
      // exists without a separate count(*).
      const probe = lim + 1;
      return ctx.repos.bskyFeeds.skeleton({ feed, limit: probe, offset }).map((rows) => {
        const items = rows.slice(0, lim).map((r) => ({ post: r.bskyPostUri }));
        const result: SkeletonPage = { feed: items };
        if (rows.length > lim && offset + lim < MAX_FEED_OFFSET) {
          (result as { cursor?: string }).cursor = String(offset + lim);
        }
        return result;
      });
    },
  };
}

export const __testing = { decodeCursor, clampLimit };
