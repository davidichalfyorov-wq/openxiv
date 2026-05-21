-- Version Changelog (P1 #20): structured fields on paper_versions so each
-- bump carries machine-readable "what changed and why" data. This is the
-- substrate for the Version Changelog UI on /abs, and for downstream feeds
-- that can list e.g. "papers with corrections in the last week".
--
-- Field rationale:
--  - change_flags: jsonb of {claim, method, data, refs} booleans. Keeping
--    them in one column makes the "what changed" filter easy and avoids
--    four near-empty boolean columns.
--  - because_of: free-form text, but the UI restricts to {review, comment,
--    self, retraction_request} — we keep the column flexible to add reasons
--    later without another migration.
--  - unresolved: free-text. What is *still* wrong after this version. The
--    honest counterpart to "fixed in v2".
--  - changelog_note: short prose summary the author types in.
--  - diff_url: optional pointer to a precomputed diff artifact (PDF or
--    side-by-side HTML). Null until we wire the diff worker; the UI
--    falls back to "compare PDFs" links to v(N-1) and vN.

ALTER TABLE "paper_versions"
  ADD COLUMN IF NOT EXISTS "change_flags" jsonb,
  ADD COLUMN IF NOT EXISTS "because_of" text,
  ADD COLUMN IF NOT EXISTS "unresolved" text,
  ADD COLUMN IF NOT EXISTS "changelog_note" text,
  ADD COLUMN IF NOT EXISTS "diff_url" text;
