-- Hand-curated Featured + reason cards (P1 #4).
--
-- A small ordered list of openxiv_paper or external_paper URIs that we
-- promote on the homepage. Each row carries a moderator-written
-- `reason_card_md` (≥80 chars, sanitized markdown) — the curation note that
-- justifies the placement, not a marketing blurb.
--
-- `position` is the explicit ordering; lower comes first. We don't UNIQUE
-- it so an admin can temporarily double-park during reorder; the read query
-- breaks ties by `started_at DESC`.

CREATE TABLE IF NOT EXISTS "featured_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "target_uri" text NOT NULL,
  "target_type" text NOT NULL,
  "reason_card_md" text NOT NULL,
  "curator_did" text NOT NULL,
  "started_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone,
  "position" integer NOT NULL DEFAULT 0,
  CONSTRAINT "featured_items_target_type_check" CHECK (
    target_type IN ('openxiv_paper', 'external_paper')
  ),
  CONSTRAINT "featured_items_reason_min_check" CHECK (char_length(reason_card_md) >= 80)
);

CREATE INDEX IF NOT EXISTS "featured_items_position_idx" ON "featured_items" ("position", "started_at" DESC);
-- The runtime active filter (`expires_at IS NULL OR expires_at > now()`)
-- can't go in the index predicate because `now()` is not immutable in
-- Postgres; we just index `expires_at` and let the planner cull.
CREATE INDEX IF NOT EXISTS "featured_items_expires_idx" ON "featured_items" ("expires_at");
