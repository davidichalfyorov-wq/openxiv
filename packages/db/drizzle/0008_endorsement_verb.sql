-- Typed endorsements (P1 #12): add a `verb` column to endorsements so Trust
-- Passport can weight verb diversity instead of treating endorsements as
-- generic "likes". Verbs are validated at the lexicon layer (Zod enum),
-- not as a Postgres enum — keeping the column free-form lets us roll out
-- new verbs without coordinated schema migrations.
--
-- Legacy rows (pre-#12) stay with verb=NULL. They count toward total
-- endorsements but not toward distinct-verb diversity, so old data does
-- not artificially boost a paper's social-review score.

ALTER TABLE "endorsements" ADD COLUMN IF NOT EXISTS "verb" text;

-- Composite index for the common "endorsements on paper X grouped by verb"
-- query that powers the Trust Passport social-review aggregation and the
-- /abs page endorsement filter.
CREATE INDEX IF NOT EXISTS "endorsements_paper_verb_idx" ON "endorsements" ("paper_id", "verb");
