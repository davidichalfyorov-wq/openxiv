-- Records which version of the public submission terms the author accepted
-- and when. Nullable for rows that existed before the attestation gate
-- landed (2026-05-17); new submissions are required to populate both.
ALTER TABLE papers
  ADD COLUMN IF NOT EXISTS submission_terms_version text,
  ADD COLUMN IF NOT EXISTS submission_terms_accepted_at timestamptz;
