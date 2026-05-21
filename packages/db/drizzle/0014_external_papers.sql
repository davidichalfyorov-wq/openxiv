-- OpenXiv Lens (P1 #3): cache of external papers we surface as proxy
-- views. `arxiv` is the only source for now but the table is keyed by
-- (source, source_id) so adding biorxiv, ssrn, OSF, etc. needs no schema
-- change.
--
-- claimed_by_did becomes non-null when a verified ORCID-matched author
-- claims their external work — they then get to add the OpenXiv layer
-- (disclosure, summaries, endorsements) without re-uploading the PDF.

CREATE TABLE IF NOT EXISTS "external_papers" (
  "source" text NOT NULL,
  "source_id" text NOT NULL,
  "title" text NOT NULL,
  "authors_json" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "abstract" text,
  "categories" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "doi" text,
  "url" text,
  "license" text,
  "published_at" timestamp with time zone,
  "withdrawn" boolean NOT NULL DEFAULT false,
  "fetched_at" timestamp with time zone NOT NULL DEFAULT now(),
  "raw_metadata" jsonb,
  "claimed_by_did" text,
  "claimed_at" timestamp with time zone,
  CONSTRAINT "external_papers_pk" PRIMARY KEY ("source", "source_id"),
  CONSTRAINT "external_papers_source_check" CHECK (source IN ('arxiv', 'biorxiv', 'medrxiv', 'ssrn', 'osf'))
);

CREATE INDEX IF NOT EXISTS "external_papers_fetched_at_idx" ON "external_papers" ("fetched_at" DESC);
CREATE INDEX IF NOT EXISTS "external_papers_doi_idx" ON "external_papers" ("doi") WHERE doi IS NOT NULL;
