-- Backfill account_links rows for every user who has an ORCID or
-- Google sub recorded on their `users` row but no matching account_links
-- entry. Without this, /api/me/links shows a missing-link for ORCID
-- users who signed up before the link-tracking surface (Phase 7)
-- existed.
--
-- Why duplicate the data: the `users.orcid` / `users.google_sub`
-- columns are convenient lookups; the `account_links` table is the
-- audit trail (who linked what, when, how, against which prior DID).
-- For a backfill we have only "currently known", so prev_primary_did
-- is NULL and linked_via='backfill' so the operator can tell these
-- apart from real OAuth-driven links.
--
-- Idempotent through the UNIQUE(provider, subject) constraint
-- (`account_links_provider_subject_idx`). Re-running selects the same
-- rows, the conflict clause swallows them, count after = count before.
--
-- Bluesky is handled separately — the Phase 7 deployment already wrote
-- an account_link row for the Owner's did:plc via the admin-link
-- script, and Bluesky signups since then have gone through the OAuth
-- callback that already INSERTs into account_links.

INSERT INTO account_links (user_id, provider, subject, linked_at, linked_via, prev_primary_did, new_primary_did)
SELECT u.id, 'orcid', u.orcid, u.created_at, 'backfill', NULL, u.did
  FROM users u
 WHERE u.orcid IS NOT NULL
ON CONFLICT (provider, subject) DO NOTHING;

INSERT INTO account_links (user_id, provider, subject, linked_at, linked_via, prev_primary_did, new_primary_did)
SELECT u.id, 'google', u.google_sub, u.created_at, 'backfill', NULL, u.did
  FROM users u
 WHERE u.google_sub IS NOT NULL
ON CONFLICT (provider, subject) DO NOTHING;
