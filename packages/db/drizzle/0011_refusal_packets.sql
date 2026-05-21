-- Refusal Packets (P3 #9): when a paper is refused or withdrawn for a
-- specific reason, the moderator records a structured packet so the
-- submitter gets concrete, actionable feedback — not a black-box bounce.
--
-- One packet per paper. Fields:
--   - reason_category: one of {slop, scope, duplicate, legal, other}
--   - fixable: hint to the submitter whether revision is welcome
--   - examples: jsonb array of {section, problem, suggestion?} entries
--   - moderator_note: free-form explanation
--   - issued_by_did: who decided
--
-- The packet is public on /abs/{id}/refusal — refusal transparency is the
-- single best deterrent against arbitrary editorial decisions; readers can
-- judge whether the rejection was justified.

CREATE TABLE IF NOT EXISTS "refusal_packets" (
  "paper_id" uuid PRIMARY KEY REFERENCES "papers"("id") ON DELETE CASCADE,
  "reason_category" text NOT NULL,
  "fixable" boolean NOT NULL DEFAULT false,
  "examples" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "moderator_note" text NOT NULL,
  "issued_by_did" text NOT NULL,
  "issued_at" timestamp with time zone NOT NULL DEFAULT now(),
  "rescinded_at" timestamp with time zone,
  CONSTRAINT "refusal_packets_reason_check" CHECK (
    reason_category IN ('slop', 'scope', 'duplicate', 'legal', 'other')
  )
);

CREATE INDEX IF NOT EXISTS "refusal_packets_issued_at_idx" ON "refusal_packets" ("issued_at");
