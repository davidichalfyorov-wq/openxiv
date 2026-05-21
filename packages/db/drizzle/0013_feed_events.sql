-- Event tracking (P1 #2 in Phase 2 follow-up): a single firehose table for
-- reader-side telemetry. Write-only from the route layer; ranking signals
-- and product analytics read from this table in batch.
--
-- Field intent:
--   - user_did NULL for anonymous (DNT or opt-out) sessions.
--   - session_id is a UUID minted client-side and stored in localStorage;
--     it ties events together for a reading session without revealing a
--     stable user identity.
--   - event_type is the small enum we ingest. Adding a new type requires
--     a migration so the catalog stays auditable.
--   - target_uri can be a paper URI (at://…), an /abs/{id} URL, or a
--     section anchor (e.g. cs.AI.2026.00001#sec-3). Free-form to avoid
--     forcing the indexer to know every event type's URI shape.
--   - context_json carries event-specific extras (summary tier, hide
--     reason, etc.). Kept narrow at write time — schema lives in app
--     code, validated at route handler.

CREATE TABLE IF NOT EXISTS "feed_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_did" text,
  "session_id" text NOT NULL,
  "event_type" text NOT NULL,
  "target_uri" text NOT NULL,
  "target_type" text NOT NULL,
  "context_json" jsonb,
  "ts" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "feed_events_event_type_check" CHECK (
    event_type IN (
      'feed_impression', 'card_expand', 'summary_level_click', 'save', 'hide', 'question_asked',
      'paper_view', 'pdf_download', 'html_open', 'profile_view', 'endorse_click',
      'endorse_submit', 'search_query', 'signup_complete', 'submit_complete'
    )
  ),
  CONSTRAINT "feed_events_target_type_check" CHECK (
    target_type IN ('openxiv_paper', 'external_paper', 'section', 'post', 'profile', 'search', 'auth', 'submission', 'other')
  )
);

-- Queries against this table are append-only writes and aggregate reads
-- by ((session_id, event_type, target_uri) and (target_uri, event_type, ts).
-- Both index shapes pay for themselves on day one — the table grows fast.
CREATE INDEX IF NOT EXISTS "feed_events_session_idx"
  ON "feed_events" ("session_id", "event_type", "target_uri");

CREATE INDEX IF NOT EXISTS "feed_events_target_idx"
  ON "feed_events" ("target_uri", "event_type", "ts" DESC);

CREATE INDEX IF NOT EXISTS "feed_events_ts_idx" ON "feed_events" ("ts" DESC);
