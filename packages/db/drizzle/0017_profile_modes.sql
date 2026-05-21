-- Profile modes (P2 #7): a user can simultaneously be an Author, Reviewer,
-- and/or Reader. These are *identity* flags, NOT permission flags — the
-- existing `users.role` enum still gates moderator privileges. Modes drive
-- which sections render on the public profile page.
--
-- Defaults are seeded at signup: every new user gets `reader` enabled+public.
-- The Author flag is set automatically the first time the user submits a
-- paper; Reviewer is opt-in (it's a meaningful self-presentation choice).

CREATE TABLE IF NOT EXISTS "profile_modes" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "mode" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT false,
  "public" boolean NOT NULL DEFAULT false,
  "config_json" jsonb,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "profile_modes_pk" PRIMARY KEY ("user_id", "mode"),
  CONSTRAINT "profile_modes_mode_check" CHECK (mode IN ('author', 'reviewer', 'reader'))
);

CREATE INDEX IF NOT EXISTS "profile_modes_public_idx"
  ON "profile_modes" ("mode", "enabled", "public");

-- Backfill: every existing user gets a Reader mode enabled+public so the
-- previous-default "they exist as a reader" stays true. Existing users
-- who already submitted at least one paper additionally get Author enabled
-- + public (consistent with what was previously inferred from the corpus).

INSERT INTO profile_modes (user_id, mode, enabled, public)
SELECT u.id, 'reader', true, true FROM users u
ON CONFLICT (user_id, mode) DO NOTHING;

INSERT INTO profile_modes (user_id, mode, enabled, public)
SELECT u.id, 'author', true, true
FROM users u
WHERE EXISTS (SELECT 1 FROM papers p WHERE p.submitter_did = u.did)
ON CONFLICT (user_id, mode) DO NOTHING;
