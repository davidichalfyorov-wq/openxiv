# Bluesky Integration Audit

Date: 2026-05-18

Scope: auth routes, account linking, profile sync, crosspost worker, follows,
feed, federation, starter pack, resilience, UI, and real-test readiness.

Verdict: core Bluesky auth, profile sync, follows, starter pack, crosspost,
feed, paper AT-URI federation, and `app.openxiv.preprint` compatibility
federation are implemented, deployed, and verified against real
`ddavidich.bsky.social` flows. All F0-F11 Bluesky acceptance gates are closed
against real bsky.social/OpenXiv production flows.

## Current Evidence

Fresh production probes after the latest deploy:

- `POST /api/auth/bluesky/start` from `/auth/sign-in` redirects the browser to
  `https://bsky.social/oauth/authorize?...request_uri=...`.
- `GET https://openxiv.net/api/bsky/starter-suggestions` returns HTTP 200 with
  six resolved `did:plc` suggestions and `Cache-Control: public, max-age=3600`.
- `GET https://openxiv.net/auth/welcome` without a session returns HTTP 302 to
  `/auth/sign-in?return=/auth/welcome`.
- `GET https://openxiv.net/xrpc/app.bsky.feed.describeFeedGenerator` returns
  HTTP 200 with `did:web:openxiv.net` and six OpenXiv feed generator URIs.
- `GET https://openxiv.net/xrpc/app.bsky.feed.getFeedSkeleton?...openxiv-latest`
  returns HTTP 200 with a valid `{ "feed": [] }` skeleton shape.
- `GET https://openxiv.net/api/feed/bsky` without a session returns HTTP 401.
- `GET https://openxiv.net/auth/sign-in` production HTML contains the neutral
  `your-handle.bsky.social` placeholder and does not prefill the owner handle,
  so new Bluesky users are not steered to `ddavidich.bsky.social`.
- `docker compose ... ps api worker web` on the VPS shows `openxiv-api-1`,
  `openxiv-worker-1`, and `openxiv-web-1` running after rebuild/recreate.
- Worker logs after the profile-sync guard show repeated
  `[bluesky-profile-sync] checked=1 refreshed=0` with no
  `bsky.restoreSession` circuit trip for stale linked rows without a local
  OAuth session.
- Local temporary patch tar files, Playwright CLI artifacts, and temporary
  Bluesky smoke scripts were removed. Remote
  `/tmp/openxiv-bsky-profile-sync-loop-patch.tar` and
  `/tmp/openxiv-bsky-web-multiuser-patch.tar` were removed.
- `BSKY_TEST_HANDLE` / `BSKY_TEST_APP_PASSWORD` / `ATPROTO_SERVICE_URL` are set
  only in local `.env`, which is covered by `.gitignore`. They are not copied
  into docs or committed artifacts.

Fresh local verification:

- `pnpm --filter @openxiv/clients test -- src/bluesky/client.test.ts`
- `pnpm --filter @openxiv/clients typecheck`
- `pnpm --filter @openxiv/clients build`
- `pnpm --filter @openxiv/web test -- src/lib/api.test.ts`
- `pnpm --filter @openxiv/web build`
- `pnpm --filter @openxiv/db typecheck`
- `pnpm --filter @openxiv/db build`
- `pnpm --filter @openxiv/api test -- src/routes/auth.redirect.test.ts src/services/bluesky-profile-sync.test.ts src/services/atproto-writer.test.ts src/services/bluesky-bridge.test.ts`
- `pnpm --filter @openxiv/api test -- src/routes/bsky-starter-pack.test.ts`
- `pnpm --filter @openxiv/api test -- src/services/bsky-follow-queue.test.ts src/routes/auth.redirect.test.ts src/services/bluesky-profile-sync.test.ts src/services/atproto-writer.test.ts src/services/bluesky-bridge.test.ts src/routes/bsky-starter-pack.test.ts`
  passed 30 tests after adding BullMQ follow queueing.
- `pnpm --filter @openxiv/api test -- src/services/bluesky-profile-sync-loop.test.ts src/services/bsky-follow-queue.test.ts src/routes/auth.redirect.test.ts src/services/bluesky-profile-sync.test.ts src/services/atproto-writer.test.ts src/services/bluesky-bridge.test.ts src/routes/bsky-starter-pack.test.ts`
  passed 31 tests after adding the worker-driven stale Bluesky profile sweep.
- `pnpm --filter @openxiv/api test -- src/services/bluesky-profile-sync-loop.test.ts src/services/bsky-follow-queue.test.ts src/routes/auth.redirect.test.ts src/services/bluesky-profile-sync.test.ts src/services/atproto-writer.test.ts src/services/bluesky-bridge.test.ts src/routes/bsky-starter-pack.test.ts`
  passed 32 tests after adding a `hasSession` guard so the background profile
  sweep skips linked users without a local Bluesky OAuth session and does not
  open the `bsky.restoreSession` circuit for that case.
- `pnpm --filter @openxiv/api test -- src/services/account-linking.test.ts src/services/bluesky-profile-sync-loop.test.ts src/services/bsky-follow-queue.test.ts src/routes/auth.redirect.test.ts src/services/bluesky-profile-sync.test.ts src/services/atproto-writer.test.ts src/services/bluesky-bridge.test.ts src/routes/bsky-starter-pack.test.ts`
  passed 37 tests after adding regression coverage for same-user Bluesky
  relink idempotency and already-unlinked provider deletion.
- `pnpm --filter @openxiv/api test -- src/routes/feed.test.ts src/services/account-linking.test.ts src/services/bluesky-profile-sync-loop.test.ts src/services/bsky-follow-queue.test.ts src/routes/auth.redirect.test.ts src/services/bluesky-profile-sync.test.ts src/services/atproto-writer.test.ts src/services/bluesky-bridge.test.ts src/routes/bsky-starter-pack.test.ts`
  passed 43 tests after adding multi-user regression coverage for feed DID
  selection, follow job IDs, account-link conflicts, and profile-sync DID
  isolation.
- Fresh rerun of the same API command after cleanup passed 43/43.
- `pnpm --filter @openxiv/web test -- src/lib/api.test.ts src/lib/bsky-embed.test.ts`
  passed 3/3 after adding inline OpenXiv embed parsing/render helper coverage.
- `pnpm --filter @openxiv/lexicons test -- src/index.test.ts src/paper.crossListings.test.ts`
  passed 22/22 after adding `app.openxiv.preprint` compatibility schema and
  registry coverage.
- `pnpm --filter @openxiv/lexicons typecheck`
- `pnpm --filter @openxiv/lexicons build`
- `pnpm --filter @openxiv/api test -- src/routes/feed.test.ts src/services/account-linking.test.ts src/services/bluesky-profile-sync-loop.test.ts src/services/bsky-follow-queue.test.ts src/routes/auth.redirect.test.ts src/services/bluesky-profile-sync.test.ts src/services/atproto-writer.test.ts src/services/bluesky-bridge.test.ts src/routes/bsky-starter-pack.test.ts src/services/submissions.test.ts`
  passed 46/46 after the preprint alias write path was added.
- `pnpm --filter @openxiv/api typecheck`
- `pnpm --filter @openxiv/api build`
- `pnpm --filter @openxiv/web build`
- `pnpm --filter @openxiv/db typecheck`
- `pnpm --filter @openxiv/db build`
- `pnpm --filter @openxiv/e2e typecheck`
- `PUBLIC_API_BASE=https://openxiv.net/api PUBLIC_WEB_BASE=https://openxiv.net pnpm --filter @openxiv/e2e test -- tests/bluesky-roundtrip.spec.ts --project=chromium`
  ran against production: two public live tests passed, two credentialed tests
  skipped because app-password credentials were absent.
- `ATPROTO_SERVICE_URL=https://bsky.social pnpm --filter @openxiv/api bsky:smoke`
  passed 4/4 checks with the real account, including app-password login and a
  create/read/delete post roundtrip against bsky.social.
- `PUBLIC_API_BASE=https://openxiv.net/api PUBLIC_WEB_BASE=https://openxiv.net pnpm --filter @openxiv/e2e test -- tests/bluesky-roundtrip.spec.ts --project=chromium`
  passed 4/4 against production with real Bluesky credentials: feed generator,
  app-password auth, PDS metadata, and post create/read/delete.
- Fresh rerun with explicit
  `PUBLIC_API_BASE=https://openxiv.net/api`,
  `PUBLIC_WEB_BASE=https://openxiv.net`, and
  `FEED_GENERATOR_PUBLIC_URL=https://openxiv.net` passed 4/4. A prior rerun
  without these origins failed only because the test defaulted to localhost.
- Fresh `pnpm --filter @openxiv/api bsky:smoke` passed 4/4 against bsky.social:
  describeServer, OAuth AS metadata, Jetstream upgrade endpoint, and
  app-password create/read/delete.
- A production browser OAuth attempt
  (`/auth/sign-in?return=/auth/welcome -> bsky.social/oauth/authorize`) with
  the same App Password reached the bsky.social password form but failed with
  "Wrong identifier or password". This confirms the App Password is valid for
  AT-proto API tests but is not sufficient to complete Bluesky's web OAuth UI.
- A follow-up production browser OAuth attempt with the real Bluesky web
  password reached `https://openxiv.net/auth/welcome`; `/api/auth/me` returned
  HTTP 200 with `authenticated=true`, DID
  `did:plc:dzhzljg4peg765tpd2q63luc`, and handle
  `ddavidich.bsky.social`.
- The same real OAuth session hit `GET /api/feed/bsky` successfully
  (HTTP 200, `{"feed":[]}`), proving `restoreSession()` works from the stored
  OAuth session. `POST /api-proxy/auth/logout` removed the OpenXiv session
  cookie and the next `/api/auth/me` returned unauthenticated.
- Production DB/Redis check: `account_links` contains `provider='bluesky'`
  for subject `did:plc:dzhzljg4peg765tpd2q63luc`, and Redis contains
  `bsky:oauth:session:did:plc:dzhzljg4peg765tpd2q63luc`.
- Real Follow all production smoke:
  `/auth/welcome` queued six starter follows, all six remote
  `app.bsky.graph.follow` records appeared, `/api/me/bsky-follows` mirrored
  all six, cleanup via OpenXiv DELETE removed the remote records, and
  BullMQ `openxiv.bsky-follow` ended with completed=0, failed=0, wait=0.
- Real crosspost production smoke:
  Bluesky OAuth sign-in submitted a temporary `.tex`, the saga published
  `openxiv:cs.AI.2026.00001`, `com.atproto.repo.getRecord` resolved the
  `app.openxiv.paper` AT URI, a real `app.bsky.feed.post` appeared with
  text `New paper: ... #openxiv` and external embed
  `https://openxiv.net/p/openxiv%3Acs.AI.2026.00001`, two saga retries left
  exactly one matching Bluesky post, `/api/feed/bsky` returned that post, and
  `/feed/bsky` rendered the deployed inline OpenXiv embed card.
- Test manuscript cleanup after crosspost:
  PDS cleanup deleted the paper, summary, disclosure, and feed-post records;
  production DB cleanup deleted the temporary paper row and cascades; MinIO
  storage under the paper id and Redis job keys were removed; `id_counters`
  for `cs.AI/2026` was returned to an empty state. A public follow-up fetch for
  `/abs/cs.AI.2026.00001` renders "Paper not found" rather than the E2E title.
- Real preprint-alias production smoke after the compatibility deploy:
  a temporary `.tex` submission wrote both
  `at://did:plc:dzhzljg4peg765tpd2q63luc/app.openxiv.paper/3mm5nvmtzpswi`
  and
  `at://did:plc:dzhzljg4peg765tpd2q63luc/app.openxiv.preprint/3mm5nvmtzpswi`;
  `com.atproto.repo.getRecord` against bsky.social resolved the preprint
  record with `$type='app.openxiv.preprint'` and the expected title. Cleanup
  deleted five PDS records, deleted the production DB row/cascades, removed the
  MinIO paper prefix, removed matching Redis keys, and reset the empty
  `cs.AI/2026` id counter. Follow-up bsky.social reads for both paper and
  preprint records return HTTP 400, and `/abs/cs.AI.2026.00001` renders
  "Paper not found".
- Real profile-sync production smoke:
  `app.bsky.actor.profile.displayName` was changed through XRPC, the OpenXiv
  user row was marked stale, OpenXiv synced the new display name, the mirrored
  avatar URL fetched HTTP 200, then the Bluesky profile and OpenXiv mirror were
  restored to `David Alfyorov`.
- Real bridge-failure production drill:
  a temporary `.tex` submission published locally and wrote both paper and
  preprint AT records. The saved Bluesky OAuth session was then temporarily
  corrupted only for the retry window, `POST /api/papers/:id/retry` returned
  HTTP 200, the public paper stayed `published` with `paper.uri` present,
  `submission_sagas.last_error_stage` became `stageBlueskyBridge`,
  `paper_versions.bridge_status` became `failed`, and BullMQ held a retry job
  with `attempts=5` plus exponential backoff. Cleanup restored the Redis OAuth
  session, removed matching BullMQ jobs, deleted six PDS records, deleted the
  production DB row/cascades, removed MinIO and Redis traces, reset the empty
  `cs.AI/2026` id counter, verified bsky.social `getRecord` returns HTTP 400
  for both paper/preprint records, and verified `/abs/cs.AI.2026.00001` renders
  "Paper not found".
- Real upstream-outage production drill:
  a second temporary `.tex` submission published normally, then only the worker
  container's `/etc/hosts` was changed so `bsky.social` resolved to
  `127.0.0.1` during the bridge retry. `POST /api/papers/:id/retry` returned
  HTTP 200, the paper stayed `published`, `paper.uri` stayed present,
  `last_error_stage` became `stageBlueskyBridge`, `bridge_status` became
  `failed`, and BullMQ created a retry job with `attempts=5` and exponential
  backoff. The worker hosts file was restored, matching BullMQ jobs were
  removed, six PDS records were deleted, the DB/storage/Redis/id-counter traces
  were removed, bsky.social paper/preprint `getRecord` calls returned HTTP 400,
  and `/abs/cs.AI.2026.00001` rendered "Paper not found".
- Real endorsement-federation production drill:
  a temporary `app.openxiv.paper` PDS record was written, a matching temporary
  OpenXiv paper row used a synthetic non-self submitter DID, and the real
  authenticated `/api/papers/:id/endorsements` route wrote
  `at://did:plc:dzhzljg4peg765tpd2q63luc/app.openxiv.endorsement/3mm5pdqle7czb`.
  bsky.social `com.atproto.repo.getRecord` resolved it with
  `$type='app.openxiv.endorsement'`, the expected `paperUri`, and
  `verb='useful_background'`; the public API reported one endorsement. Cleanup
  deleted both PDS records, deleted the temporary DB row/cascaded endorsement,
  and verified zero matching Redis keys.
- Real non-primary account-linking production drill:
  the owner row was temporarily lowered to the ORCID `did:web` primary while
  keeping ORCID and Bluesky provider links, a fresh session cookie was issued
  for that non-Bluesky-primary state, `/settings/identity` unlinked Bluesky
  through the live DELETE UI, then the real bsky.social OAuth web flow relinked
  Bluesky with `intent=link`. The post-flow DB state had both ORCID and
  Bluesky links, `linked_via='link'`, `prev_primary_did` set to the ORCID DID,
  `new_primary_did` set to `did:plc:dzhzljg4peg765tpd2q63luc`, and the
  browser session remained authenticated as the promoted `did:plc` user. The
  original production user row and audit link rows were restored immediately
  after the drill.
- Real handle-change production drill:
  the Bluesky account handle was changed from `ddavidich.bsky.social` to
  `oxv05182343.bsky.social` through `com.atproto.identity.updateHandle`; the
  temporary handle resolved back to
  `did:plc:dzhzljg4peg765tpd2q63luc`. After the OpenXiv row was marked stale,
  the worker-driven profile sync picked up the new handle in 51.8 seconds and
  `/api/profiles/oxv05182343.bsky.social` returned HTTP 200. The handle was
  then restored to `ddavidich.bsky.social`, resolved back to the same DID, and
  OpenXiv synced the restored handle in 52.0 seconds; the restored
  `/api/profiles/ddavidich.bsky.social` returned HTTP 200.

## Phase Status

| Phase | Status | Evidence / Remaining Gate |
| --- | --- | --- |
| F0 audit | works | This file is the current punch-list and evidence map. |
| F1 auth | works, deployed | Sign-in UI uses `POST /api/auth/bluesky/start` and reaches real bsky.social OAuth. Real browser OAuth with the real web password completed back to `/auth/welcome`, created an OpenXiv session for the correct DID, restored the stored OAuth session through `/api/feed/bsky`, and logout cleared the OpenXiv session. |
| F2 account linking | works, deployed | `/settings/identity` uses Bluesky start with `intent=link`; callback branches to link when a primary OpenXiv session exists; same-user relink returns the existing `account_links` row instead of inserting a duplicate; deleting an already-unlinked provider is a no-op. A real non-Bluesky-primary drill unlinked and relinked Bluesky through bsky.social OAuth without losing the primary OpenXiv session. |
| F3 profile sync | works, deployed | Real XRPC displayName mutation synced into OpenXiv and was restored; avatar URL fetched HTTP 200. Real handle mutation `ddavidich.bsky.social -> oxv05182343.bsky.social -> ddavidich.bsky.social` synced into OpenXiv in 51.8s and back in 52.0s. |
| F4 crosspost | works, deployed | Real temporary preprint produced a Bluesky post with OpenXiv `/p/...` embed. Two saga retries left exactly one matching post. A live bridge-failure retry drill left local publish usable and produced a retryable BullMQ failure. |
| F5 follows | works, deployed | Single follow/unfollow and `/auth/welcome` Follow all created real remote follow records and cleaned them up. Job ids are per-follower and colon-safe; new jobs use `removeOnComplete: true`; queue finished with completed/failed/wait all zero. |
| F6 feed | works, deployed | Signed-in `/api/feed/bsky` returned the real crosspost. `/feed/bsky` now renders OpenXiv external embeds inline with title/description metadata. |
| F7 federation | works, deployed | Real paper `app.openxiv.paper`, compatibility `app.openxiv.preprint`, and `app.openxiv.endorsement` AT URIs resolved through bsky.social `com.atproto.repo.getRecord`. |
| F8 starter pack | works, deployed | Real `/auth/welcome` Follow all queued six starter follows, verified all six remote records, then cleaned them up. |
| F9 resilience | works, deployed for tested flows | Bluesky profile sync and feed/page flows fail soft; crosspost branch surfaced both a live bridge/session failure and a worker-local upstream outage as `stageBlueskyBridge` with retryable BullMQ jobs while the local papers stayed published; follow/unfollow writes go through a retryable BullMQ queue with a 50/min worker limiter; worker-driven profile sweep refreshes stale linked users every minute and skips rows without a local OAuth session. |
| F10 real tests | works | Live network tests do not mock bsky.social. Credentialed API smoke, production e2e, browser OAuth/session/logout, account link/unlink/relink from a non-Bluesky primary state, displayName/avatar sync, handle-change sync, follow/unfollow, Follow all, profile mutation, crosspost, bridge failure/retry, worker-local upstream outage, feed, paper/preprint AT URI, and endorsement AT URI checks are green. |
| F11 deploy acceptance | works | API/worker/web were rebuilt/restarted on VPS. Sign-in to crosspost smoke passed and the test preprint/PDS/storage/Redis artifacts were cleaned. All remaining live gates have now been exercised and restored. |

## Prompt-To-Artifact Checklist

| Requirement | Artifact / command | Current evidence |
| --- | --- | --- |
| Real Sign in with Bluesky | `apps/web/src/pages/auth/sign-in.astro`, `apps/api/src/routes/auth.ts`, Playwright browser OAuth smoke | Browser reaches real bsky.social authorize URL and completes callback with the real web password. |
| Link Bluesky from settings | `apps/web/src/pages/settings/identity.astro`, `selectBlueskyCallbackMode` tests, `account-linking.test.ts` | Real `/settings/identity` non-primary drill unlinked Bluesky, completed bsky.social OAuth with `intent=link`, restored the Bluesky `account_links` row, and promoted the primary DID back to `did:plc`. Same-user duplicate callback is idempotent and different-user conflict isolation is covered. |
| Unlink idempotent and primary auth preserved | `apps/api/src/routes/account-linking.ts`, `apps/api/src/services/account-linking.ts`, settings DELETE UI | Already-unlinked provider deletion is covered as a no-op; primary-provider guard remains; real non-primary unlink/relink preserved authentication and both ORCID plus Bluesky links. |
| Profile sync handle/displayName/avatar | `apps/api/src/services/bluesky-profile-sync.ts`, `apps/api/src/services/bluesky-profile-sync-loop.ts`, unit tests | Real displayName mutation synced into OpenXiv, avatar URL returned HTTP 200, and the Bluesky profile was restored. Real handle mutation synced into OpenXiv in 51.8s and restored in 52.0s, both under the five-minute gate. |
| Crosspost on publish with `/p/<id>` | `apps/api/src/services/bluesky-bridge.ts`, bridge test, production smoke | Real temporary preprint produced a Bluesky post with an OpenXiv `/p/...` external embed and title/tag text. |
| Crosspost idempotency | bridge status logic and test, production retry smoke | Two real saga retries left exactly one matching Bluesky post. |
| Bluesky down does not break publish, retries | `apps/api/src/services/submissions.ts`, BullMQ compile worker retry | Live bridge failure drill kept the paper `published`, left `paper.uri` present, recorded `stageBlueskyBridge`, set `bridge_status='failed'`, and created a BullMQ retry job with `attempts=5` and exponential backoff. |
| Follows list/import/create/delete | `apps/api/src/routes/bsky-follows.ts`, `apps/api/src/services/bsky-follow-queue.ts`, profile UI | Real follow/unfollow created and removed a Bluesky follow record; Follow all created six remote follow records and cleanup removed them. |
| 50/min follow limit | `apps/api/src/workers/index.ts`, `BSKY_FOLLOW_QUEUE_RATE_LIMIT` | BullMQ worker limiter is `max=50`, `duration=60000`; jobs retry with exponential backoff. |
| `/feed/bsky` timeline | `apps/api/src/routes/feed.ts`, `apps/web/src/pages/feed/bsky.astro`, `apps/api/src/routes/feed.test.ts` | Unauth 401/page path verified. Signed-in OAuth session returned HTTP 200. Real crosspost appeared in the API feed and the deployed page rendered its inline OpenXiv embed. Multi-user DID selection is unit covered. |
| XRPC feed generator | `apps/api/src/routes/bsky-feed-generator.ts` | Production describe/skeleton endpoints return 200. |
| AT URI paper/preprint/endorsement resolution | `packages/lexicons/src/paper.ts`, `apps/api/src/services/atproto-writer.ts`, `apps/api/src/services/submissions.ts`, `apps/api/src/routes/endorsements.ts` | Real `app.openxiv.paper`, `app.openxiv.preprint`, and `app.openxiv.endorsement` records resolved through bsky.social `com.atproto.repo.getRecord`. |
| Starter pack suggestions | `apps/api/src/routes/bsky-starter-pack.ts`, `/auth/welcome` | Public suggestions endpoint verified. Real Follow all queued six starter follows and all six remote records appeared before cleanup. |
| Resilience 5s fail-soft | profile sync timeout, public smoke | Live bridge/session failure and worker-local upstream outage drills both kept local publish usable and produced retryable BullMQ failures; profile/feed/follow paths fail soft or queue as documented. |
| Real tests, no mocks | `apps/api/src/services/bluesky-live.integration.test.ts`, `e2e/tests/bluesky-roundtrip.spec.ts`, `bsky:smoke`, production smoke scripts | Public and credentialed live app-password tests pass against bsky.social. Browser OAuth, account link/unlink/relink, displayName/avatar sync, handle-change sync, follow/unfollow, Follow all, crosspost, feed, paper/preprint AT URI, endorsement AT URI, bridge failure, and worker-local upstream outage were exercised against production. |
| Multi-user behavior | `apps/web/src/pages/auth/sign-in.astro`, `apps/web/src/pages/settings/identity.astro`, `apps/api/src/routes/feed.test.ts`, `apps/api/src/services/bsky-follow-queue.test.ts`, `apps/api/src/services/account-linking.test.ts`, `apps/api/src/services/bluesky-profile-sync-loop.test.ts` | UI no longer prefills `ddavidich.bsky.social`; runtime code keys sessions/links/follows/feed/profile sync by current user's DID or `users.blueskyDid`; tests cover two distinct DIDs and conflict isolation; real non-primary link/unlink/relink proves a non-Bluesky-primary user can add Bluesky without losing the existing primary account. Remaining `ddavidich` literals are owner reservation docs/tests/comments, not Bluesky runtime routing. |
| Deploy | VPS `docker compose build api worker web && up -d api worker web` | API/worker/web rebuilt and running. |
| Cleanup test preprint | PDS delete + production DB/storage/Redis cleanup scripts | The temporary crosspost, preprint-alias, and bridge-failure drill preprints, related PDS records, storage objects, Redis keys, BullMQ jobs, and empty category id-counter rows were removed after the smokes. |

## Files Touched In This Bluesky Closure Pass

- `docs/audit/bluesky-integration.md`
- `scripts/ssh_run.py`
- `packages/lexicons/src/paper.ts`
- `packages/lexicons/src/registry.ts`
- `packages/lexicons/src/index.test.ts`
- `packages/lexicons/schemas/app.openxiv.preprint.json`
- `packages/clients/src/bluesky/interface.ts`
- `packages/clients/src/bluesky/client.ts`
- `packages/clients/src/bluesky/client.test.ts`
- `apps/web/src/lib/api.ts`
- `apps/web/src/lib/api.test.ts`
- `apps/web/src/lib/bsky-embed.ts`
- `apps/web/src/lib/bsky-embed.test.ts`
- `apps/web/src/pages/auth/sign-in.astro`
- `apps/web/src/pages/settings/identity.astro`
- `apps/web/src/pages/feed/bsky.astro`
- `apps/web/src/pages/auth/welcome.astro`
- `apps/web/src/pages/u/[handle].astro`
- `apps/api/src/context.ts`
- `apps/api/src/routes/auth.ts`
- `apps/api/src/routes/auth.redirect.test.ts`
- `apps/api/src/routes/bsky-feed-generator.ts`
- `apps/api/src/routes/bsky-follows.ts`
- `apps/api/src/routes/bsky-starter-pack.ts`
- `apps/api/src/routes/bsky-starter-pack.test.ts`
- `apps/api/src/routes/endorsements.ts`
- `apps/api/src/routes/feed.ts`
- `apps/api/src/routes/feed.test.ts`
- `apps/api/src/routes/index.ts`
- `apps/api/src/services/atproto-writer.ts`
- `apps/api/src/services/atproto-writer.test.ts`
- `apps/api/src/services/bsky-follow-queue.ts`
- `apps/api/src/services/bsky-follow-queue.test.ts`
- `apps/api/src/services/bluesky-bridge.ts`
- `apps/api/src/services/bluesky-bridge.test.ts`
- `apps/api/src/services/bluesky-profile-sync.ts`
- `apps/api/src/services/bluesky-profile-sync.test.ts`
- `apps/api/src/services/bluesky-profile-sync-loop.ts`
- `apps/api/src/services/bluesky-profile-sync-loop.test.ts`
- `apps/api/src/services/submissions.ts`
- `apps/api/src/services/submissions.test.ts`
- `apps/api/src/services/users.ts`
- `apps/api/src/workers/index.ts`
- `e2e/tests/bluesky-roundtrip.spec.ts`
- `packages/db/src/repositories/bsky-follows.ts`
- `packages/db/src/repositories/users.ts`

## Remaining Acceptance Gates

None. The final handle-change gate was exercised on production and restored.

## Credential Gate

Use an App Password, not the primary Bluesky account password:

```powershell
$env:BSKY_TEST_HANDLE = "ddavidich.bsky.social"
$env:BSKY_TEST_APP_PASSWORD = "xxxx-xxxx-xxxx-xxxx"
$env:ATPROTO_SERVICE_URL = "https://bsky.social"
pnpm --filter @openxiv/api bsky:smoke
```

The App Password covers API-level tests. Browser OAuth requires the real web
password or an already-authenticated bsky.social browser session.
