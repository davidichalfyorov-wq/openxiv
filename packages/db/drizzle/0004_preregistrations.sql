-- Pre-registration records.
CREATE TABLE IF NOT EXISTS "preregistrations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "uri" text,
  "cid" text,
  "author_did" text NOT NULL,
  "paper_id" uuid REFERENCES "papers"("id") ON DELETE SET NULL,
  "paper_uri" text,
  "title" text,
  "primary_category" text,
  "hypothesis" text NOT NULL,
  "method_plan" text NOT NULL,
  "expected_outcome" text NOT NULL,
  "attestation" text NOT NULL,
  "registered_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "preregistrations_uri_idx" ON "preregistrations" ("uri");
CREATE INDEX IF NOT EXISTS "preregistrations_author_idx" ON "preregistrations" ("author_did");
CREATE INDEX IF NOT EXISTS "preregistrations_paper_idx" ON "preregistrations" ("paper_id");
