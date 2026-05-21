-- Tier-2 figure extraction. The pdf-figures BullMQ worker calls GROBID's
-- `processFulltextDocument` against the *original* version PDF, parses the
-- TEI <figure>/<table> elements for their coordinates + caption, and crops
-- each into a 300dpi PNG which lands in MinIO at
--   paper-{id}-v{ver}-fig-{idx}.png
-- One row per cropped figure. Idempotent on (paper_id, version, idx).
--
-- Why version (smallint) on the row rather than paper_version_id (uuid):
-- - The same paper at v1 and v2 is two distinct sets of figures.
-- - Foreign-keying paper_version_id ties us to that table's lifecycle.
--   version+paper_id is the natural key the abs page already uses for
--   everything visible (cover, sidebar, OAI-PMH identifier).
--
-- Why image_url (text, full URL) rather than a key: the URL is what the
-- frontend renders directly. Storing it pre-built avoids a join + cdn
-- prefix concat on every paper page load.
--
-- bbox jsonb: GROBID emits `coords="P,X,Y,W,H"` in PDF user-space units.
-- We store {p,x,y,w,h} verbatim so a future LLM alt-text pass (Tier 4)
-- can re-derive the crop without re-running GROBID.
--
-- Cascade rules: ON DELETE CASCADE from papers because a paper deletion
-- (admin retraction) drops everything attached to it; the MinIO blob is
-- orphaned and reclaimed by the periodic bucket-sweeper.

CREATE TABLE IF NOT EXISTS paper_figures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id uuid NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  idx integer NOT NULL CHECK (idx >= 0),
  image_url text NOT NULL,
  caption text,
  page integer CHECK (page IS NULL OR page >= 1),
  bbox jsonb,
  -- Either 'figure' or 'table'. TEI distinguishes them via element name.
  type text NOT NULL CHECK (type IN ('figure', 'table')),
  extracted_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotency anchor. The worker upserts on this constraint.
CREATE UNIQUE INDEX IF NOT EXISTS paper_figures_paper_version_idx_idx
  ON paper_figures (paper_id, version, idx);

-- Hot path: paper page fetches "all figures for this version of this paper".
CREATE INDEX IF NOT EXISTS paper_figures_paper_version_idx
  ON paper_figures (paper_id, version, idx);

-- Backfill scripts iterate papers that have no figures yet for the most
-- recent version. This partial index keeps that scan cheap.
CREATE INDEX IF NOT EXISTS paper_figures_recent_extracted_idx
  ON paper_figures (extracted_at DESC);
