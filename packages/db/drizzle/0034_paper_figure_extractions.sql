-- Completion markers for the Tier-2 figure pipeline.
--
-- `paper_figures` stores one row per extracted asset, so a correct run
-- that finds no figures used to be indistinguishable from "the worker has
-- not run yet". This table records the extraction outcome for every
-- (paper, version), including the intentionally empty case.

CREATE TABLE IF NOT EXISTS paper_figure_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id uuid NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  source text NOT NULL CHECK (source IN ('source_archive', 'pdf_grobid')),
  reason text NOT NULL CHECK (
    reason IN (
      'source_archive_figures',
      'source_archive_no_figures',
      'pdf_grobid_figures',
      'pdf_grobid_no_figures'
    )
  ),
  figure_count integer NOT NULL DEFAULT 0 CHECK (figure_count >= 0),
  completed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS paper_figure_extractions_paper_version_idx
  ON paper_figure_extractions (paper_id, version);

CREATE INDEX IF NOT EXISTS paper_figure_extractions_paper_idx
  ON paper_figure_extractions (paper_id, version);

CREATE INDEX IF NOT EXISTS paper_figure_extractions_completed_idx
  ON paper_figure_extractions (completed_at DESC);
