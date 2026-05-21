-- Final PDF blob URL + hourly view aggregation.
-- Both additive; no destructive changes.

-- ---------------------------------------------------------------------------
-- paper_versions.final_pdf_url
-- The original compile output stays at `paper_versions.pdf_url` (so an author
-- can always download the bare upload). `final_pdf_url` is the cover-stamped
-- + left-sidebar branded version produced asynchronously by the finalize
-- worker. Web/API clients prefer `final_pdf_url` when it's set, falling back
-- to `pdf_url` when finalize hasn't yet run (or has failed).
-- ---------------------------------------------------------------------------
ALTER TABLE paper_versions
  ADD COLUMN IF NOT EXISTS final_pdf_url TEXT;

ALTER TABLE paper_versions
  ADD COLUMN IF NOT EXISTS final_pdf_built_at TIMESTAMPTZ;

ALTER TABLE paper_versions
  ADD COLUMN IF NOT EXISTS final_pdf_content_hash TEXT;

CREATE INDEX IF NOT EXISTS paper_versions_final_pdf_pending_idx
  ON paper_versions(paper_id)
  WHERE final_pdf_url IS NULL;

-- ---------------------------------------------------------------------------
-- papers_views_hourly: hourly rollup of view + download events per paper.
--
-- Materialised because:
--  * the per-paper dashboard reads it on every page load (cached 5 min in
--    Redis, but the cold-cache hit must still be cheap);
--  * full counts of millions of events would otherwise dominate page latency.
--
-- The mview is refreshed every 10 minutes by a cron-style job (`REFRESH
-- MATERIALIZED VIEW CONCURRENTLY`); see scripts/refresh-analytics.ts. The
-- "unique_sessions" column is an approximation via distinct session_id,
-- which the API doesn't expose to the public — only the owner of a paper
-- sees it.
--
-- Event types of interest:
--   feed_impression  -> counted as a "view" (lightweight; uses sendBeacon)
--   card_expand      -> counted as a "view" with intent (user opened abs)
--   save             -> counted separately as 'save'
--   summary_level_click -> 'tier_click'
--
-- For "downloads" we need a separate event type that the abs page emits on
-- the PDF link. The legacy stack only had feed_impression; this rollout
-- assumes the abs page emits 'pdf_download' on click. Until that lands,
-- the downloads counter is structurally zero, which is honest.
-- ---------------------------------------------------------------------------

CREATE MATERIALIZED VIEW IF NOT EXISTS papers_views_hourly AS
SELECT
  target_uri AS paper_uri,
  date_trunc('hour', ts) AS hour,
  COUNT(*) FILTER (WHERE event_type IN ('feed_impression', 'card_expand')) AS views,
  COUNT(*) FILTER (WHERE event_type = 'pdf_download') AS downloads,
  COUNT(*) FILTER (WHERE event_type = 'save') AS saves,
  COUNT(DISTINCT session_id) AS unique_sessions
FROM feed_events
WHERE target_type IN ('openxiv_paper', 'external_paper')
GROUP BY target_uri, date_trunc('hour', ts);

-- Concurrent refresh requires a unique index on (target_uri, hour).
CREATE UNIQUE INDEX IF NOT EXISTS papers_views_hourly_pk_idx
  ON papers_views_hourly(paper_uri, hour);

-- Fast lookup for "last N hours of a single paper".
CREATE INDEX IF NOT EXISTS papers_views_hourly_paper_hour_idx
  ON papers_views_hourly(paper_uri, hour DESC);

-- Bootstrap the mview content. CONCURRENTLY would fail on first refresh
-- (no rows to lock); plain refresh is fine in the migration window.
REFRESH MATERIALIZED VIEW papers_views_hourly;
