-- Living Seminar Thread (P3 #11): paper-scoped discussion overlays on
-- `posts` (the existing app.openxiv.post storage). Adds three columns:
--
--  - pinned_by_author: the paper's submitter can elevate a single post per
--    paper (e.g. an author Q&A clarification). UNIQUE partial index keeps
--    "one pinned per paper" enforced at the DB level.
--  - label: free-form short tag, validated at app layer to the allowlist
--    {best_unresolved, resolved_by_v2}. Mod queue toggles these.
--  - hidden_by_mod: admin-only soft-delete. Public list-views exclude these
--    rows; mods see them in the queue.

ALTER TABLE "posts"
  ADD COLUMN IF NOT EXISTS "pinned_by_author" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "label" text,
  ADD COLUMN IF NOT EXISTS "hidden_by_mod" boolean NOT NULL DEFAULT false;

-- One pinned post per paper. Partial index so non-pinned rows don't compete.
CREATE UNIQUE INDEX IF NOT EXISTS "posts_paper_pinned_idx"
  ON "posts" ("embed_paper_uri")
  WHERE pinned_by_author = true;

CREATE INDEX IF NOT EXISTS "posts_paper_visible_idx"
  ON "posts" ("embed_paper_uri", "hidden_by_mod", "created_at");
