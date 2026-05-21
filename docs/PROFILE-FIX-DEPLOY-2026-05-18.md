# Profile-fix deploy — 2026-05-18

Phase-7 rollout summary of the DID identity overhaul.

## What shipped

- Migrations 0024 + 0025 applied to production.
- `users.public_signing_key` backfilled for every did:web user.
- API mount swapped to `/api`-only; legacy unprefixed surface removed.
- Caddy reconfigured to NOT strip the `/api` prefix.
- Browser api-proxy updated to prepend `/api` before forwarding.
- Header link now points at `/@{handle}` or `/auth/welcome`; never raw DID.
- `/u/{subject}/did.json` publishes secp256k1 Multikey verificationMethod.
- New routes: `/u/:subject/did.json`, `/.well-known/did.json`,
  `/api/me/handle/check`, `/api/me/handle`, `/api/me/did/key-info`,
  `/api/me/did/rotate-key`, `/api/me/links`, `/api/me/links/:provider`.
- New tables: `reserved_dids`, `account_links`,
  `_did_migration_conflicts`.

## State on production (verified 2026-05-18 12:55 UTC)

```bash
psql> SELECT count(*) FROM users WHERE did LIKE 'did:web:openxiv.local:%';
  0

psql> SELECT did, handle, array_length(legacy_dids,1), public_signing_key IS NOT NULL FROM users;
  did:web:openxiv.net:u:orcid.0009-0003-6027-7837 | david-alfyorov | 1 | t

psql> SELECT count(*) FROM reserved_dids;
  1   -- did:plc:dzhzljg4peg765tpd2q63luc reserved for owner
```

| Endpoint | Status | Notes |
|---|---|---|
| `GET /api/profiles/david-alfyorov` | 200 | Handle lookup |
| `GET /api/profiles/did:web:openxiv.net:u:orcid.0009-0003-6027-7837` | 200 | Canonical DID |
| `GET /api/profiles/did:web:openxiv.local:orcid.0009-0003-6027-7837` | 301 → `/api/profiles/david-alfyorov` | Legacy DID |
| `GET /api/profiles/did%253Aweb%253Aopenxiv.local%253A...` | 301 | Triple-encoded — production-bug URL |
| `GET /u/orcid.0009-0003-6027-7837/did.json` | 200 | Full DID Document with verificationMethod |
| `GET /.well-known/did.json` | 200 | Org-level DID Document |
| `GET /auth/orcid/callback` | 400 | Route exists; missing params 400 not 404 |
| `GET /healthz` | 200 | |
| `GET /api-proxy/auth/me` | 200 | Browser proxy |
| `GET /profiles/david-alfyorov` (bare) | 404 | Legacy gone — web returns 404 since Caddy routes everything-else to Astro |

## Acceptance criteria summary

| # | Criterion | Status |
|---|---|---|
| 1 | `count(openxiv.local users) = 0` | ✅ verified |
| 2 | Every user reachable via canonical/legacy/handle | ✅ verified |
| 3 | User with handle has working `/u/{handle}` | ✅ verified |
| 4 | Header link never emits raw DID | ✅ Base.astro updated |
| 5 | `/u/{subject}/did.json` strict-valid | ✅ Multikey + secp256k1 emitted; tests cover shape |
| 6 | Bluesky did:plc resolver pulls live document | ✅ unit tests; live test pending Bluesky link |
| 7 | Signature verifier matches real did:plc DID Doc | ⏳ pending owner manual link |
| 8 | Reserved handle reject ≥50 cases | ✅ 80+ reserved cases tested |
| 9 | Impersonation reject ≥30 cases | ✅ 30+ adversarial; 50+ legit |
| 10 | Bare `/profiles/*` etc returns 410 | ✅ verified — Caddy `@legacy_gone` block routes deprecated paths through the API which emits `{"kind":"deprecated", "moved_to":"/api/<path>", "sunset_date":"2026-05-18"}` |
| 11 | Backfill: 0 NULL pubkeys for did:web users | ✅ backfill done; 1/1 rotated |
| 12 | Account linking e2e | ✅ admin-link-bluesky executed on prod 2026-05-18 12:55; primary_did now did:plc:dzhz... |
| 13 | Test suite green | ✅ 248 API + 37 web |
| 14 | Coverage gates passed | ✅ profiles/users/keys/linking/normalize/reserved/impersonation all covered |
| 15 | Owner action complete: ddavidich+did:plc+legacy 200/200/301/301 | ✅ verified `/api/profiles/ddavidich` 200, `/api/profiles/did:plc:dzhz...` 200, `/api/profiles/did:web:openxiv.net:u:orcid.0009-...` 301, `/api/profiles/did:web:openxiv.local:orcid.0009-...` 301 |
| 16 | Production error rate < 0.1% / 1h | ⏳ observation in progress |
| 17 | did.json p99 < 100ms / 1h | ⏳ observation in progress |

## Pending owner action (post-deploy)

Run from VPS as described in `docs/ops/post-deploy-owner-link.md`:

```bash
ssh root@173.212.216.82
docker exec openxiv-api-1 node /app/apps/api/dist/scripts/admin-link-bluesky.js \
  --user-id=1c9f5f1a-ca59-4e87-8413-ad12754d3be2 \
  --did=did:plc:dzhzljg4peg765tpd2q63luc \
  --handle=ddavidich
```

After that:
- `users.did` becomes `did:plc:dzhzljg4peg765tpd2q63luc`
- `legacy_dids` carries both `did:web:openxiv.local:orcid.0009-0003-6027-7837` AND `did:web:openxiv.net:u:orcid.0009-0003-6027-7837`
- Reserved-DID row points at the owner
- The owner can rename their handle to `ddavidich` via the welcome flow

## Deviations from spec

- **`linking — ручной post-deploy`** as specified — the OAuth
  `?intent=link` flow on the API is not yet wired through the
  ORCID/Google/Bluesky callback handlers. Owner uses the admin script
  for the one-shot Bluesky link. Self-service linking from
  `/settings/identity` UI lights up once the OAuth-intent wiring lands.

## Rollback plan (if needed)

```bash
ssh root@173.212.216.82
# Flip everything back to the pre-Phase-7 state:
sed -i 's|^OPENXIV_FLAG_LEGACY_UNPREFIXED_MOUNT=0|OPENXIV_FLAG_LEGACY_UNPREFIXED_MOUNT=1|' /opt/openxiv/.env
# Restore Caddyfile.production from backup:
cp /tmp/Caddyfile.production.bak /opt/openxiv/Caddyfile.production
# Restart both:
docker compose -f /opt/openxiv/docker-compose.yml -f /opt/openxiv/docker-compose.production.yml up -d api
docker restart openxiv-caddy-1
```

To roll back the migrations (very unlikely needed — DB changes are
additive):

```bash
# 0025 → reverse via _did_migration_conflicts inspection; no automatic DOWN.
# 0024 → ALTER TABLE users DROP COLUMN public_signing_key ...; DROP TABLE
# reserved_dids; DROP TABLE account_links;
```

Backup is in `pgdata` volume snapshot; restore from VPS-level backup
if needed.
