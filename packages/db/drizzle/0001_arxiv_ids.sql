-- arXiv-style public identifiers: openxiv:{subject}.{YYYY}.{NNNNN}
ALTER TABLE "papers" ADD COLUMN IF NOT EXISTS "openxiv_id" text;
DO $$ BEGIN
  CREATE UNIQUE INDEX "papers_openxiv_id_idx" ON "papers" ("openxiv_id");
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- Atomic per-(subject, year) sequence allocator.
CREATE TABLE IF NOT EXISTS "id_counters" (
  "subject" text NOT NULL,
  "year" integer NOT NULL,
  "next_value" integer NOT NULL DEFAULT 1,
  PRIMARY KEY ("subject", "year")
);

-- Single-instance ownership: who is the moderator?
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_admin_promoted" boolean NOT NULL DEFAULT false;

-- Submission saga tracking — one row per submission, stages flipped to true as
-- they succeed so a resume can pick up at the first false stage.
CREATE TABLE IF NOT EXISTS "submission_sagas" (
  "paper_id" uuid PRIMARY KEY REFERENCES "papers"("id") ON DELETE CASCADE,
  "stage_ops_created" boolean NOT NULL DEFAULT false,
  "stage_ops_approved" boolean NOT NULL DEFAULT false,
  "stage_id_assigned" boolean NOT NULL DEFAULT false,
  "stage_pds_paper" boolean NOT NULL DEFAULT false,
  "stage_pds_summary_disclosure" boolean NOT NULL DEFAULT false,
  "stage_bluesky_bridge" boolean NOT NULL DEFAULT false,
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "last_error_stage" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "submission_sagas_updated_idx" ON "submission_sagas" ("updated_at");
