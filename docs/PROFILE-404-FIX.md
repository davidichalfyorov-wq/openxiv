# Production "Profile not available" fix runbook

You're here because someone clicked their profile link on `openxiv.net` and
saw "Profile not available" with an API path containing `%253A` (a
double-encoded colon). This doc walks through the **operator steps** to fix
the live deployment.

The code-level fixes already landed in Phase 5/Phase 5.2:

- `apps/web/src/layouts/Base.astro` — removed `encodeURIComponent` on the
  profile link href (one decode less in the pipeline).
- `apps/web/src/pages/@[handle].astro` — removed `encodeURIComponent` on
  the redirect target.
- `apps/web/src/pages/u/[handle].astro` — server-side `normalizeHandleParam`
  decodes once-encoded inputs; 301-redirects DID-form URLs to the canonical
  handle when one exists.
- `apps/web/src/middleware.ts` + `apps/web/src/lib/url-salvage.ts` —
  catches `%25`-laden inputs at the request boundary, decodes until
  stable, 301s to the clean form. Runs under the Node adapter in
  production; Vite dev returns 404 before the middleware fires (known
  Vite quirk, not a production issue).
- `apps/api/src/routes/profiles.ts` — `normalizeProfileIdentifier` runs
  decode-until-stable on the path param; `canonicalDidVariants` maps
  the legacy `did:web:openxiv.local:…` form to `did:web:openxiv.net:u:…`
  so the lookup hits the new user record even before migration 0020
  has run.
- Migration `0020_real_dids.sql` rewrites every `did:web:openxiv.local:…`
  user to the canonical form, archives the old DID into the new
  `users.legacy_dids text[]` column, and backfills NULL handles with a
  slug derived from `display_name`.
- `usersService.upsertFromOAuth` now calls `profileModes.seedDefaults`
  on first sign-in so new accounts show a `Reader` mode pill instead
  of an empty profile.

## What ships to production

1. Deploy the latest images. The Caddyfile + nginx don't need changes —
   they pass `/api/*` and `/u/*` straight through. The Node adapter
   running the web container is what makes the middleware fire.
2. Run migration 0020 against the production database. Single command:
   ```
   docker compose exec api pnpm --filter @openxiv/db migrate
   ```
   The migration is **idempotent** — re-running it does nothing because
   the WHERE clause filters on the old DID prefix.
3. Smoke-check the fix from outside the VPS:
   ```
   curl -i 'https://openxiv.net/profiles/did%253Aweb%253Aopenxiv.local%253Aorcid.0009-0003-6027-7837'
   ```
   Expected: `HTTP/1.1 301 Moved Permanently` with `location: /profiles/<handle>`.
4. Hit the web profile page directly:
   ```
   curl -i 'https://openxiv.net/u/did%253Aweb%253Aopenxiv.local%253Aorcid.0009-0003-6027-7837'
   ```
   Expected: `HTTP/1.1 301 Moved Permanently` with
   `location: /u/<handle>` (via middleware salvage) then the actual
   profile renders on the second hop.

## Why the bug existed

Three independent encode points stacked:

1. `Base.astro` rendered `<a href="/@${encodeURIComponent(me.user.did)}">`.
   For a user with no handle, the href was `/@did%3Aweb%3A…`.
2. The browser navigated to that URL. Astro decoded `Astro.params.handle`
   to `did:web:…`.
3. `@[handle].astro` ran `Astro.redirect('/u/' + encodeURIComponent(handle))`
   — encoding the already-decoded value gave `/u/did%3Aweb%3A…`.
4. `/u/[handle].astro` called `client.profile(handle)`. The api.ts
   client appended `/profiles/${encodeURIComponent(identifier)}` —
   third encode, so the wire form was `/profiles/did%253Aweb%253A…`.
5. The API decoded once via Fastify's path parser, then refused to find
   `did%3Aweb%3A…` in users.did.

Pre-Phase-5 there was no defence against step 3 → step 4 stacking;
post-Phase-5 the encode happens exactly once at the HTTP boundary in
api.ts. Phase 5.2 added middleware-level salvage for any stale URL
that survives in caches, bookmarks, AT-proto records, etc.

## Why URLs are friendlier now

After migration 0020 runs every user has a handle. The Astro page
detects when it received a DID-form slug while the user has a
prettier handle, and 301-redirects to the handle. Net result:

- Before: `https://openxiv.net/@did%3Aweb%3Aopenxiv.local%3Aorcid.0009-0003-6027-7837`
- After:  `https://openxiv.net/u/david-alfyorov`

The DID URL still resolves (for old AT-proto records and bookmarks),
it just bounces immediately to the handle URL.

## Failure isolation

Each defence is independent. Any one component going down doesn't
sink the others:

- Web middleware off (e.g. cold-start) → API still 301s legacy DIDs.
- API down → web shows graceful "Profile not available" card with
  Home/Search shortcuts (not a raw stack trace).
- Migration not yet run → `canonicalDidVariants` rewrites the legacy
  DID at request time so the lookup still finds the user via their
  current canonical DID.
- `profileModes.seedDefaults` fails on first sign-in → user record is
  still created; mode pills are absent until the user visits
  /settings/profile.
- Bluesky-follow badge check fails → the badge stays hidden; the rest
  of /u/{handle} renders normally.

## Test coverage

- Unit + property: `apps/api/src/routes/profiles.test.ts` (10),
  `apps/web/tests/profile-handle-normalization.test.ts` (8),
  `apps/web/tests/middleware-url-salvage.test.ts` (15),
  `apps/web/tests/profile-url-encoding.test.ts` (3).
- LIVE integration: `apps/api/src/routes/profiles.integration.test.ts` (3)
  hits the verbatim production-bug URL against a running API and asserts
  301/404 (never 500), proves no `%25` survives.
- E2E: `e2e/tests/profile-flow.spec.ts` exercises sign-in → click name →
  /u/{handle} → settings edit → reload against a live stack with
  chromium. Passes in 2.7s wallclock.

## Rolling back

If for any reason the new code mis-behaves on production data:

```sql
UPDATE users
SET did = legacy_dids[1],
    legacy_dids = legacy_dids[2:],
    updated_at = now()
WHERE array_length(legacy_dids, 1) >= 1 AND did LIKE 'did:web:openxiv.net:u:%';
```

This restores the previous DID and removes the now-current canonical
form from the legacy chain. Then redeploy the prior image. Migration
0020 stays applied; the data is restored to its pre-migration shape.
