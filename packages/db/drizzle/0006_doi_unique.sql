-- Unique partial index on papers.doi so /api/lookup can match by Crossref DOI
-- without scanning. Partial (WHERE doi IS NOT NULL) lets us continue to have
-- many papers without a DOI yet.
CREATE UNIQUE INDEX IF NOT EXISTS papers_doi_idx
  ON papers (doi)
  WHERE doi IS NOT NULL;
