# Citation, ORCID, Mastodon goal audit - 2026-05-19

Status: not complete. Cite is freshly live-verified. ORCID and Mastodon
implementation, retry, idempotency, UI, DLQ, and harnesses are present, but the
required real sandbox ORCID work push plus current combined Mastodon live run are
blocked by missing sandbox Member API credentials, a 3-legged sandbox access
token with `/activities/update`, and a linked Mastodon test account/token.

## Concrete acceptance criteria

1. `/p/<id>` has a Cite button with BibTeX, RIS, EndNote, APA 7, MLA 9,
   Chicago 17, and IEEE; copy and `.bib`/`.ris` download work.
2. BibTeX and RIS output parse without parser errors.
3. Publishing a test preprint pushes a work into ORCID sandbox, records a
   stable put-code, is idempotent on retry, and renders `Added to ORCID`.
4. Publishing a test preprint crossposts to a real Mastodon-compatible
   instance, is idempotent on retry, and renders `Crossposted to Mastodon`.
5. `/settings/identity` supports Mastodon link/unlink and ORCID works-push
   toggle.
6. ORCID and Mastodon final failures are recorded in DLQ. The Cite widget is
   synchronous API/UI functionality and has no async worker or DLQ surface.
7. Temporary test preprints and their storage/queue traces are removed after
   verification.

## Prompt-to-artifact checklist

| Requirement | Artifact | Evidence |
|---|---|---|
| Cite button on `/p/<id>` | `apps/web/src/pages/p/[...id].astro`, `apps/web/src/components/CiteButton.astro` | Page imports and renders `CiteButton`; component fetches `/api-proxy/papers/<id>/citation`, switches seven tabs, copies, and downloads `.bib`/`.ris`. |
| Citation generator service | `apps/api/src/services/citations.ts` | `generateCitation` covers `bibtex`, `ris`, `endnote`, `apa`, `mla`, `chicago`, and `ieee`. |
| Citation API route | `apps/api/src/routes/papers.ts` | `GET /papers/:id/citation` normalizes format, returns `text/plain`, and sets citation download filename. |
| Parser validation | `apps/api/src/services/citations.test.ts`, `e2e/tests/citations.spec.ts` | API unit tests passed; e2e spec parses BibTeX via `@retorquere/bibtex-parser` and RIS via Citation.js RIS plugin. |
| ORCID work XML + push | `apps/api/src/services/orcid-works.ts` | Builds ORCID work XML with preprint type, OpenXiv journal title, contributors, DOI/OpenXiv external IDs in the schema-compatible `common:external-ids` container, and POSTs to `/v3.0/{orcid}/work`. |
| ORCID OAuth update scope | `apps/api/src/routes/auth.ts` | ORCID link flow requests `/authenticate /activities/update` and stores scope/tokens/toggle. |
| ORCID DB columns | `packages/db/drizzle/0031_citations_orcid_mastodon.sql`, `0033_orcid_link_environment.sql` | Adds ORCID token/scope/toggle/environment columns and paper version put-code/status/error columns. |
| ORCID worker retry/idempotency | `apps/api/src/workers/orcid-push.ts`, `apps/api/src/workers/index.ts`, `apps/api/src/services/submissions.ts` | Worker skips if put-code exists; publish enqueue uses `socialPushJobOptions('orcid', versionId)` with 5 attempts and exponential backoff so final failures go to `worker:dlq:openxiv.orcid-push`; per-link `orcid_use_sandbox` overrides global ORCID mode for sandbox E2E without affecting other users. |
| ORCID UI | `apps/web/src/pages/p/[...id].astro`, `apps/web/src/pages/settings/identity.astro` | Paper page renders `Added to ORCID`; identity page renders ORCID works-push toggle. |
| ORCID works-push settings guard | `apps/api/src/services/account-linking.ts`, `apps/api/src/routes/account-linking.ts`, `apps/api/src/routes/account-linking.test.ts`, `apps/web/src/pages/settings/identity.astro` | `canEnableOrcidWorksPush` requires an ORCID access token plus `/activities/update` before enabling works push; `/me/links` exposes non-secret `orcidCanPushWorks`; `/settings/identity` disables the toggle for ineligible links while still allowing valid linked ORCID accounts to enable it; route regression verifies the ineligible enable path returns HTTP 400 and does not update storage. |
| ORCID real sandbox E2E | `e2e/tests/orcid-sandbox-live.spec.ts`, `e2e/tests/live-env.ts`, `docs/ops/orcid-sandbox-live-e2e.md` | Harness exists and auto-loads `.env.orcid-sandbox.local`; OpenXiv session is now valid, but live run exits before publication because sandbox ORCID access token/client/record values are still missing. Current project ORCID client is production-only and returns `invalid_client` on sandbox. |
| ORCID sandbox token capture | `scripts/orcid_sandbox_oauth.mjs` | Helper prints sandbox authorize URL, exchanges code for `/activities/update` token, writes ignored `.env.orcid-sandbox.local`, and checks the token against ORCID sandbox works. |
| ORCID sandbox env merge | `scripts/orcid_sandbox_oauth_env.mjs`, `scripts/orcid_sandbox_oauth_env.test.mjs` | Token refresh preserves local sandbox client/session fields while replacing old token fields, so `login` does not erase the values needed for the next live E2E step. |
| ORCID sandbox preflight | `scripts/orcid_sandbox_preflight.mjs`, `scripts/orcid_sandbox_preflight_lib.mjs`, `scripts/orcid_sandbox_preflight.test.mjs` | No-publish readiness check verifies env, OpenXiv session, seeded ORCID link row, works-push toggle, sandbox mode, `/activities/update`, and sandbox works-token readability before creating a test preprint. |
| ORCID sandbox link seed | `scripts/openxiv_seed_orcid_sandbox_link.mjs`, `.gitignore` | Helper reads `.env.orcid-sandbox.local` plus an authenticated OpenXiv session cookie and writes the account-link row with `orcid_use_sandbox=true`. It uploads the token payload as a temporary ignored `.orcid-sandbox-link-*.b64` file instead of embedding tokens in SSH command arguments. |
| Mastodon OAuth | `apps/api/src/routes/auth-mastodon.ts` | Arbitrary instance URL flow registers app, exchanges code, verifies credentials, and stores link. |
| Mastodon DB support | `packages/db/drizzle/0031_citations_orcid_mastodon.sql`, `0032_account_links_mastodon_check.sql` | Adds Mastodon token/instance/account URL columns and permits provider `mastodon`. |
| Mastodon worker | `apps/api/src/workers/mastodon-crosspost.ts`, `apps/api/src/services/mastodon-crosspost.ts` | Posts status, records status ID/URL, skips if already posted, and records errors. |
| Mastodon UI | `apps/web/src/pages/p/[...id].astro`, `apps/web/src/pages/settings/identity.astro` | Paper page renders `Crossposted to Mastodon`; identity page links/unlinks Mastodon. |
| Mastodon real E2E | `e2e/tests/social-crosspost-live.spec.ts` plus production smoke evidence | Harness exists, but the current final acceptance run cannot execute because `/me/links` has no Mastodon link and no `MASTODON_ACCESS_TOKEN` is present for status readback/cleanup. Treat any older Mastodon smoke notes as stale until the live spec is rerun with a real linked account. |
| Mastodon live preflight | `scripts/mastodon_live_preflight.mjs`, `scripts/mastodon_live_preflight_lib.mjs`, `scripts/mastodon_live_preflight.test.mjs` | No-publish readiness check verifies env, production base URL, authenticated OpenXiv session, linked Mastodon row, and read access to `/api/v1/accounts/verify_credentials` before creating a test preprint. |
| DLQ, retry, and rate limit classification | `apps/api/src/workers/index.ts`, `apps/api/src/services/social-push.test.ts` | `shouldRecordDeadLetter` covers ORCID and Mastodon social queues; Mastodon HTTP 429 is covered as a retriable worker failure, so BullMQ exponential backoff applies instead of terminal DLQ on first rate-limit response; `socialWorkerLimiter` applies the 300/5min limiter to `openxiv.mastodon-crosspost` and not to `openxiv.orcid-push`. |
| Social enqueue retry policy | `apps/api/src/services/submissions.ts`, `apps/api/src/services/submissions.test.ts` | `socialPushJobOptions` centralizes ORCID/Mastodon publish job IDs, 5 attempts, exponential 60s backoff, and failure retention; regression test covers both providers. |
| Cleanup | production DB/S3/Redis/BullMQ checks | Verified `papers=0`, `papers/` and `intake/` objects `0`, Redis intake keys `0`, relevant queues empty, and social DLQ lengths `0`. |

## Fresh verification commands

```powershell
pnpm --filter @openxiv/api typecheck
pnpm --filter @openxiv/api build
pnpm --filter @openxiv/api test -- src/routes/auth-mastodon.test.ts src/services/citations.test.ts src/services/social-push.test.ts src/services/account-linking.test.ts
pnpm --filter @openxiv/web build
pnpm --filter @openxiv/e2e typecheck
pnpm --filter @openxiv/e2e test -- tests/orcid-sandbox-live.spec.ts
pnpm --filter @openxiv/e2e test -- tests/social-crosspost-live.spec.ts
node --check scripts/orcid_sandbox_oauth.mjs
node --check scripts/orcid_sandbox_oauth_env.mjs
node --test scripts/orcid_sandbox_oauth_env.test.mjs
node --check scripts/orcid_sandbox_preflight.mjs
node --check scripts/orcid_sandbox_preflight_lib.mjs
node --test scripts/orcid_sandbox_preflight.test.mjs
node --check scripts/mastodon_live_preflight.mjs
node --check scripts/mastodon_live_preflight_lib.mjs
node --test scripts/mastodon_live_preflight.test.mjs
node scripts/orcid_sandbox_oauth.mjs help
node --check scripts/openxiv_seed_orcid_sandbox_link.mjs
```

Results from this audit pass:

- API typecheck: exit 0.
- API build: exit 0.
- API tests: 4 files, 18 tests passed.
- Web build: exit 0.
- E2E typecheck: exit 0.
- ORCID live harness: 1 skipped because live sandbox credentials/session are
  not present.
- ORCID+Mastodon live harness: 1 skipped because live external credentials are
  not present.
- Citation E2E harness hardened after resumed audit: `E2E_CITATION_LIVE=1`
  now fails if no published production sample or `E2E_SAMPLE_ABS_ID` is
  available, instead of silently skipping a deliberate live acceptance run.
  Fresh production run without the live flag skipped because production is
  empty after cleanup; fresh production run with `E2E_CITATION_LIVE=1` failed
  with `live citation e2e requires a published paper or E2E_SAMPLE_ABS_ID`.
  A default local run hit an unrelated stale `localhost:4321` dev stack whose
  local database lacked the `orcid_put_code` column, so citation live evidence
  must set `E2E_BASE_URL=https://openxiv.net` or use a freshly migrated local
  stack.
- Citation live acceptance rerun completed after seeding a temporary production
  published row `physics.gen-ph.2026.91041`: `E2E_BASE_URL=https://openxiv.net
  E2E_CITATION_LIVE=1 E2E_SAMPLE_ABS_ID=physics.gen-ph.2026.91041 pnpm
  --filter @openxiv/e2e test -- tests/citations.spec.ts` passed 2/2. This
  covered all seven formats, BibTeX/RIS parser validation, modal switching,
  copy, and `.bib`/`.ris` downloads. The temporary paper was deleted in
  `finally`.
- Live E2E guard added: ORCID, combined social, and citation live specs now
  require `E2E_BASE_URL=https://openxiv.net` when their live flags are set, so
  they cannot accidentally run against a stale local Astro dev server.
  Verification: ORCID live spec with `E2E_ORCID_LIVE=1` and no base URL fails
  on the production-base guard; with `E2E_BASE_URL=https://openxiv.net`, it
  passes that guard and fails on the expected missing `E2E_OPENXIV_SESSION_COOKIE`.
  `.env.orcid-sandbox.local.example` includes `E2E_BASE_URL=https://openxiv.net`.
- Fresh resumed audit on 2026-05-19 repeated the same local gates: API
  typecheck exit 0, API build exit 0, API tests 4 files/18 tests passed, web
  build exit 0, E2E typecheck exit 0, ORCID live harness 1 skipped without live
  inputs, and combined ORCID/Mastodon live harness 1 skipped without live
  inputs.
- ORCID live harness with `E2E_ORCID_LIVE=1` and no credentials: exits 1 with
  `E2E_OPENXIV_SESSION_COOKIE is required`, so live mode cannot silently skip
  missing acceptance inputs.
- ORCID sandbox OAuth helper: syntax check and help command exit 0.
- ORCID sandbox env merge helper: RED check first failed with
  `ERR_MODULE_NOT_FOUND` for `scripts/orcid_sandbox_oauth_env.mjs`; after
  implementation, `node --test scripts/orcid_sandbox_oauth_env.test.mjs`
  passed 1/1 and syntax checks for both ORCID sandbox helper modules exit 0.
  `node scripts/orcid_sandbox_oauth.mjs help` still exits 0, and `authorize`
  with only a production `ORCID_CLIENT_ID` still exits 1 with
  `missing ORCID_SANDBOX_CLIENT_ID or --client-id`.
- ORCID sandbox preflight helper: RED check first failed with
  `ERR_MODULE_NOT_FOUND` for `scripts/orcid_sandbox_preflight_lib.mjs`; after
  implementation, `node --test scripts/orcid_sandbox_preflight.test.mjs`
  passed 3/3 and syntax checks for both preflight modules exit 0. Current
  no-publish preflight run exits 1 before any publication and reports the
  expected missing sandbox client, token, ORCID, OpenXiv session, SSH cleanup,
  `/activities/update`, and production base URL inputs.
- ORCID sandbox runbook now includes a concrete OpenXiv session-cookie capture
  and validation step: copy `openxiv_session` from the production browser
  session, set `E2E_OPENXIV_SESSION_COOKIE` as a Cookie header fragment, and
  verify `https://openxiv.net/api-proxy/auth/me` returns
  `"authenticated":true` before seeding the sandbox ORCID link.
- `.env.orcid-sandbox.local.example` now quotes
  `ORCID_SANDBOX_SCOPE="/authenticate /activities/update"` because the value
  contains a space. `scripts/orcid_sandbox_oauth_env.test.mjs` asserts the
  helper writes the quoted scope, and the helper/preflight script checks pass
  4/4.
- ORCID sandbox runbook now clarifies shell-vs-file credential handling: if the
  login, seed, preflight, and live tests do not run in the same shell, put the
  sandbox client credentials and OpenXiv session cookie into the ignored
  `.env.orcid-sandbox.local`; the OAuth helper preserves those non-token fields
  while refreshing token values.
- Cleaned a stale local Playwright citation-test artifact after a hung
  `playwright test "tests/citations.spec.ts"` process left
  `e2e/test-results/.playwright-artifacts-1` locked by `ffmpeg`. The targeted
  test/ffmpeg processes were stopped, `e2e/test-results` was removed, and no
  `.orcid-sandbox-link-*.b64` payload files remain.
- OpenXiv production session cookie unblock: signed in through the real
  Bluesky OAuth flow for the ddavidich test account, stored the resulting
  `openxiv_session` Cookie-header fragment in ignored
  `.env.orcid-sandbox.local`, and verified
  `https://openxiv.net/api-proxy/auth/me` returns `"authenticated":true` for
  user `1c9f5f1a-ca59-4e87-8413-ad12754d3be2` / DID
  `did:plc:dzhzljg4peg765tpd2q63luc`. Browser artifacts were deleted and
  `playwright-cli list` reports no open browsers.
- With `OPENXIV_HOST`, `OPENXIV_USER`, and `OPENXIV_PASSWORD` supplied from
  the shell, `node scripts/orcid_sandbox_preflight.mjs` now fails only on the
  remaining ORCID sandbox inputs: `ORCID_SANDBOX_CLIENT_ID`,
  `ORCID_SANDBOX_CLIENT_SECRET`, `ORCID_SANDBOX_ACCESS_TOKEN`, and
  `ORCID_SANDBOX_ORCID`.
- ORCID sandbox OAuth helper hardened after resumed audit: it now refuses to
  use a production `ORCID_CLIENT_ID` against sandbox unless sandbox credentials
  are explicitly provided. `node --check scripts/orcid_sandbox_oauth.mjs` and
  `node scripts/orcid_sandbox_oauth.mjs help` exit 0; `authorize` without
  sandbox credentials exits 1 with a missing sandbox client message.
- ORCID sandbox runbook updated to state that the helper requires
  `ORCID_SANDBOX_CLIENT_ID`/`ORCID_SANDBOX_CLIENT_SECRET` or explicit
  `--client-id`/`--client-secret`; the production ORCID client is not a sandbox
  fallback.
- ORCID sandbox runbook now also documents the combined
  `tests/social-crosspost-live.spec.ts` run with `E2E_BASE_URL=https://openxiv.net`,
  `E2E_SOCIAL_LIVE=1`, and `MASTODON_ACCESS_TOKEN`, covering the ORCID +
  Mastodon publish path.
- Added `.env.orcid-sandbox.local.example` with placeholder-only sandbox
  client/token/session variables so the real `.env.orcid-sandbox.local` can be
  created without committing secrets.
- ORCID sandbox link seed helper: syntax check exit 0.
- `.orcid-sandbox-link-*.b64` is ignored so interrupted local seed attempts
  do not leave token payloads as untracked files.
- E2E live specs auto-load `.env.orcid-sandbox.local` via
  `e2e/tests/live-env.ts`; explicit shell env still takes precedence.
- ORCID per-link environment test: `src/services/social-push.test.ts` passes,
  including `orcidLinkUsesSandbox`.
- Deployed per-link ORCID environment patch to production API and worker.
  Production health returned `status=ok`, DB has `orcid_use_sandbox_column|1`,
  and deployed helper returned `helper|true|false|true`.
- Latest production snapshot after helper hardening: health `status=ok`,
  `papers|0`, `mastodon_links|0`, `orcid_sandbox_links|0`, all relevant queues
  empty, and social DLQs length `0`.
- Fresh production snapshot on 2026-05-19T06:14Z: health `status=ok`;
  ORCID client is configured, `ORCID_USE_SANDBOX=false`, no sandbox ORCID
  client is configured; `orcid_use_sandbox_column|1`, `papers|0`,
  `mastodon_links|0`, `orcid_sandbox_links|0`; all relevant BullMQ queues and
  social DLQs are empty.
- Fresh input search on 2026-05-19: local `.env.orcid-sandbox.local` and
  `e2e/.env.orcid-sandbox.local` are missing; local shell has no
  `ORCID_SANDBOX_CLIENT_ID`, `ORCID_SANDBOX_CLIENT_SECRET`,
  `ORCID_SANDBOX_ACCESS_TOKEN`, `ORCID_SANDBOX_ORCID`, or
  `E2E_OPENXIV_SESSION_COOKIE`; the production API container also has none of
  those variables.
- ORCID XML compatibility fix on 2026-05-19: `apps/api/src/services/orcid-works.ts`
  now emits `common:external-ids` instead of `work:external-ids`. RED check:
  focused `src/services/social-push.test.ts` failed while the payload still
  contained `work:external-ids`. GREEN checks: `pnpm --filter @openxiv/api exec
  vitest run src/services/social-push.test.ts --pool=threads
  --poolOptions.threads.singleThread=true` passed 6/6, and the focused API suite
  `src/routes/auth-mastodon.test.ts src/services/citations.test.ts
  src/services/social-push.test.ts src/services/account-linking.test.ts` passed
  18/18.
- Deployed the ORCID XML fix to the production worker on 2026-05-19. Remote
  source grep shows only `<common:external-ids>` / `</common:external-ids>`;
  worker dist grep shows the same at `/app/apps/api/dist/services/orcid-works.js`.
  `docker compose ... build worker` and `docker compose ... up -d worker`
  completed, `openxiv-worker-1` restarted, and production `/healthz` returned
  `status=ok` externally and inside the Docker network.
- Current local full API typecheck/build after the XML fix is not cleanly
  rerunnable because unrelated local `apps/api/src/services/moderation*.ts`
  files fail typecheck. Those files are outside this goal and are not present
  in the production tree used for the worker build, which passed.
- Fresh ORCID real-mode harness run after the worker deploy:
  `E2E_BASE_URL=https://openxiv.net E2E_ORCID_LIVE=1 pnpm --filter
  @openxiv/e2e test -- tests/orcid-sandbox-live.spec.ts` exits 1 at the input
  gate with `E2E_OPENXIV_SESSION_COOKIE is required`. A same-turn env scan also
  reports missing `ORCID_SANDBOX_CLIENT_ID`, `ORCID_SANDBOX_CLIENT_SECRET`,
  `ORCID_SANDBOX_ACCESS_TOKEN`, and `ORCID_SANDBOX_ORCID`, so the missing
  acceptance evidence is credentials/session, not a hidden passing test.
- Current completion audit refresh: targeted API suite
  `src/services/social-push.test.ts src/services/citations.test.ts
  src/routes/auth-mastodon.test.ts src/services/account-linking.test.ts`
  passed 19/19; `pnpm --filter @openxiv/e2e typecheck` passed; ORCID sandbox
  helper checks passed (`node --test scripts/orcid_sandbox_oauth_env.test.mjs`,
  `node --check scripts/orcid_sandbox_oauth.mjs`,
  `node --check scripts/orcid_sandbox_oauth_env.mjs`,
  `node --check scripts/openxiv_seed_orcid_sandbox_link.mjs`). A fresh
  production snapshot initially found one leftover citation E2E paper
  `OpenXiv Citation Live E2E Cafe Metadata Fields`; it was identified as test
  data and removed by exact paper id. Post-cleanup production health is
  `status=ok`.
- Mastodon rate-limit regression audit: added a focused check that
  `Errors.externalInvalidResponse('mastodon.status.post', Error('Mastodon status
  429...'))` remains a retriable worker failure and is not wrapped as
  `UnrecoverableError`. `tsc -p apps/api/tsconfig.json --noEmit` passed after
  exporting the classification helper, `src/services/social-push.test.ts`
  passed 7/7, and the focused social/citation/linking/Mastodon API suite now
  passes 19/19.
- Fresh build gates after the rate-limit regression change: `pnpm --filter
  @openxiv/api build` exits 0 and `pnpm --filter @openxiv/web build` exits 0.
- Deployed the worker retry-classification export to production worker after
  the regression check. Remote source grep shows
  `export function rethrowForBullMQ`; worker dist grep shows
  `export function rethrowForBullMQ(err)`. `docker compose ... build worker`
  and `docker compose ... up -d worker` completed, worker logs show
  `[workers] started`, production health is `status=ok`, `papers|0`,
  `citation_e2e|0`, social links are `0`, all relevant queue states are `0`,
  and both ORCID/Mastodon DLQs are `0`.
- Mastodon rate-limit placement bug fixed: the 300/5min limiter had been
  attached to the ORCID worker instead of the Mastodon worker. Added
  `socialWorkerLimiter` and a regression asserting
  `QUEUE_NAMES.mastodonCrosspost` receives `MASTODON_CROSSPOST_RATE_LIMIT`
  while `QUEUE_NAMES.orcidPush` receives no Mastodon limiter. Verification:
  API `tsc --noEmit` passed, `src/services/social-push.test.ts` passed 8/8,
  the focused API suite passed 20/20, and `pnpm --filter @openxiv/api build`
  passed.
- Deployed the Mastodon limiter placement fix to production worker. Worker dist
  grep shows `socialWorkerLimiter(queueName)` and
  `limiter: socialWorkerLimiter(QUEUE_NAMES.mastodonCrosspost)`, production
  health is `status=ok`, `papers|0`, `citation_e2e|0`,
  `mastodon_links|0`, `orcid_sandbox_links|0`, all relevant queue states are
  `0`, and both ORCID/Mastodon DLQs are `0`.
- Latest no-publish ORCID sandbox preflight with VPS env set exits 1 before
  creating any paper and now reports only the true remaining ORCID inputs:
  missing `ORCID_SANDBOX_CLIENT_ID`, `ORCID_SANDBOX_CLIENT_SECRET`,
  `ORCID_SANDBOX_ACCESS_TOKEN`, and `ORCID_SANDBOX_ORCID`.
- Added Mastodon live preflight by TDD: RED failed with `ERR_MODULE_NOT_FOUND`
  for `scripts/mastodon_live_preflight_lib.mjs`; after implementation,
  `node --test scripts/mastodon_live_preflight.test.mjs` passed 3/3 and syntax
  checks for both Mastodon preflight modules exit 0. With VPS env set and the
  current ignored env file, the preflight exits before publication with missing
  `MASTODON_ACCESS_TOKEN`; with a dummy token, it reaches the next real blocker,
  `OpenXiv user is not linked to a Mastodon account`.
- Repository search found no Twitter/X crosspost implementation, worker, route,
  DB status field, or `Crossposted to Twitter` badge. The objective's literal
  `Crossposted to Bluesky/Twitter/Mastodon` wording is therefore not fully
  covered by current artifacts; only Bluesky and Mastodon have real crosspost
  status surfaces. Existing Twitter code is Twitter Pixel / card metadata, not
  crossposting.
- Fresh production schema check confirms the same gap: `paper_versions` has
  `bsky_post_uri`, `bsky_post_cid`, `mastodon_status_id`,
  `mastodon_status_url`, and ORCID push fields, while `account_links` has
  Mastodon and ORCID token/settings fields; neither table has `twitter` or
  `tweet` columns. A source search finds only Twitter Pixel and Twitter card
  metadata, not a Twitter/X status-posting service.
- Fresh current-state audit after the latest resume: ORCID sandbox preflight
  with VPS env stops before publishing and reports only the missing live ORCID
  inputs `ORCID_SANDBOX_CLIENT_ID`, `ORCID_SANDBOX_CLIENT_SECRET`,
  `ORCID_SANDBOX_ACCESS_TOKEN`, and `ORCID_SANDBOX_ORCID`. Mastodon live
  preflight with VPS env stops before publishing and reports missing
  `MASTODON_ACCESS_TOKEN`; with a dummy token it reports the next blocker,
  `OpenXiv user is not linked to a Mastodon account`. Targeted API tests passed
  20/20, ORCID/Mastodon helper tests passed 7/7, API typecheck passed, E2E
  typecheck passed, API build passed, and web build passed. `astro check`
  is not used as a gate in this checkout because it prompts to install
  `@astrojs/check`; `astro build` is the non-interactive web gate. Production
  health is `status=ok`, the running services are up, `papers|0`,
  `citation_e2e|0`, `mastodon_links|0`, `orcid_sandbox_links|0`, all relevant
  queue states are `0`, and both ORCID/Mastodon DLQs are `0`.
- The ignored `.env.orcid-sandbox.local` file currently has the ORCID sandbox
  key names present, but the client ID, client secret, ORCID iD, and access
  token values are blank. The OpenXiv session cookie and
  `/authenticate /activities/update` scope are present, so the remaining
  blocker is not local env-file wiring.
- Fresh combined social live guard: `E2E_BASE_URL=https://openxiv.net
  E2E_SOCIAL_LIVE=1 pnpm --filter @openxiv/e2e test --
  tests/social-crosspost-live.spec.ts` exits 1 before publishing with
  `ORCID_SANDBOX_ACCESS_TOKEN is required to verify and clean up the ORCID
  work`. The generated Playwright `e2e/test-results` directory was removed;
  a follow-up production DB check still reports `papers|0`,
  `mastodon_links|0`, and `orcid_sandbox_links|0`.
- Added a social enqueue regression around retry/DLQ policy:
  `socialPushJobOptions('orcid'|'mastodon', versionId)` now centralizes the
  existing 5-attempt exponential backoff publish job options and idempotent job
  IDs. TDD red check first failed with `socialPushJobOptions is not a
  function`; after the extraction, `src/services/submissions.test.ts` passed
  4/4, API typecheck passed, the focused API suite passed 24/24, and API build
  passed locally.
- Deployed the `submissions.ts` retry-policy extraction to production API.
  The first remote API build exposed a stale VPS source tree where
  `apps/api/src/services/submissions.ts` imported `./moderation.js` but
  `apps/api/src/services/moderation.ts` was missing. Uploading the local
  `moderation.ts` restored the source dependency, and the repeated
  `docker compose ... build api && docker compose ... up -d api` completed.
  Container dist grep shows `socialPushJobOptions` in
  `/app/apps/api/dist/services/submissions.js`; production health is
  `status=ok`, the API container was recreated, `papers|0`,
  `citation_e2e|0`, `mastodon_links|0`, `orcid_sandbox_links|0`, all relevant
  ORCID/Mastodon queue states are `0`, and both ORCID/Mastodon DLQs are `0`.
- Fresh no-publish preflight refresh after the API redeploy: ORCID sandbox
  helper tests plus Mastodon live preflight tests passed 7/7. With VPS env,
  `node scripts/orcid_sandbox_preflight.mjs` still exits before publication on
  missing `ORCID_SANDBOX_CLIENT_ID`, `ORCID_SANDBOX_CLIENT_SECRET`,
  `ORCID_SANDBOX_ACCESS_TOKEN`, and `ORCID_SANDBOX_ORCID`.
  `node scripts/mastodon_live_preflight.mjs` exits before publication on
  missing `MASTODON_ACCESS_TOKEN`; with a dummy token it reaches the next real
  blocker, `OpenXiv user is not linked to a Mastodon account`. The live E2E
  runbook now documents the Mastodon link flow and both no-publish preflights
  before the combined ORCID + Mastodon publish test.
- Hardened ORCID works-push settings: TDD red check first failed with
  `canEnableOrcidWorksPush is not a function`. After adding the helper and
  route/UI guard, `src/services/account-linking.test.ts` passed 8/8, API
  typecheck passed, focused API suite passed 25/25, API build passed, and web
  build passed. Deployed API and web; production dist grep shows
  `canEnableOrcidWorksPush`, `orcidCanPushWorks`, and
  `missing_orcid_update_scope`. Real session verification against production
  returns `orcidCanPushWorks=false` for the current ORCID row, renders
  `/settings/identity` with the ORCID push toggle disabled, and direct PATCH
  `worksPushEnabled=true` returns HTTP 400
  `missing_orcid_update_scope` while leaving `orcidWorksPushEnabled=false`.
  Post-check cleanup remains clean: no local `e2e/test-results`,
  `.playwright-cli`, or `.orcid-sandbox-link-*.b64`; Playwright has no open
  browsers; production DB still reports `papers|0`, `mastodon_links|0`, and
  `orcid_sandbox_links|0`.
- Production ORCID link authorize URL check: calling
  `https://openxiv.net/api-proxy/auth/orcid/login?intent=link&redirect_after=/settings/identity`
  with the current OpenXiv session returns HTTP 200 and an `orcid.org`
  authorize URL whose `scope` query value is exactly
  `/authenticate /activities/update`, with redirect URI
  `https://openxiv.net/auth/orcid/callback`.
- Production Mastodon link-start check: posting the current OpenXiv session to
  `https://openxiv.net/api-proxy/auth/mastodon/start` with
  `instanceUrl=mastodon.social` returns HTTP 200 and a real
  `mastodon.social/oauth/authorize` URL with `scope=read:accounts
  write:statuses`, `response_type=code`, a nonempty state, and redirect URI
  `https://openxiv.net/api-proxy/auth/mastodon/callback`. This verifies the
  per-instance OAuth start flow without creating a preprint or requiring a
  Mastodon login. Follow-up health is `status=ok`; production DB still reports
  `papers|0`, `mastodon_links|0`, and `orcid_sandbox_links|0`; no local
  Playwright artifacts were created.
- Added ORCID upstream retry regression coverage: `src/services/social-push.test.ts`
  now asserts that an `orcid.work.push` 503 is rethrown as a retriable worker
  error and not `UnrecoverableError`, matching the ORCID-down retry requirement.
  The new check passed immediately against existing runtime behavior, so no
  production code change was needed. Verification: `src/services/social-push.test.ts`
  passed 9/9, the focused API suite passed 26/26, and API typecheck passed.
- Added route-level ORCID works-push guard regression coverage:
  `src/routes/account-linking.test.ts` injects an authenticated session and an
  ORCID link without token/scope, then verifies `PATCH /me/links/orcid/settings`
  returns HTTP 400 `missing_orcid_update_scope` and does not call the repo
  update path. A first typecheck caught the test fixture using an incomplete
  session payload; the fixture now uses the real `SessionPayload` shape. Fresh
  verification passed: focused API suite 6 files/32 tests and API typecheck.
- Citation parser package audit: the live E2E currently validates BibTeX with
  `@retorquere/bibtex-parser` and RIS with Citation.js `@citation-js/plugin-ris`.
  The prompt named `@bibtex/parser` and `ris-parser`, but fresh npm registry
  checks on 2026-05-19 returned 404 for both package names. No parser package
  swap was made because those exact npm package names are unavailable; the
  acceptance evidence remains parser-valid BibTeX/RIS with the installed
  parsers plus prior production citation E2E.

Production cleanup evidence after smokes:

```text
papers|0
citation_e2e|0
paper_versions_orphans|0
paper_authors_orphans|0
paper_keywords_orphans|0
mastodon_links|0
orcid_update_links|0
counter|physics.gen-ph|2026|1
papers/|0
intake/|0
redis_intake_keys|0
openxiv.compile|{"waiting":0,"active":0,"delayed":0,"failed":0,"completed":0,"paused":0}
openxiv.pdf-finalize|{"waiting":0,"active":0,"delayed":0,"failed":0,"completed":0,"paused":0}
openxiv.orcid-push|{"waiting":0,"active":0,"delayed":0,"failed":0,"completed":0,"paused":0}
openxiv.mastodon-crosspost|{"waiting":0,"active":0,"delayed":0,"failed":0,"completed":0,"paused":0}
openxiv.pdf-figures|{"waiting":0,"active":0,"delayed":0,"failed":0,"completed":0,"paused":0}
worker:dlq:openxiv.orcid-push|0
worker:dlq:openxiv.mastodon-crosspost|0
```

Post-deploy queue evidence:

```text
openxiv.compile|{"waiting":0,"active":0,"delayed":0,"failed":0,"completed":0,"paused":0}
openxiv.pdf-finalize|{"waiting":0,"active":0,"delayed":0,"failed":0,"completed":0,"paused":0}
openxiv.orcid-push|{"waiting":0,"active":0,"delayed":0,"failed":0,"completed":0,"paused":0}
openxiv.mastodon-crosspost|{"waiting":0,"active":0,"delayed":0,"failed":0,"completed":0,"paused":0}
openxiv.pdf-figures|{"waiting":0,"active":0,"delayed":0,"failed":0,"completed":0,"paused":0}
worker:dlq:openxiv.orcid-push|0
worker:dlq:openxiv.mastodon-crosspost|0
```

Post-ORCID-XML-fix deploy evidence:

```text
source: apps/api/src/services/orcid-works.ts
151:  <common:external-ids>
153:  </common:external-ids>

dist: /app/apps/api/dist/services/orcid-works.js
101:  <common:external-ids>
103:  </common:external-ids>

worker-1  | [entrypoint] starting worker
worker-1  | [workers] started - listening on BullMQ queues
health: {"status":"ok","service":"openxiv-api"}
papers|0
citation_e2e|0
mastodon_links|0
orcid_sandbox_links|0
openxiv.compile:wait|0
openxiv.compile:active|0
openxiv.compile:delayed|0
openxiv.compile:failed|0
openxiv.compile:completed|0
openxiv.pdf-finalize:wait|0
openxiv.pdf-finalize:active|0
openxiv.pdf-finalize:delayed|0
openxiv.pdf-finalize:failed|0
openxiv.pdf-finalize:completed|0
openxiv.orcid-push:wait|0
openxiv.orcid-push:active|0
openxiv.orcid-push:delayed|0
openxiv.orcid-push:failed|0
openxiv.orcid-push:completed|0
openxiv.mastodon-crosspost:wait|0
openxiv.mastodon-crosspost:active|0
openxiv.mastodon-crosspost:delayed|0
openxiv.mastodon-crosspost:failed|0
openxiv.mastodon-crosspost:completed|0
openxiv.pdf-figures:wait|0
openxiv.pdf-figures:active|0
openxiv.pdf-figures:delayed|0
openxiv.pdf-figures:failed|0
openxiv.pdf-figures:completed|0
```

Current post-cleanup production evidence:

```text
health: {"status":"ok","service":"openxiv-api"}
papers|0
citation_e2e|0
counter|physics.gen-ph|2026|1
versions_for_deleted|0
papers_prefix|0
openxiv.compile:wait|0
openxiv.compile:active|0
openxiv.compile:delayed|0
openxiv.compile:failed|0
openxiv.compile:completed|0
openxiv.pdf-finalize:wait|0
openxiv.pdf-finalize:active|0
openxiv.pdf-finalize:delayed|0
openxiv.pdf-finalize:failed|0
openxiv.pdf-finalize:completed|0
openxiv.orcid-push:wait|0
openxiv.orcid-push:active|0
openxiv.orcid-push:delayed|0
openxiv.orcid-push:failed|0
openxiv.orcid-push:completed|0
openxiv.mastodon-crosspost:wait|0
openxiv.mastodon-crosspost:active|0
openxiv.mastodon-crosspost:delayed|0
openxiv.mastodon-crosspost:failed|0
openxiv.mastodon-crosspost:completed|0
openxiv.pdf-figures:wait|0
openxiv.pdf-figures:active|0
openxiv.pdf-figures:delayed|0
openxiv.pdf-figures:failed|0
openxiv.pdf-figures:completed|0
```

## Current-turn verification - 2026-05-19

Fresh local checks from `D:\OpenXiv`:

```text
git status --short
fatal: not a git repository (or any of the parent directories): .git

corepack.cmd pnpm --filter @openxiv/api typecheck
exit 0

corepack.cmd pnpm --filter @openxiv/api build
exit 0

corepack.cmd pnpm --filter @openxiv/api test -- src/routes/auth-mastodon.test.ts src/services/citations.test.ts src/services/social-push.test.ts src/services/account-linking.test.ts
4 files passed, 20 tests passed

corepack.cmd pnpm --filter @openxiv/api test -- src/services/submissions.test.ts
1 file passed, 4 tests passed

pnpm --filter @openxiv/api test -- src/routes/account-linking.test.ts src/services/social-push.test.ts src/services/account-linking.test.ts src/services/submissions.test.ts src/services/citations.test.ts src/routes/auth-mastodon.test.ts
6 files passed, 32 tests passed

pnpm --filter @openxiv/api typecheck
exit 0

node --test scripts\orcid_sandbox_oauth_env.test.mjs scripts\orcid_sandbox_preflight.test.mjs scripts\mastodon_live_preflight.test.mjs
7 tests passed

corepack.cmd pnpm --filter @openxiv/web build
exit 0

corepack.cmd pnpm --filter @openxiv/e2e typecheck
exit 0

node --check scripts\mastodon_live_preflight.mjs
node --check scripts\mastodon_live_preflight_lib.mjs
node --check scripts\orcid_sandbox_preflight.mjs
node --check scripts\orcid_sandbox_preflight_lib.mjs
node --check scripts\openxiv_seed_orcid_sandbox_link.mjs
all exit 0
```

Post-route-test no-publish sanity:

```text
local Test-Path e2e\test-results: False
local Test-Path e2e\playwright-report: False
local Test-Path .playwright-cli: False
local .orcid-sandbox-link-*.b64 files: none

https://openxiv.net/healthz
status=ok; postgres=up; redis=up; s3=up; grobid=up

production DB:
papers|0
citation_e2e|0
mastodon_links|0
orcid_sandbox_links|0
orcid_update_links|0
paper_versions_orphans|0

production queues/DLQ:
openxiv.compile wait/active/delayed/failed/completed/paused all 0
openxiv.pdf-finalize wait/active/delayed/failed/completed/paused all 0
openxiv.orcid-push wait/active/delayed/failed/completed/paused all 0
openxiv.mastodon-crosspost wait/active/delayed/failed/completed/paused all 0
openxiv.pdf-figures wait/active/delayed/failed/completed/paused all 0
worker:dlq:openxiv.orcid-push|0
worker:dlq:openxiv.mastodon-crosspost|0
```

Current ignored `.env.orcid-sandbox.local` readiness without printing secrets:

```text
ORCID_SANDBOX_CLIENT_ID|present=True|nonempty=False
ORCID_SANDBOX_CLIENT_SECRET|present=True|nonempty=False
ORCID_SANDBOX_ACCESS_TOKEN|present=True|nonempty=False
ORCID_SANDBOX_ORCID|present=True|nonempty=False
ORCID_SANDBOX_SCOPE|present=True|nonempty=True
E2E_BASE_URL|present=True|nonempty=True
E2E_OPENXIV_SESSION_COOKIE|present=True|nonempty=True
MASTODON_ACCESS_TOKEN|present=False|nonempty=False
```

No-publish readiness scripts currently stop before creating a test preprint:

```text
node scripts\orcid_sandbox_preflight.mjs
orcid sandbox preflight: missing or invalid ORCID sandbox live inputs:
- missing ORCID_SANDBOX_CLIENT_ID
- missing ORCID_SANDBOX_CLIENT_SECRET
- missing ORCID_SANDBOX_ACCESS_TOKEN
- missing ORCID_SANDBOX_ORCID
- missing OPENXIV_HOST
- missing OPENXIV_USER
- missing OPENXIV_PASSWORD or OPENXIV_KEYFILE

node scripts\mastodon_live_preflight.mjs
mastodon live preflight: missing or invalid Mastodon live inputs:
- missing MASTODON_ACCESS_TOKEN
- missing OPENXIV_HOST
- missing OPENXIV_USER
- missing OPENXIV_PASSWORD or OPENXIV_KEYFILE
```

The two real Playwright live specs were also run with their live flags. Both
stop before publication because `ORCID_SANDBOX_ACCESS_TOKEN` is blank:

```text
$env:E2E_BASE_URL='https://openxiv.net'; $env:E2E_ORCID_LIVE='1'; corepack.cmd pnpm --filter @openxiv/e2e test -- tests/orcid-sandbox-live.spec.ts
1 failed before publish:
ORCID_SANDBOX_ACCESS_TOKEN is required to verify and clean up the ORCID work

$env:E2E_BASE_URL='https://openxiv.net'; $env:E2E_SOCIAL_LIVE='1'; corepack.cmd pnpm --filter @openxiv/e2e test -- tests/social-crosspost-live.spec.ts
1 failed before publish:
ORCID_SANDBOX_ACCESS_TOKEN is required to verify and clean up the ORCID work
```

The generated `e2e\test-results` directory was removed after these guarded
failures; `e2e\test-results` and `e2e\playwright-report` both currently return
`False` from `Test-Path`.

## Mastodon connection UX hardening - 2026-05-19

User request: make Mastodon connection easy for all users, starting from
`https://mastodon.social/@ddavidich`.

Implemented:

- `apps/api/src/services/mastodon-crosspost.ts` now normalizes Mastodon identity
  input from bare instances, profile URLs, `@user@instance`, `user@instance`,
  and `acct:user@instance`, clearing URL userinfo before OAuth registration.
- `apps/api/src/routes/auth-mastodon.test.ts` now covers those input forms.
  TDD red check failed first for `@ddavidich@mastodon.social`,
  `ddavidich@mastodon.social`, and `acct:ddavidich@mastodon.social`; after the
  parser change the focused test passed.
- `apps/web/src/pages/settings/identity.astro` now presents the Mastodon link
  form as a single account/profile input with placeholder
  `https://mastodon.social/@name`, a `Continue` button, pending status, and a
  visible retryable error instead of silently re-enabling the button.
- The linked Mastodon state now displays the linked account subject, for
  example `@user@instance`, instead of only the instance URL when that subject
  is available from `/api/me/links`.

Fresh local checks:

```text
corepack.cmd pnpm --filter @openxiv/api test -- src/routes/auth-mastodon.test.ts
red before implementation: 3 failed input-normalization cases

corepack.cmd pnpm --filter @openxiv/api test -- src/routes/auth-mastodon.test.ts src/services/social-push.test.ts
2 files passed, 15 tests passed

corepack.cmd pnpm --filter @openxiv/api typecheck
exit 0

corepack.cmd pnpm --filter @openxiv/api build
exit 0

corepack.cmd pnpm --filter @openxiv/web build
exit 0
```

Production deploy:

```text
docker compose -f docker-compose.yml -f docker-compose.production.yml build api worker web
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d api worker web
api, worker, and web images built; api, worker, and web containers recreated

https://openxiv.net/healthz
status=ok

docker compose ... ps api worker web
openxiv-api-1 Up
openxiv-worker-1 Up
openxiv-web-1 Up
```

Production smoke checks:

```text
api_acct_support|true
api_protocol_guard|true

GET https://openxiv.net/settings/identity with the existing authenticated test session
identity_status|200
identity_has_mastodon_profile_placeholder|True
identity_has_continue_button|True
identity_has_mastodon_account_class|True

Follow-up web-only rebuild after linked-account display polish:
docker compose -f docker-compose.yml -f docker-compose.production.yml build web
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d web
openxiv-web-1 Up
health status=ok
GET https://openxiv.net/settings/identity with the existing authenticated test session
identity_status|200
identity_has_mastodon_profile_placeholder|True
identity_has_continue_button|True

POST https://openxiv.net/api-proxy/auth/mastodon/start
body: {"instanceUrl":"https://mastodon.social/@ddavidich","redirect_after":"/settings/identity"}
mastodon_start_status|200
mastodon_start_host|mastodon.social
mastodon_start_path|/oauth/authorize
mastodon_start_has_state|True
mastodon_start_scope|read:accounts write:statuses
```

This proves the production Mastodon OAuth start flow now accepts the user's
profile URL directly and routes to Mastodon authorization. Completing the
actual link still requires the account holder to approve the OAuth screen on
`mastodon.social`; OpenXiv cannot mint the Mastodon access token without that
3-legged approval.

## Remaining blocker

ORCID sandbox acceptance cannot be completed with the current credentials.
The configured ORCID client is accepted by production ORCID but returns
`invalid_client` / `Client not found` against `https://sandbox.orcid.org`.
ORCID documentation also states that `/activities/update` is a Member API
scope and that adding works requires a 3-legged token granted by the record
holder. The next required artifact is therefore a sandbox Member API client and
a sandbox ORCID record/token, not more OpenXiv code.

The ORCID Sandbox Member API credentials form states that membership is not
required for sandbox access, but it is reCAPTCHA-gated and requires a real
non-Mailinator contact email. The exact request fields and suggested OpenXiv
values are in `docs/ops/orcid-sandbox-live-e2e.md`.
This blocker was rechecked against official ORCID docs on 2026-05-19: the
sandbox server guide says sandbox Member API credentials are available for
testing without affecting production records, and the add/update API tutorial
states that adding/updating record activities requires sandbox Member API
credentials plus `/activities/update` for works and other research activities.

Current concrete unblock inputs:

1. Sandbox ORCID Member API client ID and secret.
2. Sandbox ORCID record plus a 3-legged `/activities/update` token written to
   `.env.orcid-sandbox.local` by `scripts/orcid_sandbox_oauth.mjs login`.
3. Authenticated OpenXiv session cookie is currently present and verified in
   ignored `.env.orcid-sandbox.local` for the ddavidich test user; refresh it
   if it expires before the final live run. The current account-link rows still
   show ORCID `access=false`, `refresh=false`, empty scope, works-push disabled,
   and no sandbox flag.
4. A real Mastodon-compatible test account linked to the same OpenXiv user plus
   `MASTODON_ACCESS_TOKEN` for status readback and cleanup. Current `/me/links`
   has no Mastodon link.
5. If the literal `Bluesky/Twitter/Mastodon` badge wording remains in scope,
   a real Twitter/X crosspost implementation still needs to be specified and
   built. Current artifacts only support Bluesky and Mastodon crosspost status;
   Twitter code is Pixel/card metadata.
6. Citation live acceptance is currently satisfied by the temporary production
   row run above; future reruns still need a temporary published production
   paper or explicit `E2E_SAMPLE_ABS_ID` because production is cleaned back to
   zero papers after tests.
