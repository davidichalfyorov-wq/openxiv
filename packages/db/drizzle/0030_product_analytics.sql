-- Product analytics events, privacy metadata, and refreshed paper rollups.
-- Additive except CHECK constraint widening and materialized-view rebuild.

ALTER TABLE "feed_events"
  ADD COLUMN IF NOT EXISTS "ip_hash_daily" text,
  ADD COLUMN IF NOT EXISTS "country_code" text;

ALTER TABLE "feed_events" DROP CONSTRAINT IF EXISTS "feed_events_event_type_check";
ALTER TABLE "feed_events" ADD CONSTRAINT "feed_events_event_type_check" CHECK (
  event_type IN (
    'feed_impression', 'card_expand', 'summary_level_click', 'save', 'hide', 'question_asked',
    'paper_view', 'pdf_download', 'html_open', 'profile_view', 'endorse_click',
    'endorse_submit', 'search_query', 'signup_complete', 'submit_complete'
  )
);

ALTER TABLE "feed_events" DROP CONSTRAINT IF EXISTS "feed_events_target_type_check";
ALTER TABLE "feed_events" ADD CONSTRAINT "feed_events_target_type_check" CHECK (
  target_type IN (
    'openxiv_paper', 'external_paper', 'section', 'post', 'profile', 'search',
    'auth', 'submission', 'other'
  )
);

CREATE INDEX IF NOT EXISTS "feed_events_country_idx"
  ON "feed_events" ("country_code", "ts" DESC);

DROP MATERIALIZED VIEW IF EXISTS papers_views_hourly;

CREATE MATERIALIZED VIEW papers_views_hourly AS
SELECT
  target_uri AS paper_uri,
  date_trunc('hour', ts) AS hour,
  COUNT(*) FILTER (WHERE event_type IN ('paper_view', 'feed_impression', 'card_expand')) AS views,
  COUNT(*) FILTER (WHERE event_type = 'pdf_download') AS downloads,
  COUNT(*) FILTER (WHERE event_type = 'html_open') AS html_opens,
  COUNT(*) FILTER (WHERE event_type = 'endorse_submit') AS endorsements,
  COUNT(*) FILTER (WHERE event_type = 'save') AS saves,
  COUNT(DISTINCT session_id) AS unique_sessions
FROM feed_events
WHERE target_type IN ('openxiv_paper', 'external_paper')
GROUP BY target_uri, date_trunc('hour', ts);

CREATE UNIQUE INDEX IF NOT EXISTS papers_views_hourly_pk_idx
  ON papers_views_hourly(paper_uri, hour);

CREATE INDEX IF NOT EXISTS papers_views_hourly_paper_hour_idx
  ON papers_views_hourly(paper_uri, hour DESC);
