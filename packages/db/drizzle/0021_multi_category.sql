-- Multi-category cross-listings on papers.
--
-- Each paper has exactly one primary_category (immutable post-publish —
-- it's baked into the openxiv id), but may carry up to 5 cross-listings.
-- Stored as text[] with a GIN index so feed/topic queries can use
-- `WHERE primary_category = $1 OR $1 = ANY(cross_listings)` cheaply.

ALTER TABLE papers
  ADD COLUMN IF NOT EXISTS cross_listings text[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS papers_cross_listings_gin_idx
  ON papers USING gin(cross_listings);

-- Enforce ≤5 cross-listings + primary ≠ any cross-listing at the DB
-- layer so an unfortunate API caller can't silently bypass the wizard.
ALTER TABLE papers
  ADD CONSTRAINT papers_cross_listings_max5
  CHECK (array_length(cross_listings, 1) IS NULL OR array_length(cross_listings, 1) <= 5);

ALTER TABLE papers
  ADD CONSTRAINT papers_cross_listings_excludes_primary
  CHECK (NOT (primary_category = ANY(cross_listings)));
