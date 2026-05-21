import { and, count, eq, gt, sql } from 'drizzle-orm';
import { Errors, type AppResultAsync, fromPromise } from '@openxiv/shared';
import type { Database } from '../client.js';
import {
  feedEvents,
  FEED_EVENT_TARGET_TYPES,
  FEED_EVENT_TYPES,
  type FeedEventRecord,
  type NewFeedEvent,
} from '../schema/events.js';

export { FEED_EVENT_TYPES, FEED_EVENT_TARGET_TYPES } from '../schema/events.js';
export type { FeedEventType, FeedEventTargetType, FeedEventRecord } from '../schema/events.js';

export interface EventsRepository {
  /**
   * Insert a single event. Does NOT enforce idempotency at the DB layer —
   * the route enforces a 1-minute bucket window via `existsInBucket()`.
   */
  insert(input: NewFeedEvent): AppResultAsync<FeedEventRecord>;
  /**
   * True if an event with the same (session_id, event_type, target_uri) was
   * inserted within `bucketSeconds`. Used to drop client-double-fire.
   */
  existsInBucket(
    sessionId: string,
    eventType: string,
    targetUri: string,
    bucketSeconds: number,
  ): AppResultAsync<boolean>;
  countByEventType(): AppResultAsync<Record<string, number>>;
}

export function makeEventsRepository(db: Database): EventsRepository {
  return {
    insert(input) {
      if (!(FEED_EVENT_TYPES as readonly string[]).includes(input.eventType)) {
        return fromPromise(
          Promise.reject(new Error(`invalid event_type: ${input.eventType}`)),
          (cause) => Errors.validation('invalid feed event_type', cause),
        );
      }
      if (!(FEED_EVENT_TARGET_TYPES as readonly string[]).includes(input.targetType)) {
        return fromPromise(
          Promise.reject(new Error(`invalid target_type: ${input.targetType}`)),
          (cause) => Errors.validation('invalid feed target_type', cause),
        );
      }
      return fromPromise(
        db.insert(feedEvents).values(input).returning(),
        (cause) => Errors.internal('events.insert', cause),
      ).map((rows) => {
        const r = rows[0];
        if (!r) throw new Error('events.insert: empty');
        return r;
      });
    },
    existsInBucket(sessionId, eventType, targetUri, bucketSeconds) {
      const since = new Date(Date.now() - bucketSeconds * 1000);
      return fromPromise(
        db
          .select({ n: count() })
          .from(feedEvents)
          .where(
            and(
              eq(feedEvents.sessionId, sessionId),
              eq(feedEvents.eventType, eventType),
              eq(feedEvents.targetUri, targetUri),
              gt(feedEvents.ts, since),
            ),
          ),
        (cause) => Errors.internal('events.existsInBucket', cause),
      ).map((rows) => (rows[0]?.n ?? 0) > 0);
    },
    countByEventType() {
      return fromPromise(
        db.execute<{ event_type: string; n: number }>(
          sql`SELECT event_type, COUNT(*)::int AS n FROM feed_events GROUP BY event_type`,
        ),
        (cause) => Errors.internal('events.countByEventType', cause),
      ).map((res) => {
        const out: Record<string, number> = {};
        for (const row of res.rows) out[row.event_type] = row.n;
        return out;
      });
    },
  };
}
