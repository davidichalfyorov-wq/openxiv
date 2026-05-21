-- Author Launch Kit (P3 #16): structured author-curated content that
-- surfaces post-publish.
--
--  - one_hard_question: a single text question the author wants serious
--    readers to engage with. Surfaced on /abs as a callout — replaces the
--    "ask me anything" black box with a specific, narrow ask.
--  - launch_kit: jsonb of author-editable artifacts that live alongside
--    the paper without polluting the main `papers` row:
--      { bridgeThread: string[], reviewerInvites: string[], figureAltText: Record<string,string> }
--    Keeping this as one jsonb avoids 3 new columns and lets us add new
--    artifact types later (e.g. claim cards) without another migration.

ALTER TABLE "papers"
  ADD COLUMN IF NOT EXISTS "one_hard_question" text,
  ADD COLUMN IF NOT EXISTS "launch_kit" jsonb;
