-- AI Use Personality + "How to read me" cards (P2 #8).
--
-- profile_cards holds curated free-form artifacts attached to a user's
-- profile but separate from their feed:
--  - ai_policy: how they use AI (models_used, models_avoided, use_cases,
--    verification_practice, failure_modes). Mirrors AT-Proto lexicon
--    app.openxiv.profileAiPolicy.
--  - reading_guide: prerequisites, start_here, avoid_starting_with,
--    common_pitfalls.
--
-- We store content as JSONB rather than a column-per-field so a new card
-- type or new sub-field doesn't require a migration.

CREATE TABLE IF NOT EXISTS "profile_cards" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "card_type" text NOT NULL,
  "content_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "profile_cards_pk" PRIMARY KEY ("user_id", "card_type"),
  CONSTRAINT "profile_cards_card_type_check" CHECK (card_type IN ('ai_policy', 'reading_guide'))
);
