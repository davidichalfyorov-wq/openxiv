-- Section-level semantic search: chunk every paper into ~1k-token sections,
-- embed each section, store in pgvector for cosine similarity search.
CREATE TABLE IF NOT EXISTS "paper_sections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "paper_id" uuid NOT NULL REFERENCES "papers"("id") ON DELETE CASCADE,
  "section_idx" integer NOT NULL,
  "title" text,
  "anchor" text,
  "content" text NOT NULL,
  "embedding" vector(768) NOT NULL,
  "model" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "paper_sections_paper_idx" ON "paper_sections" ("paper_id");
CREATE INDEX IF NOT EXISTS "paper_sections_hnsw_idx"
  ON "paper_sections" USING hnsw ("embedding" vector_cosine_ops);
CREATE UNIQUE INDEX IF NOT EXISTS "paper_sections_unique" ON "paper_sections" ("paper_id", "section_idx");
