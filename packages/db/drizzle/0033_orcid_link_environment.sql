ALTER TABLE "account_links"
  ADD COLUMN IF NOT EXISTS "orcid_use_sandbox" boolean;
