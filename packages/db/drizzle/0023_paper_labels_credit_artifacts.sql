-- Three small additions consolidated into one migration:
--   1. paper_labels — Ozone-style curated labels (5 enum values).
--   2. paper_authors.credit_roles — CRediT contribution-role tagging per author.
--   3. paper_authors.affiliation_ror — ROR identifier for the author's
--      institution, optional.
--   4. paper_artifacts — linked code / data / metadata-passport entries.
-- All four tables/columns are independent — failure of one feature does
-- not block the others. Each is gated behind its own feature flag at the
-- API layer.

CREATE TABLE IF NOT EXISTS paper_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id uuid NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (label IN (
    'needs-context',
    'beginner-readable',
    'high-disclosure',
    'question-led-to-revision',
    'featured-candidate'
  )),
  applied_by text NOT NULL,
  ts timestamptz NOT NULL DEFAULT now(),
  UNIQUE (paper_id, label)
);

CREATE INDEX IF NOT EXISTS paper_labels_paper_idx ON paper_labels (paper_id);
CREATE INDEX IF NOT EXISTS paper_labels_label_idx ON paper_labels (label);

ALTER TABLE paper_authors
  ADD COLUMN IF NOT EXISTS credit_roles jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS affiliation_ror text;

CREATE TABLE IF NOT EXISTS paper_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id uuid NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  artifact_type text NOT NULL CHECK (artifact_type IN ('code', 'data', 'codemeta', 'cff', 'other')),
  url text NOT NULL,
  parsed_metadata jsonb,
  fetched_at timestamptz,
  added_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS paper_artifacts_paper_idx ON paper_artifacts (paper_id);
CREATE INDEX IF NOT EXISTS paper_artifacts_type_idx ON paper_artifacts (artifact_type);

-- OpenAlex enrichment cache. Keyed by paper_id (1:1).
CREATE TABLE IF NOT EXISTS paper_enrichment (
  paper_id uuid PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
  openalex_id text,
  related_works jsonb NOT NULL DEFAULT '[]'::jsonb,
  topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  institutions jsonb NOT NULL DEFAULT '[]'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'openalex'
);

CREATE INDEX IF NOT EXISTS paper_enrichment_openalex_idx ON paper_enrichment (openalex_id);
