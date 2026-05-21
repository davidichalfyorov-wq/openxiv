-- Daily Science Brief snapshots (P1 #5).
--
-- The composer at /api/daily-brief returns 5 items: featured, claim,
-- open_question, explainer, serendipity. The worker writes a snapshot
-- here at 00:05 UTC so /brief/YYYY-MM-DD permalinks are stable forever
-- — even if the underlying papers move or the composer changes.

CREATE TABLE IF NOT EXISTS "daily_briefs" (
  "date" date PRIMARY KEY,
  "items_json" jsonb NOT NULL,
  "snapshot_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "daily_briefs_snapshot_at_idx" ON "daily_briefs" ("snapshot_at" DESC);
