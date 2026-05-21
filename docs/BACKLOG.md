# OpenXiv backlog — items scoped but not yet shipped

Each item has a clear definition of done so the next session (yours or
mine) can pick it up without re-deriving requirements.

## #10 Scholar metadata CI gate

**What:** Playwright spec that walks a corpus of published papers,
asserts every page emits `citation_title`, `citation_author`,
`citation_publication_date`, `citation_doi` (if present),
`citation_issn=3120-9556`, `<link rel="canonical">`,
`<script type="application/ld+json">` with a `@type=ScholarlyArticle`
and a valid `isPartOf.Periodical.issn`, plus `ItemList` on topic pages.
Run in CI as a blocking job — `pnpm --filter @openxiv/e2e test scholar-metadata` already exists for the JSON-LD shape; extend it to a corpus walk + ISSN assertion.

**Definition of done:**
- `e2e/tests/scholar-metadata.spec.ts` iterates ≥20 papers via
  `/api/papers?limit=100` and runs the same assertions on each.
- GitHub Action (or pre-commit hook) blocks merge if the spec fails.
- ISSN_DISPLAY flag respected — when off, the spec asserts the field is
  absent rather than misformatted.

**Why deferred:** needs CI infra changes + per-PR stack-up. Two-hour
follow-up that can land independently.

## #11 atproto/lex codegen

**What:** Replace hand-written `packages/lexicons/src/*.ts` zod schemas
with generated types from `lexicons/*.json` via `@atproto/lex-cli`.
Keep hand-written zod validators where the lexicon's JSON Schema can't
express the constraint (e.g. `crossListings.length <= 5`).

**Definition of done:**
- `packages/lexicons/package.json` adds a `codegen` script that runs
  `lex-cli` against the JSON files and writes to `src/generated/`.
- The hand-written zod files re-export the generated types and only
  carry runtime validators.
- A pre-commit hook (or `pnpm prepublish`) regenerates so the source
  of truth stays the JSON.

**Why deferred:** quality-of-life devex, not user-visible. Won't block
the ISSN/multi-category/editor work.

## #12 bull-board admin UI

**What:** Mount `@bull-board/fastify` at `/api/admin/queues` (RBAC via
`ADMIN_DIDS`). Lets the operator inspect the BullMQ queue depth,
retry counts, failure reasons without SSH'ing into Redis.

**Definition of done:**
- Plugin registered in `apps/api/src/server.ts` behind the
  `BULL_BOARD` feature flag.
- 403 for non-admin sessions.
- Smoke test that the UI loads at /api/admin/queues with admin
  credentials.

**Why deferred:** purely operational. Manageable from `redis-cli`
in the meantime.

## #14 Zotero Translation Server

**What:** Add `zotero-translation-server` to `docker-compose.yml`,
expose `:1969` to the API network. New API route
`POST /api/intake/from-url` calls Zotero, normalises CSL JSON → our
`SubmitInput` shape, pre-fills the wizard.

**Definition of done:**
- docker-compose service added with healthcheck.
- New API route + breaker (`zotero.translate`) with 10s timeout.
- Web wizard gets an "Import by URL" button on step 0.
- Integration test against the live Zotero service.

**Why deferred:** ergonomic, not load-bearing. Authors today paste
title + abstract by hand; this just saves clicks.

## #15 GlitchTip self-hosted error tracking

**What:** Run GlitchTip via docker-compose, wire `@sentry/node` into
api/worker/feed-generator + `@sentry/browser` into web. PII scrub
hook strips emails + DIDs.

**Definition of done:**
- glitchtip-server + postgres service in docker-compose.
- Sentry init in each process, gated on `ERROR_TRACKING` flag + DSN env.
- Tests for the PII scrubber.

**Why deferred:** observability. Console logs + structured pino + the
`worker_failed` Redis counter cover the immediate need.

---

**Common pattern:** each backlog item has a documented feature flag
(`FLAGS` in `apps/api/src/services/flags.ts`) so a half-built feature
can sit in main without affecting users.
