ALTER TABLE "account_links"
  DROP CONSTRAINT IF EXISTS "account_links_provider_valid";

ALTER TABLE "account_links"
  ADD CONSTRAINT "account_links_provider_valid"
  CHECK ("provider" IN ('orcid', 'google', 'bluesky', 'mastodon'));
