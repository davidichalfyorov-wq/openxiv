-- Drop OPS-flavoured stage names — the OPS layer was removed in favour of
-- the existing Postgres-backed store. Stage semantics unchanged.
DO $$ BEGIN
  ALTER TABLE "submission_sagas" RENAME COLUMN "stage_ops_created" TO "stage_paper_persisted";
EXCEPTION WHEN undefined_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "submission_sagas" RENAME COLUMN "stage_ops_approved" TO "stage_paper_approved";
EXCEPTION WHEN undefined_column THEN NULL; END $$;

-- Rewrite any persisted error-stage strings so saga resume picks them up by the new name.
UPDATE "submission_sagas"
  SET "last_error_stage" = 'stagePaperPersisted'
  WHERE "last_error_stage" = 'stageOpsCreated';
UPDATE "submission_sagas"
  SET "last_error_stage" = 'stagePaperApproved'
  WHERE "last_error_stage" = 'stageOpsApproved';
