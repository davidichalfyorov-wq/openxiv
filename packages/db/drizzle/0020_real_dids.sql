-- Real DIDs + handles for ORCID/Google users.
--
-- 1. Stage `legacy_dids` text[] on users so old "did:web:openxiv.local:..."
--    callers can be redirected to the new canonical DID without breaking
--    bookmarks or paper records that already reference the legacy form.
-- 2. Backfill every existing `did:web:openxiv.local:...` user to the new
--    `did:web:openxiv.net:u:{provider}.{subject}` form, archiving the prior
--    DID into legacy_dids.
-- 3. Backfill NULL handles. Slug from display name, fall back to
--    `orcid-{first 6 of orcid}` or `g-{first 6 of google_sub}`; collisions
--    resolved with a serial suffix.
-- 4. Add unique partial index on legacy_dids so the redirect lookup is fast.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS legacy_dids text[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS users_legacy_dids_gin_idx
  ON users USING gin(legacy_dids);

-- Step 2 + 3 in one pass via a PL/pgSQL block so we can name the new DID
-- and reserve a unique handle in the same transaction.
DO $$
DECLARE
  r RECORD;
  base_slug text;
  candidate text;
  i int;
  new_did text;
  legacy text;
BEGIN
  FOR r IN
    SELECT id, did, handle, orcid, google_sub, bluesky_did, display_name
    FROM users
    WHERE did LIKE 'did:web:openxiv.local:%'
  LOOP
    legacy := r.did;
    IF r.orcid IS NOT NULL THEN
      new_did := 'did:web:openxiv.net:u:orcid.' || r.orcid;
    ELSIF r.google_sub IS NOT NULL THEN
      new_did := 'did:web:openxiv.net:u:google.' || r.google_sub;
    ELSIF r.bluesky_did IS NOT NULL THEN
      new_did := r.bluesky_did;
    ELSE
      -- Strip the .local placeholder. Should be unreachable but keep
      -- migration idempotent.
      new_did := replace(legacy, 'did:web:openxiv.local:', 'did:web:openxiv.net:u:');
    END IF;

    -- Reserve a handle if NULL. Slug rules: lowercase, ASCII, hyphenated,
    -- max 30 chars. Empty result falls back to provider-stable id.
    IF r.handle IS NULL THEN
      base_slug := lower(regexp_replace(coalesce(r.display_name, ''), '[^a-zA-Z0-9]+', '-', 'g'));
      base_slug := regexp_replace(base_slug, '(^-+)|(-+$)', '', 'g');
      base_slug := substr(base_slug, 1, 30);
      IF base_slug = '' OR base_slug IS NULL THEN
        IF r.orcid IS NOT NULL THEN
          base_slug := 'orcid-' || replace(substr(r.orcid, 1, 14), '-', '');
        ELSIF r.google_sub IS NOT NULL THEN
          base_slug := 'g-' || substr(r.google_sub, 1, 6);
        ELSE
          base_slug := 'u-' || substr(r.id::text, 1, 8);
        END IF;
      END IF;
      candidate := base_slug;
      i := 1;
      WHILE EXISTS (SELECT 1 FROM users WHERE handle = candidate AND id <> r.id) LOOP
        candidate := base_slug || '-' || i::text;
        i := i + 1;
        EXIT WHEN i > 9999;
      END LOOP;
      UPDATE users SET handle = candidate WHERE id = r.id;
    END IF;

    UPDATE users
    SET did = new_did,
        legacy_dids = array_append(coalesce(legacy_dids, '{}'::text[]), legacy),
        updated_at = now()
    WHERE id = r.id;
  END LOOP;
END$$;
