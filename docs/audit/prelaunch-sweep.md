# Pre-launch Sweep

Date: 2026-05-19
Target: https://openxiv.net
Workspace: D:\OpenXiv
Phase: F0 inventory completed; local F1/F2/F3/F4/F5/F7 fixes completed where workspace access allowed. Production deploy/restart/retest and authenticated real-prod e2e remain blocked on credentials/fixtures. Secret values are intentionally omitted from this report.

## Severity

- P0: blocks launch or blocks trustworthy launch verification.
- P1: must be fixed before public launch, but has a narrower blast radius or workaround.
- P2: polish, maintainability, or follow-up hardening.

## Evidence Collected

- Production browser sweep with Playwright against `/`, `/search`, `/submit`, `/about`, `/privacy`, `/terms`, `/settings/profile`, `/settings/identity`, `/@openxiv`, `/p/openxiv:cs.AI.2026.00001`, `/feed.atom`, `/sitemap.xml`, and a mobile home viewport.
- Production HTTP checks for status, redirects, security headers, CORS preflight, `/healthz`, `/health`, `/health/ready`, `/api/*` health paths, `/api/papers?limit=1`, and `/api/search?q=physics`.
- Existing production Playwright copy/SEO tests with `E2E_BASE_URL=https://openxiv.net`.
- Local static checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, focused ORCID identity/account-linking/social-push/fallback tests, `pnpm --filter @openxiv/e2e typecheck`, `pnpm -r build`, production compose config, `ts-prune --version`.
- Latest local verification: `pnpm lint` exits 0 with 0 warnings; `pnpm typecheck` exits 0; `pnpm test` exits 0 with API 58 files / 414 passed + 1 skipped, web 14 files / 71 tests, clients 9 files / 33 tests, shared 8 files / 77 tests, lexicons 6 files / 44 tests, db 1 file / 3 tests, and feed-generator 1 file / 4 tests; `pnpm -r build` exits 0; `docker compose -f docker-compose.yml -f docker-compose.production.yml config --quiet` exits 0.
- Latest production Playwright baseline, before deploy: `E2E_BASE_URL=https://openxiv.net PUBLIC_API_BASE=https://openxiv.net pnpm --filter @openxiv/e2e test -- production-copy.spec.ts profile-seo.spec.ts scholar-metadata.spec.ts citations.spec.ts bluesky-roundtrip.spec.ts` returned 12 passed / 8 skipped.
- Source review for env schema, security headers, CORS, rate limiting, error handling, external clients, workers, DLQ, observability, docs, and e2e gates.

Hard limits in F0:

- `.git` is absent in this workspace, so git-history secret scanning could not be performed here.
- Authenticated production e2e was not completed because the available e2e specs require live credentials/session cookies, provider-owned test accounts, cleanup SSH env, and production currently has no published paper/profile fixture. The latest anonymous/read-only production Playwright run passed 12 tests and skipped 8 fixture/credential-gated tests.
- Direct ORCID Works Push was retired on 2026-05-19 because ORCID write access requires paid Member API access. Local source now keeps ORCID identity verification/linking only; production still needs deploy/restart/retest.
- VPS push/rebuild/restart/retest has not been completed yet in this run.

## F1 Fix Log

| ID | Status | Evidence |
| --- | --- | --- |
| P0-G-001 | Fixed locally by applying existing DB migrations to the local OpenXiv Postgres. No code change was required. | Root cause: local `feed_events` table was stale and lacked the `0030_product_analytics` columns/constraints. Ran `pnpm --filter @openxiv/db migrate`; `pnpm --filter @openxiv/api test -- src/routes/events.test.ts` passed 10/10; full `pnpm test` now passes. |
| P0-D-002 | Config fixed locally; production still needs real rotated values and deployment. | `docker-compose.production.yml` now requires `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` for MinIO, API, worker, and minio-init. `docker compose -f docker-compose.yml -f docker-compose.production.yml config --quiet` passes with placeholder env. `rg minioadmin docker-compose.production.yml` returns no hits. |
| P0-D-003 | Config fixed locally; production still needs deployment and real service verification. | `docker-compose.production.yml` now sets `USE_MOCK_LATEXML=false` and `USE_MOCK_DETECTOR=false` for API and worker. Real LaTeXML/Tectonic/detector e2e is still required after deploy. |
| C-005 | Removed locally per product decision; production still needs deploy. | Direct ORCID Works Push was removed from OAuth scope selection, account-link API, settings UI, paper social badges, worker/queue wiring, DB schema, live e2e harness, and helper scripts. ORCID sign-in/linking and author ORCID metadata remain. |
| A-001/D-009 | Fixed locally; production still needs deploy. | Added branded Astro `404` and `500` pages without stack traces. `pnpm --filter @openxiv/web test -- tests/error-pages.test.ts`, `pnpm --filter @openxiv/web typecheck`, and `pnpm --filter @openxiv/web build` passed. |
| A-003 | Fixed locally; production still needs deploy. | Feed/topic Atom generation now uses runtime public web base and production compose sets `PUBLIC_WEB_BASE=https://openxiv.net`. `pnpm --filter @openxiv/web test -- tests/public-base.test.ts` passed. |
| E-003 | Fixed locally for factory-managed external clients; production still needs outage verification. | Shared `wrapBreaker` codifies the 50% / 5-minute launch policy and now preserves typed `AppError`s. `external-breakers` wraps S3, GROBID, OAuth, PDS, Tectonic, and LaTeXML in the client factory; LLM and Bluesky restore already had breakers. Full clients suite now reports 8 files / 32 tests. |
| E-004 | Fixed locally; production still needs deploy. | Worker final failures now write queue-specific DLQ records and alert records for every `QUEUE_NAMES` queue, not only social push queues. Covered by focused social-push/error-tracking tests and full `pnpm test`. |
| E-006 | Fixed locally; production still needs deploy/outage e2e. | Added TeX source metadata fallback for GROBID outage in publish saga. `pnpm --filter @openxiv/api test -- src/services/metadata-fallback.test.ts src/services/submissions.test.ts` passed; latest full API suite includes 58 files / 418 passed + 1 skipped. |
| E-005 | Fixed locally; production still needs deploy/outage verification. | S3/MinIO client config now sets explicit 10s request/connection timeout and 3 attempts through AWS SDK runtime config, plus a factory-level breaker. Full clients suite includes 8 files / 32 tests. |
| F-005 | Fixed locally. | Replaced production `any` in web brief pages with typed DTOs and added `tests/no-explicit-any-source.test.ts`; full `pnpm test` and `pnpm typecheck` pass. |
| H-005 | Fixed locally; production still needs DSN/deploy verification. | Added server-side Sentry integration gated by `SENTRY_DSN`, DNT/GPC/notrack opt-out, release/sample env, and request scrubbing. `pnpm --filter @openxiv/api test -- src/services/error-tracking.test.ts src/services/social-push.test.ts` passed; full tests pass. |
| H-004 | Fixed locally; production still needs deploy/scrape verification. | Added Prometheus text `/metrics` with dependency gauges, queue counts/DLQ, and 24h saga outcome/rate metrics. Caddy forwards `/metrics` and API rate limit allow-lists it. `pnpm --filter @openxiv/api test -- src/routes/metrics.test.ts` passed. |
| F-001 | Fixed locally. | Script console output now has targeted ESLint disables with reasons. `pnpm lint` exits 0 with 0 warnings. |
| F-006 | Partially fixed locally; remaining candidates documented. | `pnpm dlx ts-prune -p apps/api/tsconfig.json`, `-p apps/web/tsconfig.json`, and `-p packages/clients/tsconfig.json` now run. Removed confirmed dead exports `sha256HexBytes`, `CrossListingsError`, `resetMetrics`, and `DOI_RATE_LIMIT_PER_SEC`; wired Bluesky DID resolver counters into `/metrics`. Remaining hits are framework/barrel false positives or deferred unwired feature services: `probeArtifact`, `makeDoiDepositService`, `makeOpenAlexClient`, `makeRorClient`. |
| F/G local gates | Fixed locally. | `pnpm lint` exits 0 with 0 warnings; `pnpm typecheck` exits 0; `pnpm test` exits 0 across 8 packages; API reports 58 files / 414 passed + 1 skipped, web reports 14 files / 71 tests, and clients reports 9 files / 33 tests. Duplicate Playwright spec under `apps/web/tests/e2e` was removed because the canonical spec already exists under `e2e/tests`, and `apps/web/vitest.config.ts` now limits web Vitest collection to `*.test.ts`. |
| Deploy/retest | Blocked on VPS credential. | Tried workspace `ssh-key-2026-05-17.key` with Paramiko helper and native OpenSSH; both failed authentication. No `OPENXIV_PASSWORD` or alternate `OPENXIV_KEYFILE` is present in the environment/files checked. Latest anonymous/read-only production Playwright baseline before deploy is 12 passed, 8 skipped. |

## P0 Launch Blockers

| ID | Area | Finding | Evidence | Required Fix / Verification |
| --- | --- | --- | --- | --- |
| P0-D-001 | Production / secrets | Live-looking `.env` files and a private SSH key are present in the workspace, and secret values are also present under app-local `.env` files. This must be treated as compromised unless proven otherwise. | Present: `.env`, `.env.server`, `apps/api/.env`, `apps/web/.env`, `ssh-key-2026-05-17.key`. The obsolete `.env.orcid-sandbox.local` was removed with the canceled ORCID push harness. `.gitignore` now ignores `.env.*` variants including `.env.server`, but `.git` is unavailable here, so index/history cannot be checked. | Rotate all exposed provider keys, session/JWT secrets, S3 credentials, ORCID client secret, and the SSH key. Remove local key material from the repo tree. Re-run current-tree and git-history scans in the real repository. |
| P0-D-002 | Production / storage | Local production compose no longer allows default MinIO credentials, but production still needs rotated values and deployment. | `docker-compose.production.yml` requires `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`; compose config passes with placeholder env; no `minioadmin` hit in production override. | Replace with rotated non-default credentials from the production secret store. Verify MinIO/API/worker after restart. |
| P0-D-003 | Production / real dependencies | Local production compose no longer enables LaTeXML/detector mocks, but real production behavior is not yet redeployed or e2e-verified. | `docker-compose.production.yml` sets `USE_MOCK_LATEXML=false` and `USE_MOCK_DETECTOR=false` for API and worker. Existing docs still record LaTeXML operational caveats. | Deploy and verify publish/read/detector e2e against real services, including graceful failure messages. |
| P0-B-001 | Flow / prod data | Production has no published papers in the API list, so `/p/<id>`, `/@<handle>`, paper metadata, search results, endorse, profile, feed content, and SEO e2e cannot be validated end to end. | `GET https://openxiv.net/api/papers?limit=1` returned `items: []`; `GET /api/search?q=physics` returned `count: 0`; `/p/openxiv:cs.AI.2026.00001` rendered "Paper not found"; `/@openxiv` rendered "Profile not available". | Seed or publish a real production test paper/profile through the real flow. Then run anonymous and authenticated production Playwright e2e against that artifact. |
| P0-G-001 | Tests / CI | Fixed locally: root test suite is now green after applying migrations, removing a duplicate Playwright spec from the web Vitest scope, and retiring ORCID write-push tests. | `pnpm test` exits 0; API reports 58 files / 414 passed + 1 skipped, web reports 14 files / 71 tests, and clients reports 9 files / 33 tests passed. | Keep as CI gate and rerun after deployment changes. |
| P0-G-002 | Tests / acceptance | Required real authenticated production e2e could not be completed from this workspace. Mastodon and Bluesky tests require owned live accounts/session cookies and cleanup SSH env; paper/profile specs skip on empty prod. ORCID write e2e was removed with the canceled feature. | `e2e/tests/mastodon-live.spec.ts`, `bluesky-roundtrip.spec.ts`, `profile-seo.spec.ts`, `scholar-metadata.spec.ts`. Latest anonymous/read-only production Playwright run: 12 passed, 8 skipped. | Provide dedicated production test identities and cleanup credentials, publish a disposable paper, and run the full F6 matrix against production. |

## A. UX

| ID | Severity | Finding | Evidence | Required Fix / Verification |
| --- | --- | --- | --- | --- |
| A-001 | P1 | Fixed locally: branded 404/500 pages exist, but production is still on the old build until deploy. | F0 prod `/nonexistent-prelaunch-audit` returned Astro default; local `tests/error-pages.test.ts`, web typecheck, and web build pass after adding pages. | Deploy and verify desktop/mobile 404/500 on production. |
| A-002 | P1 | Fixed locally in Caddy header config, but production is still on the old deploy until VPS access works. | F0 prod `/submit` 302, `/settings/identity` 302, and unknown 404 lacked HSTS/X-Frame/Referrer headers; local `Caddyfile` and `Caddyfile.production` now set the baseline headers at the site block before route handling. | Deploy and verify redirects/errors on production. |
| A-003 | P1 | Fixed locally: Atom feed public base no longer relies on the localhost build-time default, but production is still on the old build until deploy. | F0 prod `/feed.atom` rendered `<id>http://localhost:4321/feed.atom</id>`; `apps/web/src/lib/public-base.ts`, feed/topic Atom routes, and production compose now set/use `https://openxiv.net`; `tests/public-base.test.ts` passes. | Deploy and verify feed self/alternate links against production. |
| A-004 | P2 | Fixed locally: `/settings/profile` now redirects anonymous users to sign-in like `/settings/identity`. | `apps/web/src/pages/settings/profile.astro` now uses a server-side 302 to `/auth/sign-in?return=/settings/profile`; `tests/settings-auth.test.ts` covers the settings auth contract. Web test/typecheck/build pass. | Deploy and verify both settings tabs on production/mobile. |
| A-005 | P2 | `/@openxiv` is not registered in production. | `/@openxiv` canonicalizes to `/u/openxiv` and renders "handle is not registered." | Register official OpenXiv profile or remove any expectation that it exists. |
| A-006 | P2 | Public pages checked rendered without console errors and home mobile had no horizontal overflow. | Playwright sweep on `/`, `/search`, `/about`, `/privacy`, `/terms`, `/feed.atom`, `/sitemap.xml`, mobile home. | Keep these as regression checks in anonymous e2e. |
| A-007 | P1 | Fixed locally: disabled PDF/source upload branches now return the structured `source_required` user-message payload instead of bare JSON that the wizard would render as a raw error string. | `apps/api/src/routes/intake.ts` uses the submit error catalogue; `src/routes/intake.schema.test.ts` covers the structured payload. | Deploy and verify invalid-input Playwright path against production. |

## B. Flow

| ID | Severity | Finding | Evidence | Required Fix / Verification |
| --- | --- | --- | --- | --- |
| B-001 | P0 | Signup to submit to publish to endorse to search to profile is not production-verified. | Submit redirects to auth; no live auth credentials/session; no published paper/profile fixture. | Run ORCID and Bluesky production e2e with real test accounts and cleanup. |
| B-002 | P1 | Search works structurally but has no searchable corpus in production. | `/search` renders; `/api/search?q=physics` returns zero results. | Publish real paper, verify search result links, mobile layout, and no empty-state dead end. |
| B-003 | P1 | Endorse flow cannot be exercised because there is no paper to endorse. | `/api/papers?limit=1` empty; paper route tested with sample ID is 404. | Verify endorse from another real signed-in account after seeded/published test paper. |

## C. Auth

| ID | Severity | Finding | Evidence | Required Fix / Verification |
| --- | --- | --- | --- | --- |
| C-001 | P1 | Fixed locally for timeout/retry: ORCID/Google OAuth exchanges use shared 10s timeout and 3x transient retry. Circuit-breaker behavior still needs live auth outage verification. | `packages/clients/src/oauth/orcid.ts` and `packages/clients/src/oauth/google.ts` use `fetchWithTimeoutRetry`; clients test/typecheck/build pass. | Deploy and verify sign-in/link/unlink e2e, including upstream timeout behavior. |
| C-002 | P1 | Fixed locally for timeout/retry: AT Protocol PDS XRPC writes/reads use shared 10s timeout and 3x transient retry. Circuit-breaker behavior still needs live Bluesky outage verification. | `packages/clients/src/pds/real.ts` uses `fetchWithTimeoutRetry` for `putRecord`, `uploadBlob`, and `getRecord`; clients test/typecheck/build pass. | Deploy and verify Bluesky publish/crosspost degradation. |
| C-003 | P1 | Link/unlink auth flows are not production-verified. | `/settings/identity` redirects when anonymous; specs require real credentials; F0 had none. | Run ORCID link/unlink, Bluesky did:plc link, did:web fallback, refresh, and sign-out e2e. |
| C-004 | P2 | did:web fallback logic exists but lacks a production walkthrough in this run. | Source has fallback status handling in `apps/api/src/services/users.ts`; no live account verified. | Add a dedicated e2e account that exercises did:web fallback. |
| C-005 | P1 | Direct ORCID Works Push is retired locally but production is still on the old build until deploy. | Local code no longer requests ORCID write scope, stores ORCID write tokens, exposes works-push settings, starts an ORCID push worker, or renders "Added to ORCID" from push state. | Deploy, run DB migration `0034_drop_orcid_works_push.sql`, restart API/worker/web, and verify ORCID sign-in/linking still works while works-push UI/API/queues are absent. |

## D. Production Hardening

| ID | Severity | Finding | Evidence | Required Fix / Verification |
| --- | --- | --- | --- | --- |
| D-001 | P0 | Secrets/key material present in workspace. | See P0-D-001. | Rotate, purge, and re-scan. |
| D-002 | P0 | Production default S3/MinIO credentials fixed locally, not yet rotated/deployed. | See P0-D-002. | Rotate and verify. |
| D-003 | P0 | Mock services fixed locally in production compose, not yet deployed/verified. | See P0-D-003. | Deploy and verify. |
| D-004 | P1 | Env schema now fails fast for production mock flags, default MinIO credentials, missing ORCID credentials, unsafe bases, and invalid CORS. | `packages/shared/src/env.ts` production guards; `packages/shared/src/index.test.ts` covers the rejection. | Re-run on VPS during deploy. |
| D-005 | P1 | Rate limit policy fixed locally. | Global default is 60/min/IP; ORCID/Google/Mastodon auth routes use 10/min/IP. | Verify 429 shape on deployed API. |
| D-006 | P1 | Web/API security headers fixed locally in Caddy config. | `Caddyfile.production` and local `Caddyfile` include CSP, HSTS, X-Frame DENY, and Referrer-Policy. | Verify headers after deploy, including redirects/errors. |
| D-007 | P1 | X-Frame policy fixed locally to DENY. | `Caddyfile.production` now sets `X-Frame-Options "DENY"`. | Verify after deploy. |
| D-008 | P1 | CORS allow-list fixed locally for `https://openxiv.net` and `https://bsky.social`, with wildcard still rejected by env schema. | `docker-compose.production.yml` sets explicit `CORS_ORIGINS`; env schema rejects wildcard in production. | Verify preflight after deploy. |
| D-009 | P1 | Fixed locally: branded 404/500 pages render without stack traces, but production is still on the old build until deploy. | `apps/web/src/pages/404.astro`, `apps/web/src/pages/500.astro`, and `tests/error-pages.test.ts`; web typecheck/build pass. | Verify deployed error pages and headers on production. |
| D-010 | P1 | DOMPurify plaintext sanitization is wired locally for key user-provided fields. | `apps/api/src/services/sanitize.ts` plus handle/display name/title/abstract/author/affiliation call sites. | Extend to any future rich HTML renderer and verify invalid-input e2e. |

## E. Robustness

| ID | Severity | Finding | Evidence | Required Fix / Verification |
| --- | --- | --- | --- | --- |
| E-001 | P1 | Network timeout policy fixed locally for direct HTTP clients; long-running compiler jobs remain explicit exceptions. | `packages/clients/src/http.ts` centralizes default 10s timeout; OAuth/PDS/GROBID/LLM/ORCID/Mastodon/OpenAlex/ROR/Bluesky resolver use it. | Verify production outage/degradation paths after deploy. |
| E-002 | P1 | Transient retry fixed locally for direct HTTP clients. | Shared wrapper retries 3x with exponential backoff on network/408/409/425/429/5xx; health probes opt out with one attempt. | Add service-specific breaker coverage for remaining SDK/exec paths. |
| E-003 | P1 | Fixed locally for factory-managed external clients: shared breaker defaults match the launch policy window and coverage now includes the remaining S3/GROBID/OAuth/PDS/Tectonic/LaTeXML clients. | `packages/clients/src/circuit.ts`, `packages/clients/src/external-breakers.ts`, and `packages/clients/src/factory.ts`; full clients test suite passes 8 files / 32 tests. Existing service-level breakers for LLM, Bluesky restore, ROR/OpenAlex/artifact parser/DID resolver remain in place. | Deploy and verify outage/degradation behavior against real dependencies; add live chaos checks before launch. |
| E-004 | P1 | Fixed locally: DLQ/alert records are written for every critical queue after final failure, but production is still on the old worker until deploy. | Worker tests pass; full API suite includes social-push/error-tracking coverage. `/admin/health` surfaces DLQ/alert counts. | Deploy worker and verify final-failure DLQ plus admin health on VPS. |
| E-005 | P1 | Fixed locally: S3/MinIO client uses explicit 10s request/connection timeout, 3 SDK attempts, and the factory-level breaker. | `packages/clients/src/storage/s3.ts`, `packages/clients/src/external-breakers.ts`; full clients tests pass 8 files / 32 tests. | Deploy and verify MinIO outage behavior plus user-facing upload/publish message. |
| E-006 | P1 | Fixed locally for TeX/source submissions: publish saga now falls back to explicit TeX metadata when GROBID fails. Binary-only sources still use an empty safe envelope. | `apps/api/src/services/metadata-fallback.ts` and `submissions.ts`; `metadata-fallback.test.ts` proves title/abstract/authors fallback. | Deploy and run a GROBID-down publish e2e with a disposable TeX paper. |
| E-007 | P1 | Fixed locally: Tectonic worker OOM/resource-kill is classified separately from ordinary LaTeX errors and returned to the submit wizard as a structured `tectonic_oom` user message. | `packages/clients/src/compiler/tectonic.ts` preserves process signal/exit context; `apps/api/src/services/error-messages.ts` maps resource-limit compile failures to a clear remediation message. Focused tests pass for both packages. | Deploy and trigger/verify the resource-limit path against the production worker before launch. |
| E-008 | P2 | Some graceful degradation exists and should be preserved. | LaTeXML failure publishes without HTML; section indexing falls back to metadata; Bluesky bridge failure is isolated around paper publish. | Add e2e tests for these degradation paths against real services. |

## F. Code Quality

| ID | Severity | Finding | Evidence | Required Fix / Verification |
| --- | --- | --- | --- | --- |
| F-001 | P1 | Fixed locally: ESLint now exits with 0 errors and 0 warnings. | Admin/smoke scripts have targeted `no-console` disables with reasons; `corepack.cmd pnpm lint` exits 0 cleanly. | Keep as CI gate. |
| F-002 | P1 | Root typecheck is now non-interactive and green. | `@astrojs/check` added to `apps/web`; `corepack.cmd pnpm typecheck` exits 0. | Keep as CI gate. |
| F-003 | P1 | Root tests fixed locally. | See P0-G-001. | Keep as CI gate. |
| F-004 | P2 | Strict TS flags are enabled and typecheck is green. | `corepack.cmd pnpm typecheck` exits 0. | Continue removing warnings/hints. |
| F-005 | P2 | Fixed locally: production `any` removed from `apps/{api,web}/src`. | `tests/no-explicit-any-source.test.ts` passes; `rg` only finds test/comment prose. | Keep the no-explicit-any regression test. |
| F-006 | P2 | Partially fixed locally: `ts-prune` runs via `pnpm dlx` against app package tsconfigs and confirmed dead exports were removed or wired. | Removed `sha256HexBytes`, `CrossListingsError`, `resetMetrics`, and `DOI_RATE_LIMIT_PER_SEC`; `snapshotMetrics` is now used by `/metrics`. Remaining candidate exports are either Astro/package-barrel false positives (`BriefResponse`, package exports) or deferred unwired feature services (`probeArtifact`, `makeDoiDepositService`, `makeOpenAlexClient`, `makeRorClient`). | Decide whether deferred feature services launch now; if not, move them to backlog or delete them with their tests/docs. |
| F-007 | P2 | Partially fixed locally: launch-policy constants now cover API body/upload limits, health probe windows, analytics refresh retention, worker retry/retention, Mastodon worker rate limit, and shared HTTP timeout/retry defaults. | `apps/api/src/constants/launch-policy.ts`, `packages/clients/src/http.ts`, and focused tests. Remaining candidates are lower-level domain limits in route/service modules. | Continue moving remaining domain-specific limits to constants as they are touched. |

## G. Tests

| ID | Severity | Finding | Evidence | Required Fix / Verification |
| --- | --- | --- | --- | --- |
| G-001 | P0 | Full local test suite fixed locally. | `corepack.cmd pnpm test` exits 0; duplicate web e2e spec removed from Vitest collection and web Vitest is configured to collect only `*.test.ts`. Bluesky live negative-path test now treats upstream `429` as acceptable only when the AT-proto JSON error shape is preserved; focused live test passes 5/5. Latest full counts: API 58 files / 418 passed + 1 skipped, clients 8 files / 32 passed, web 14 files / 71 passed. | Keep as CI gate. |
| G-002 | P0 | Required real production authenticated e2e cannot currently run to completion. | Existing live specs are credential-gated and production has no published paper/profile. | Provide test identities/session setup and production cleanup path. |
| G-003 | P1 | Existing production e2e has meaningful skips. | Latest anonymous/read-only production run: 12 passed, 8 skipped because no profile/published paper, no owned Bluesky app-password credentials, and no authenticated session were available. | Convert skips to required assertions after seeding/publishing a test artifact. |
| G-004 | P1 | Critical happy-path specs are mock-based. | `happy-path.spec.ts` and `profile-flow.spec.ts` explicitly use mock ORCID/mock compiler/dev callbacks. | Keep mock tests for fast CI, but add real prod Playwright jobs for F6. |
| G-005 | P2 | e2e TypeScript typecheck passes. | `pnpm --filter @openxiv/e2e typecheck` exited 0. | Keep as CI gate. |

## H. Observability

| ID | Severity | Finding | Evidence | Required Fix / Verification |
| --- | --- | --- | --- | --- |
| H-001 | P1 | `/admin/health` added locally, not yet deployed. | Route reports API/Postgres/Redis/MinIO/GROBID, queue depths, DLQ counts, and 24h saga success rates. | Verify admin auth and output after deploy. |
| H-002 | P1 | Public `/health`, `/health/ready`, `/healthz`, `/metrics`, and `/admin/health` are routed locally in Caddy configs. | `Caddyfile.production` API matcher includes health/metrics/admin health paths. | Verify after deploy. |
| H-003 | P1 | Pino request completion enrichment added locally. | `apps/api/src/server.ts` logs `request_id`, `user_did`, `duration_ms`, `status`, method, and path on response. | Verify log shape on VPS. |
| H-004 | P1 | Fixed locally: Prometheus text `/metrics` reports dependency health/latency, BullMQ job counts/DLQ, and 24h saga stage outcomes/rates. | `apps/api/src/routes/health.ts`, `server.ts` rate-limit allow-list, Caddy routing, and `src/routes/metrics.test.ts`; focused API route test passes. | Deploy and verify scrape from monitoring. |
| H-005 | P1 | Fixed locally for API/worker errors: Sentry is optional and gated by DSN plus DNT/GPC/notrack opt-out. Production still needs DSN and deploy verification. | `apps/api/src/services/error-tracking.ts`, API error handler, worker process handlers, env schema, and tests pass. | Set `SENTRY_DSN` only if desired, deploy, and verify one scrubbed non-PII test event. |
| H-006 | P2 | Existing `/healthz` is useful but not complete. | Production `/healthz` reported API deps: postgres, redis, s3, grobid, llm, atproto, jetstream. | Keep it, but add queue depths and 24h success rates to admin-only health. |

## Remaining Launch Acceptance Blockers

1. Rotate and remove exposed secrets/key material; replace production values from a real secret store.
2. Provide a working VPS credential so the local fixes can be pushed, rebuilt, restarted, and retested.
3. Provide dedicated ORCID/Bluesky/Mastodon test identities or live session cookies plus cleanup credentials.
4. Seed or publish a real disposable production paper/profile through real auth, then convert current production e2e skips into assertions.
5. Verify the locally fixed production hardening on the deployed site: headers on redirects/errors, feed public base, `/admin/health`, DLQ alerts, Sentry opt-in, real LaTeXML/detector, and GROBID outage fallback.
