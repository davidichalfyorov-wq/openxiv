# Launch readiness — final audit, 2026-05-18

Pre-launch state of the prod stack before Owner uploads the first
preprint. Captured after Goal 6 deploy.

## Prod inventory

| Service | Status | Note |
|---|---|---|
| api | Up, healthy | new image deployed 14:07 UTC |
| worker | Up, listening on BullMQ | pdf-finalize + pdf-figures wired |
| web | Up | rebuilt with explainer-tier copy |
| caddy | Up, restarted 14:09 UTC | Caddyfile now routes `/xrpc/*` to api |
| grobid | Up, **healthy** | HC override (bash /dev/tcp) holding |
| redis, postgres, minio | Up, healthy | 19h uptime |
| latexml, tectonic | **NOT** in compose stack | mocks still on |

## /healthz dependency probe (verbatim)

```
{
  "status": "ok",
  "postgres":  { "status": "up", "latencyMs":  88 },
  "redis":     { "status": "up", "latencyMs":  86 },
  "s3":        { "status": "up", "latencyMs": 108 },
  "grobid":    { "status": "up", "latencyMs": 140 },
  "llm":       { "status": "up", "latencyMs": 409 },
  "atproto":   { "status": "up", "latencyMs": 335 },
  "jetstream": { "status": "up", "latencyMs": 401 }
}
```

All seven probes green.

## Owner identity

```
SELECT role, is_admin_promoted, orcid, handle
FROM users
WHERE orcid = '0009-0003-6027-7837';

 role  | is_admin_promoted |        orcid        |  handle
-------+-------------------+---------------------+----------
 admin | t                 | 0009-0003-6027-7837 | ddavidich
```

Migration 0028 ran cleanly. Owner row is `role='admin'`,
`is_admin_promoted=true`. The in-memory admin set (built at API
startup) now includes both:

1. `did:plc:dzhzljg4peg765tpd2q63luc` (Owner's canonical DID,
   sourced from `users.role='admin'` via the new `listAdmins()`)
2. Any DID listed in the env `ADMIN_DIDS` (static fallback)

A role change via SQL takes effect on the **next API restart**. A
future improvement adds Redis pub/sub invalidation but is not
required for launch.

## account_links coverage

```
SELECT provider, linked_via, COUNT(*) FROM account_links GROUP BY 1, 2;

 provider | linked_via | count
----------+------------+-------
 orcid    | backfill   |     1
 bluesky  | admin      |     1
```

Migration 0029 backfilled the single existing ORCID user (the Owner).
Re-running the migration produces zero new rows (idempotent
through the `UNIQUE(provider, subject)` constraint).

Forward fix in `services/users.ts:ensureAccountLink` writes a row
on every primary OAuth signup. `linked_via='primary_signup'`
distinguishes future inserts from the one-time backfill.

## Bluesky integration polish

| Surface | Path | Status |
|---|---|---|
| Feeds catalog | `GET /api/bsky/feeds` | 200, 3 feeds returned |
| Labeler XRPC | `GET /xrpc/com.atproto.label.queryLabels` | 200, `{labels:[]}` |
| Org DID Document | `GET /.well-known/did.json` | 200, valid JSON-LD |
| User did:web | `GET /u/{subject}/did.json` | works for `orcid.*`, `google.*`, `plc.*` subjects (Owner is did:plc, no did:web doc by design) |
| Bridge queue | `bull:openxiv.compile:waiting` | 0 (no traffic) |
| OAuth callback | `/auth/bluesky/callback` | wired through Caddy `@oauth` matcher |
| Jetstream | `JETSTREAM_FEATURE_FLAG=off` | not started (intentional pre-launch) |
| `USE_MOCK_BLUESKY` | `"false"` | real client in use |

**Caddy fix landed**: `/xrpc/*` was missing from the `@api` matcher,
so the labeler endpoint was 404'ing from outside the cluster. Added
to the matcher; caddy container restarted; verified 200.

## Migrations applied

```
0028_owner_admin              applied 2026-05-18 14:05 UTC
0029_account_links_backfill   applied 2026-05-18 14:05 UTC
```

Both are idempotent: running them a second time produces no rows
changed.

## What's deferred

### LaTeXML + Tectonic unmock — superseded by 2026-05-20 HTML fix

Goal Ф3 asked for `USE_MOCK_LATEXML=false` + `USE_MOCK_TECTONIC=false`
in the prod stack. This was deferred during launch, but the later
HTML pipeline repair moved both compilers into the worker image:

- `packages/clients/src/compiler/tectonic.ts` spawns `tectonic`
  from the worker image.
- `packages/clients/src/latexml/real.ts` spawns `latexml` and
  `latexmlpost` from the worker image.
- The worker image no longer depends on `openxiv/latexml`.

**Follow-up scope** (separate goal, post-launch):

1. Add `docker/tectonic/Dockerfile` + `docker/latexml/Dockerfile`
   with the expected `openxiv-compile.sh` / `openxiv-latexml.sh`
   entrypoints, OR replace the clients with sidecar HTTP services.
2. Mount the Docker socket into worker (or run the LaTeX
   binaries directly inside the worker container with a Dockerfile
   layer that installs them).
3. Flip `USE_MOCK_TECTONIC=false` / `USE_MOCK_LATEXML=false`.
4. Smoke-test with the SCT `.tex` reference paper.

Until the follow-up lands, **the first preprint upload should be a
PDF**, not a `.tex` source.

### Other deferred items

- Bulk admin user management UI — out of scope.
- Role granularity (admin vs super-admin) — out of scope.
- Co-admin invitation flow — out of scope.
- Admin action audit log — out of scope.

## Recent 24h prod logs

Reviewed `/api/profiles/david-alfyorov` 404s (the Owner's profile
is registered under `handle=ddavidich`, not `david-alfyorov`).
External crawlers / OG-tag fetchers are hitting the wrong handle.
Not a code bug — the Owner can publicly correct the canonical
handle once they upload.

No 5xx spikes in the 24h window.

## Pre-launch sign-off blockers — none

Everything below is ready for the Owner walkthrough (Ф5):

1. ✅ Owner row `role=admin`, badge code shipped (visible after
   sign-in)
2. ✅ ORCID `account_links` row for Owner
3. ✅ `/healthz` deeply probes 7 deps, all green
4. ✅ Caddy routes `/xrpc/*` correctly — labeler reachable
5. ✅ `/api/me/profile/modes` PATCH path works (401 unauth, not 404)
6. ✅ Tectonic / LaTeXML deferred with documented follow-up; PDF
   uploads work today

The Owner can proceed with Ф5/Ф8 personal sign-off when ready.
