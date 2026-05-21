-- DID identity infrastructure: per-user signing keys + reserved DID
-- registry + account_links audit trail. All additive; no destructive
-- changes. Safe to roll forward independently of 0025 cascade.

-- ---------------------------------------------------------------------------
-- users: signing keypair material + identity-related metadata.
-- ---------------------------------------------------------------------------
-- public_signing_key:   multibase-z public key (~52 chars for secp256k1).
--                       Served from /u/{subject}/did.json verificationMethod.
-- encrypted_signing_key: ciphertext of the private key, encrypted with
--                       XChaCha20-Poly1305 under the env KEK. We never read
--                       it for ordinary requests — only when *this user*
--                       signs an AT-proto record via the API.
-- signing_key_nonce:    XChaCha20 24-byte nonce. Per-row so identical
--                       keypairs encrypt to different ciphertexts.
-- key_type:             curve identifier. Constrained ENUM-like CHECK so a
--                       future P-256/ed25519 migration doesn't need ALTER.
-- retired_pubkeys:      JSONB array of {multibase, retiredAt, reason}. A
--                       signature created under an old key still validates
--                       against the published DID Doc until we purge.
-- bluesky_signing_key:  fresh per-resolution copy of the user's did:plc
--                       Multikey; used to verify replies that flow through
--                       the bridge. Refreshed on each resolve_freshness
--                       tick, NOT cached as truth.
-- did_resolution_status: how the current `did` row was produced:
--                         'native'         — directly from the IdP
--                         'fallback_web'   — Bluesky resolver failed; we
--                                            issued a did:web placeholder
--                         'migrated'       — moved from openxiv.local via
--                                            0025
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS public_signing_key TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_signing_key BYTEA,
  ADD COLUMN IF NOT EXISTS signing_key_nonce BYTEA,
  ADD COLUMN IF NOT EXISTS key_type TEXT NOT NULL DEFAULT 'secp256k1',
  ADD COLUMN IF NOT EXISTS retired_pubkeys JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS bluesky_signing_key TEXT,
  ADD COLUMN IF NOT EXISTS did_resolution_status TEXT NOT NULL DEFAULT 'native';

-- key_type whitelist. We only run secp256k1 today; the column is in place
-- so a future P-256/FIPS migration only flips values, never ALTERs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_key_type_valid'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_key_type_valid
      CHECK (key_type IN ('secp256k1', 'ed25519', 'p256'));
  END IF;
END$$;

-- did_resolution_status whitelist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_did_resolution_status_valid'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_did_resolution_status_valid
      CHECK (did_resolution_status IN ('native', 'fallback_web', 'migrated'));
  END IF;
END$$;

-- Encrypted-key columns are nullable: a brand-new user gets keys assigned
-- in the same transaction by the application, but the migration must not
-- block on backfill (existing users get keys later via scripts/backfill).
-- Once backfill is complete we may tighten to NOT NULL — but that's a
-- separate, smaller migration.

-- ---------------------------------------------------------------------------
-- reserved_dids: DIDs that may not be issued/claimed to a different user.
-- Two uses:
--   1. Pre-reserve the owner's did:plc before deploy so it can't be claimed
--      by anyone else between deploy and the owner's manual link.
--   2. Block known-bad DIDs (impersonation, infra namespaces) from being
--      registered as a primary identity.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reserved_dids (
  did TEXT PRIMARY KEY,
  reserved_for_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reserved_dids_user_idx
  ON reserved_dids(reserved_for_user_id);

-- ---------------------------------------------------------------------------
-- account_links: audit trail for OAuth provider → user binding. UNIQUE on
-- (provider, subject) so the same Google/ORCID/Bluesky account can never
-- be bound to two openxiv users simultaneously; collision returns 409.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS account_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 'signup' | 'link' | 'admin' — operator-classified path the link
  -- arrived through. 'admin' is a manual fix-up by an operator with
  -- elevated permissions, not an end-user flow.
  linked_via TEXT NOT NULL,
  -- The user's primary_did *before* this link took effect (NULL on
  -- first signup). Useful for an unlink-rollback path.
  prev_primary_did TEXT,
  -- The user's primary_did *after* this link took effect.
  new_primary_did TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS account_links_provider_subject_idx
  ON account_links(provider, subject);

CREATE INDEX IF NOT EXISTS account_links_user_idx
  ON account_links(user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'account_links_provider_valid'
  ) THEN
    ALTER TABLE account_links
      ADD CONSTRAINT account_links_provider_valid
      CHECK (provider IN ('orcid', 'google', 'bluesky'));
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- Seed reserved DIDs: the owner's did:plc must be unavailable to other
-- users between deploy and the owner's manual link. The reservation will
-- be released (reserved_for_user_id pointed at the actual user row) once
-- the owner completes the post-deploy link from Settings → Identity.
-- ---------------------------------------------------------------------------
INSERT INTO reserved_dids (did, reserved_for_user_id, reason)
SELECT
  'did:plc:dzhzljg4peg765tpd2q63luc',
  id,
  'owner_pre_link'
FROM users
WHERE orcid = '0009-0003-6027-7837'
ON CONFLICT (did) DO UPDATE
SET reserved_for_user_id = EXCLUDED.reserved_for_user_id,
    reason = EXCLUDED.reason;

-- If the owner user row isn't present yet (e.g. fresh DB), still record
-- the reservation so a stranger can't grab the DID by signing in first.
INSERT INTO reserved_dids (did, reserved_for_user_id, reason)
VALUES ('did:plc:dzhzljg4peg765tpd2q63luc', NULL, 'owner_pre_link')
ON CONFLICT (did) DO NOTHING;
