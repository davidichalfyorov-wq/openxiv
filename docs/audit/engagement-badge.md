# Engagement Badge Audit

## Existing Infrastructure To Reuse

- Endorsements: `packages/db/src/repositories/endorsements.ts` already exposes `statsForPaper()` with total and `byVerb`. The badge should reuse that repository instead of issuing a separate grouped query from the route.
- Event ingest: `apps/api/src/routes/events.ts` accepts `paper_view`, `html_open`, and `pdf_download` through `/api/events/track`. Web pages already call `window.openxivTrack()` from `apps/web/src/layouts/Base.astro`.
- Analytics rollup: `apps/api/src/workers/index.ts` already owns the BullMQ `analyticsRollup` worker and refreshes `papers_views_hourly`. Engagement reads can use that aggregate when fresh, with direct `feed_events` fallback when the rollup is stale or unavailable.
- Redis: `apps/api/src/context.ts` provides `ctx.redis`; existing routes use best-effort Redis cache reads and writes with small TTLs.
- Consent: `apps/web/src/components/CookieBanner.astro` and `packages/shared/src/consent.ts` provide first-party consent primitives. Altmetric needs its own `openxiv_altmetric_opt` cookie because loading Altmetric shares DOI data with a third party and must remain independent from first-party analytics and marketing consent.
- Paper page: `/p/[...id].astro` is the canonical short paper route and already emits `paper_view` and `pdf_download` events. The engagement badge should mount directly under title/authors there.

## New Pieces Required

- `apps/api/src/services/engagement-stats.ts`: single backend service that returns endorsement breakdown, read counters, and Crossref citation count with resilient cache behavior.
- `GET /api/papers/:id/engagement`: public JSON endpoint registered with the existing papers route surface.
- Full engagement Redis cache: short TTL for local stats so Redis failures degrade to direct DB reads, plus invalidation after endorsement create/delete.
- Crossref Redis cache: separate 4 hour TTL keyed by DOI; failures return `citations: null` and never throw the badge route.
- `apps/web/src/components/EngagementBadge.astro`: SSR component for the self-built badge. Endorsements render first, then Crossref citations, then reads.
- `apps/web/src/components/AltmetricBadge.astro`: hidden-by-default opt-in component that lazy-loads Altmetric only after explicit user consent and disables itself under DNT/GPC.

## Punch List

- Reuse `ctx.repos.endorsements.statsForPaper()` for counts and breakdown.
- Reuse `feed_events` and `papers_views_hourly`; fall back to direct `feed_events` aggregation when the rollup is stale or missing.
- Reuse `ctx.redis` with best-effort get/set/del wrappers.
- Keep Altmetric consent separate from `openxiv_consent`.
- Do not add client framework hydration; use Astro SSR plus `is:inline` scripts.
- Do not touch `apps/api/src/services/pdf-cover.ts`.

## Implementation Status

- Backend engagement service and public route are implemented in `apps/api/src/services/engagement-stats.ts` and `apps/api/src/routes/engagement.ts`.
- Endorsement create/delete invalidates the engagement cache from `apps/api/src/routes/endorsements.ts`.
- Analytics rollup now records a Redis freshness key after `papers_views_hourly` refresh so reads use the materialized view only when fresh.
- `/p/[...id]` mounts `EngagementBadge` under title/authors. The badge renders endorsements first, Crossref citations second, reads third.
- Altmetric remains hidden by default, uses independent `openxiv_altmetric_opt` consent, lazy-loads the vendor script only after opt-in, and disables under DNT/GPC.
- Production deployment completed on 2026-05-19. The focused bundle was applied on `/opt/openxiv`, and `api`, `worker`, `web`, and `caddy` were rebuilt/restarted with Docker Compose.
- The production restart exposed an existing VPS config drift: the remote `docker-compose.production.yml` still forced `USE_MOCK_LATEXML=true`, `USE_MOCK_DETECTOR=true`, and MinIO default credentials. The current shared env guard correctly refused to start in `NODE_ENV=production`, producing 502s while API/worker were down. The fix was to deploy the current production compose file, rotate MinIO credentials on the VPS without printing values, and recreate `minio`, `api`, `worker`, `web`, and `caddy`.
- The production database had no published papers, so acceptance needed a real persisted smoke record. `output/production-engagement-smoke.sql` seeds `openxiv:physics.2026.00001` idempotently with a published paper row, author/category/keywords, disclosure, summary, typed endorsements, and read events.
- `output/prod-engagement-smoke.cjs` is the production browser smoke used for Altmetric consent verification.
- A focused deployment bundle is prepared at `.openxiv-engagement-badge-patch.tar`. It contains the engagement badge implementation, tests, package metadata, lockfile, and this audit note.

## Verification

- `corepack.cmd pnpm --filter @openxiv/api typecheck`
- `corepack.cmd pnpm --filter @openxiv/web typecheck` returned 0 errors, with pre-existing warnings/hints outside this change.
- `corepack.cmd pnpm --filter @openxiv/api build`
- `corepack.cmd pnpm --filter @openxiv/web build`
- `DATABASE_URL=postgres://openxiv:openxiv@localhost:5432/openxiv corepack.cmd pnpm --filter @openxiv/api exec vitest run tests/integration/engagement-stats.test.ts` passed 3 tests.
- `corepack.cmd pnpm --filter @openxiv/e2e typecheck` passed.
- `corepack.cmd pnpm --filter @openxiv/e2e exec playwright test tests/engagement-badge.spec.ts` passed 4 tests. The spec seeds a real local published paper, author, endorsements, and read events when `E2E_ENGAGEMENT_PAPER_PATH` is not supplied, then cleans the fixture after the run. It covers pre-consent Altmetric isolation, opt-in load, DNT disable, and real endorsement mutation/cache invalidation.
- `$env:E2E_BASE_URL='http://localhost:4330'; corepack.cmd pnpm --filter @openxiv/e2e test` passed with 28 tests passed, 8 credential/live-environment tests skipped, and 0 failures against the controlled local web server wired to the local API.
- Production smoke on 2026-05-19:
  - `https://openxiv.net/healthz` returned 200.
  - `https://openxiv.net/api/papers` listed the published smoke record `openxiv:physics.2026.00001`.
  - `https://openxiv.net/api/papers/physics.2026.00001/engagement` returned 200 with `endorsements.count=2`, breakdown `{ checked_references: 1, useful_background: 1 }`, reads `{ views: 3, html_opens: 1, pdf_downloads: 2 }`, and `citations=null`.
  - Redis contained `engagement:crossref:10.5555/openxiv-engagement-smoke-2026` with `{"citations":null}`, proving the Crossref fallback is cached.
  - `node output/prod-engagement-smoke.cjs` passed against `https://openxiv.net/p/physics.2026.00001`: badge visible with endorsements first, no Altmetric/CloudFront requests before opt-in or while showing the prompt, request observed after `Show once`, `openxiv_altmetric_opt=session` set, and DNT disabled the toggle with zero Altmetric requests.
