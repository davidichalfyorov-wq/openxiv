-- Moderator paper-edit audit trail.
--
-- Every mutable field edit by a moderator lands here with a before/after
-- snapshot, the moderator's DID, a free-text reason, and an edited_at
-- timestamp. Used by:
--   * /admin/papers/:id/edit diff view ("what changed")
--   * Provenance Timeline ("edited by moderator at T")
--   * Roll-back tooling (read the latest row for a field, write it back)
--
-- Immutable fields (openxiv_id, submitter_did, version chain, sha hashes)
-- are rejected at the API layer before reaching this table — the audit log
-- never sees an attempt to mutate them.

CREATE TABLE IF NOT EXISTS paper_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id uuid NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  editor_did text NOT NULL,
  field text NOT NULL CHECK (field IN (
    'title', 'abstract', 'keywords', 'primary_category',
    'cross_listings', 'license'
  )),
  old_value jsonb,
  new_value jsonb,
  reason text NOT NULL,
  edited_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS paper_edits_paper_idx ON paper_edits (paper_id);
CREATE INDEX IF NOT EXISTS paper_edits_edited_at_idx ON paper_edits (edited_at);
