# Launch readiness audit — 2026-05-18

Scope: pre-launch sanity on Tier-2 figure extraction (GROBID pipeline),
the `modes save 404` regression, and across-the-board code health.
This document is the "shape of reality" snapshot the next phases work
from.

## Critical findings

| # | Issue | Where | Status |
|---|---|---|---|
| 1 | `modes save` → HTTP 404 in UI | `apps/web/src/pages/settings/profile.astro:169,202` | **FIXED** |
| 2 | GROBID container reports `unhealthy` for 18h+ | docker compose | **FIXED** |
| 3 | 7 web callers double-prefix `/api-proxy/api/…` | grep `/api-proxy/api/` in `apps/web/src` | **FIXED** |
| 4 | No figure-extraction pipeline at all | — | **DELIVERED** in Ф3-Ф6 |

### Finding #1 — modes save 404 (root cause)

The UI POSTs to `/api-proxy/api/me/profile/modes`. The Astro proxy
(`apps/web/src/pages/api-proxy/[...path].ts`) is documented to *always
prepend* `/api/` to the forwarded path:

```ts
// Always prepend /api so the upstream hits the canonical mount.
const target = `${API_BASE}/api/${path}${url.search}`;
```

With `path = "api/me/profile/modes"` the upstream target becomes
`${API_BASE}/api/api/me/profile/modes`. The API has *no* `/api/api/…`
route → 404. The same bug bites 6 other callers that were never
migrated when Phase 7 of the profile rollout flipped
`OPENXIV_FLAG_LEGACY_UNPREFIXED_MOUNT=0`:

- `Base.astro` `events/track` (beacon + fetch)
- `lens/[source]/[id].astro` `ai-question`, `claim`
- `settings/profile.astro` `modes`, `cards/:cardType`
- `u/[handle].astro` `me/bluesky/follows/check`

All seven callers were changed to drop the redundant `/api/`. Server-
side `routes/profile-settings.ts` was *correct* the whole time
(registered at `/me/profile/modes` under the `/api` prefix).

### Finding #2 — GROBID `unhealthy`

`lfoppiano/grobid:0.8.1` doesn't ship `curl` or `wget`. The upstream
Dockerfile's healthcheck is:

```yaml
test: ["CMD", "curl", "-f", "http://localhost:8070/api/isalive"]
```

This command can never succeed inside the container — `docker inspect`
reports unhealthy on every install. The service itself is fine: an
HTTP request from the host network or another container's `node` runtime
both return `true` against `/api/isalive`.

Fix: docker-compose.production.yml override using bash + `/dev/tcp`
(bash is present in the image):

```yaml
healthcheck:
  test:
    - "CMD-SHELL"
    - "bash -c 'exec 3<>/dev/tcp/localhost/8070; printf \"GET /api/isalive HTTP/1.0\\r\\nHost: localhost\\r\\n\\r\\n\" >&3; head -c 4096 <&3 | grep -qi true'"
  interval: 15s
  timeout: 5s
  retries: 8
  start_period: 90s   # GROBID needs ~60s to load all Wapiti models
```

A periodic cron probe `scripts/sanity-grobid.sh` wraps the same check
for external monitoring.

## Codebase health

### TypeScript strictness

- All three workspace packages (`@openxiv/api`, `@openxiv/db`,
  `@openxiv/web`) build with `strict: true` and no `@ts-ignore` in
  source. `apps/api` typecheck **clean** at the time of audit.
- `noUncheckedIndexedAccess` and `noPropertyAccessFromIndexSignature`
  are both enabled. Existing code uses bracket-notation for `process.env`
  consistently.

### Lint & dead code

- `pnpm lint` not wired as a workspace-level npm script — opportunity
  for Ф7 to centralise.
- knip not currently in `package.json`; an opportunistic pass found
  no obvious dead exports in `apps/api/src/services/`.

### Error handling pattern

`Errors.*` (in `@openxiv/shared`) is the canonical surface. Routes
throw `Errors.notFound`, `Errors.validation`, etc. Workers convert via
`rethrowForBullMQ` which maps the kind set
`{validation, not_found, forbidden, unauthorized, conflict}` to
`UnrecoverableError` so retries don't burn the budget. Pattern is
already consistent.

### Logging

- API: `pino` configured in `apps/api/src/index.ts`.
- Workers: `console.warn`/`console.error` — kept because pino isn't
  wired into the worker subprocess yet. Acceptable for MVP; the
  `worker:failed` Redis hash carries the structured counter ops needs.

### `.env.example` coverage

Audit of `packages/shared/src/env.ts` against `.env.example` shows all
required vars (`DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`,
`JWT_SECRET`, S3 cluster, `PUBLIC_API_BASE`, `PUBLIC_WEB_BASE`) are
documented. Optional Crossref/Bluesky/ORCID keys are listed under an
"Optional" section.

### Backups

`docker exec openxiv-postgres-1 pg_dumpall …` produces a logical
backup. `pg_restore` round-trip is not currently part of the
restore-test cadence (operator runs manually). Action item: add a
weekly cron that pipes `pg_dumpall | gzip > /opt/openxiv/backups/…`
and a manual quarterly restore-rehearsal runbook.

## Out-of-scope confirmed

- Figure semantic search (vector embeddings over figure captions) — Tier 5.
- OCR for scanned PDFs — Tier 5.
- Figure-level citation graph — Tier 4.
- Alt-text auto-generation — Tier 4 (LLM-driven).

These remain on the long-term roadmap; we ship cropped figures + caption
+ click-to-zoom for the launch.
