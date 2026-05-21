ALTER TABLE "account_links"
  ADD COLUMN IF NOT EXISTS "mastodon_instance_url" text,
  ADD COLUMN IF NOT EXISTS "mastodon_access_token" text,
  ADD COLUMN IF NOT EXISTS "mastodon_account_url" text;

ALTER TABLE "paper_versions"
  ADD COLUMN IF NOT EXISTS "mastodon_status_id" text,
  ADD COLUMN IF NOT EXISTS "mastodon_status_url" text,
  ADD COLUMN IF NOT EXISTS "mastodon_post_status" text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS "mastodon_post_error" text,
  ADD COLUMN IF NOT EXISTS "mastodon_posted_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "paper_versions_mastodon_status_idx"
  ON "paper_versions" ("mastodon_status_id");
