-- DID canonicalization cascade.
--
-- Migration 0020 already canonicalises `users.did` (openxiv.local →
-- openxiv.net:u:) and archives the prior value into legacy_dids. This
-- migration completes the picture by cascading the rename to *every other
-- table* that stores a DID as plain text — these are read by feed
-- generators, search indexers, and PDS replicators, so leaving them
-- stale would mean the new canonical user is correctly addressable but
-- their old papers/posts/follows still attribute to a phantom DID.
--
-- Idempotent: every UPDATE filters on the legacy prefix, so re-running
-- after a previous pass is a NO-OP. Conflicts (UNIQUE constraints, e.g.
-- a follow that would collide post-rename) are captured in
-- `_did_migration_conflicts` for manual review rather than failing the
-- whole migration.

BEGIN;

CREATE TABLE IF NOT EXISTS _did_migration_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  column_name TEXT NOT NULL,
  old_did TEXT NOT NULL,
  new_did TEXT NOT NULL,
  conflicting_row JSONB NOT NULL,
  reason TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Helper function: rewrite a DID string from openxiv.local to
-- openxiv.net:u: form. Returns the same string if it doesn't match.
CREATE OR REPLACE FUNCTION _canonicalize_did(d TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN d LIKE 'did:web:openxiv.local:%'
      THEN 'did:web:openxiv.net:u:' || substring(d FROM length('did:web:openxiv.local:') + 1)
    ELSE d
  END
$$;

-- ---------------------------------------------------------------------------
-- papers.submitter_did
-- ---------------------------------------------------------------------------
UPDATE papers
SET submitter_did = _canonicalize_did(submitter_did),
    updated_at = now()
WHERE submitter_did LIKE 'did:web:openxiv.local:%';

-- paper_authors.did — array-ish? actually a TEXT column per row.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'paper_authors' AND column_name = 'did'
  ) THEN
    EXECUTE 'UPDATE paper_authors SET did = _canonicalize_did(did) WHERE did LIKE ''did:web:openxiv.local:%''';
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- posts.author_did
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'posts' AND column_name = 'author_did'
  ) THEN
    EXECUTE 'UPDATE posts SET author_did = _canonicalize_did(author_did) WHERE author_did LIKE ''did:web:openxiv.local:%''';
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- follows: both sides can collide post-rename. Capture conflicts.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  new_follower TEXT;
  new_target TEXT;
BEGIN
  FOR r IN
    SELECT id, follower_did, target_did FROM follows
    WHERE follower_did LIKE 'did:web:openxiv.local:%'
       OR target_did   LIKE 'did:web:openxiv.local:%'
  LOOP
    new_follower := _canonicalize_did(r.follower_did);
    new_target   := _canonicalize_did(r.target_did);
    -- Check whether the rewrite would clash with an existing row.
    IF EXISTS (
      SELECT 1 FROM follows
      WHERE follower_did = new_follower AND target_did = new_target AND id <> r.id
    ) THEN
      INSERT INTO _did_migration_conflicts(table_name, column_name, old_did, new_did, conflicting_row, reason)
      VALUES (
        'follows', 'pair',
        r.follower_did || '→' || r.target_did,
        new_follower || '→' || new_target,
        jsonb_build_object('id', r.id, 'follower_did', r.follower_did, 'target_did', r.target_did),
        'pair_collision'
      );
      DELETE FROM follows WHERE id = r.id;
    ELSE
      UPDATE follows
      SET follower_did = new_follower, target_did = new_target
      WHERE id = r.id;
    END IF;
  END LOOP;
END$$;

-- ---------------------------------------------------------------------------
-- endorsements.endorser_did (and target_did if present)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'endorsements' AND column_name = 'endorser_did'
  ) THEN
    EXECUTE 'UPDATE endorsements SET endorser_did = _canonicalize_did(endorser_did) WHERE endorser_did LIKE ''did:web:openxiv.local:%''';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'endorsements' AND column_name = 'target_did'
  ) THEN
    EXECUTE 'UPDATE endorsements SET target_did = _canonicalize_did(target_did) WHERE target_did LIKE ''did:web:openxiv.local:%''';
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- refusals.issued_by_did (+ subject_did, related_did if present)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'refusals' AND column_name = 'issued_by_did'
  ) THEN
    EXECUTE 'UPDATE refusals SET issued_by_did = _canonicalize_did(issued_by_did) WHERE issued_by_did LIKE ''did:web:openxiv.local:%''';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'refusals' AND column_name = 'subject_did'
  ) THEN
    EXECUTE 'UPDATE refusals SET subject_did = _canonicalize_did(subject_did) WHERE subject_did LIKE ''did:web:openxiv.local:%''';
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- preregistrations.author_did (+ any *_did columns)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  col RECORD;
BEGIN
  FOR col IN
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'preregistrations' AND column_name LIKE '%_did'
  LOOP
    EXECUTE format(
      'UPDATE preregistrations SET %I = _canonicalize_did(%I) WHERE %I LIKE ''did:web:openxiv.local:%%''',
      col.column_name, col.column_name, col.column_name
    );
  END LOOP;
END$$;

COMMIT;

-- Rollback note: a DOWN script (not auto-applied) would reverse the
-- mapping using each user's legacy_dids array as a source of truth.
-- See scripts/migrate-0025-down.ts for the operator-invoked rollback.
