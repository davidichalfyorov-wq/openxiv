<p align="center">
  <img src="apps/web/public/brand/logo-mark.svg" alt="OpenXiv" width="220" />
</p>

<h1 align="center">OpenXiv</h1>

<p align="center">
  <strong>A preprint server that lives in your social feed.</strong><br/>
  Built on the AT Protocol. Preprints federate to Bluesky.<br/>
  <a href="https://openxiv.net">openxiv.net</a> · ISSN <a href="https://portal.issn.org/resource/ISSN/3120-9556">3120-9556</a> (online) · <a href="https://www.wikidata.org/wiki/Q139860032">Wikidata Q139860032</a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: AGPL-3.0-or-later" src="https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg"></a>
  <img alt="TypeScript" src="https://img.shields.io/badge/typescript-strict-3178c6">
  <img alt="Node 22" src="https://img.shields.io/badge/node-%E2%89%A522-43853d">
  <img alt="AT Protocol" src="https://img.shields.io/badge/AT_Protocol-app.openxiv.*-0085ff">
  <img alt="OAI-PMH 2.0" src="https://img.shields.io/badge/OAI--PMH-2.0-7d3cad">
</p>

---

OpenXiv is an AT Protocol App View for science. Papers, threads, endorsements,
disclosures, and reviews are real `app.openxiv.*` records that live in each
author's PDS (Bluesky's or their own) and federate to the wider AT Protocol
network. The server publishes to Bluesky, exposes OAI-PMH 2.0 for
library indexers, and runs its own custom Bluesky feeds.

Open to independent researchers without institutional backing. Sign in with
ORCID, Google, or did:plc through Bluesky. No endorsement gate. No
"must be affiliated" filter.

AI use is welcome under structured disclosure (`none`, `assistant`,
`coauthor`, `primary`, recorded as an `app.openxiv.disclosure` record).
Unverified output is refused with a public refusal packet that names the
failure mode. Work returns for revision instead of triggering an author ban.

The instance at [openxiv.net](https://openxiv.net) is the single live
deployment. It is also indexed by [BASE](https://www.base-search.net/),
[CORE](https://core.ac.uk/), and the [Bluesky directory of custom feeds](https://bsky.app/profile/openxiv.bsky.social).

## Table of contents

- [What you actually get](#what-you-actually-get)
- [Stack](#stack)
- [Repository layout](#repository-layout)
- [Lexicons (`app.openxiv.*`)](#lexicons-appopenxiv)
- [Submit saga (6 stages)](#submit-saga-6-stages)
- [OAI-PMH and library indexing](#oai-pmh-and-library-indexing)
- [Bluesky feed generator](#bluesky-feed-generator)
- [arXiv overlay browser extension](#arxiv-overlay-browser-extension)
- [Quick start (Docker)](#quick-start-docker)
- [Development](#development)
- [Configuration](#configuration)
- [Tests](#tests)
- [Production deployment](#production-deployment)
- [Single-owner mode](#single-owner-mode)
- [Auth flows](#auth-flows)
- [Contributing](#contributing)
- [License](#license)

## What you actually get

| Feature | State |
|---|---|
| OpenXiv ids `{subject}.{YYYY}.{NNNNN}` allocated per (subject, year) | live, atomic |
| Profile pages `/@{handle}` with unified All / Papers / Posts tabs | live |
| Submit wizard, 6 idempotent stages, per-stage retry endpoint | live |
| Read flow at `/abs/{id}` with PDF, HTML, three explainer tiers, saga timeline | live |
| Trust Passport with lanes for transparency, identity, provenance, citations, math, integrity, social review, public disputes, external attestations | live |
| Provenance Timeline, eight publicly visible stages from upload to Bluesky bridge | live |
| Real OAuth: ORCID, Google, Bluesky (did:plc), Mastodon (cross-post link) | live, mock fallback for dev |
| OAI-PMH 2.0 endpoint at `/oai-pmh` with oai_dc metadata, transient deletes, ISO 8601 datestamps | live, validated by BASE OVAL |
| Bluesky feed generator (six custom feeds at `did:web:openxiv.net`) | live |
| Refusal packets at `/refusals/{id}` for AI-slop and policy violations | live |
| Browser extension that injects OpenXiv Trust Passport badges onto `arxiv.org/abs/*` pages | dev install |
| Multi-tier summaries (school, undergrad, expert) generated at submission, editable by author | live |
| `app.openxiv.preprint` and `app.openxiv.prereg` registry for hypothesis pre-registration | live |
| `app.openxiv.endorsement` typed verbs (verified derivation, reproduced result, checked references, etc.) | live |
| Jetstream subscriber that mirrors `app.bsky.feed.post` referencing OpenXiv papers back into the App View | live |
| DOI minting via Crossref or DataCite | deferred until membership |
| Federated discovery beyond Bluesky (Mastodon ActivityPub, IPFS replicas) | future |

## Stack

- **Language**: TypeScript strict, Node 22.
- **API**: [Fastify 5](https://fastify.dev/) with `fastify-type-provider-zod` for end-to-end typed routes.
- **Database**: PostgreSQL 16 + pgvector via Drizzle ORM. Migrations live in `packages/db/drizzle`.
- **Queues**: BullMQ on Redis 7. Heavy work (compile, embed, explain, figure extraction, Bluesky bridge, jetstream relay) runs in a separate worker process.
- **Storage**: S3 compatible. MinIO locally, Hetzner Object Storage in production, accessed through `@aws-sdk/client-s3`.
- **LaTeX to PDF**: `tectonic` running in a sandboxed Docker container (mockable).
- **LaTeX to HTML**: `latexml` (mockable). PDF and HTML are served side by side on the paper page.
- **Metadata extraction**: GROBID over its HTTP API for affiliations, references, abstracts.
- **Figure extraction**: `pdf-lib` plus a custom raster pass; each figure lands at `/api/papers/{id}/figures/{n}`.
- **LLM**: DeepSeek V4 Flash for explainer tier generation; Gemini `gemini-embedding-001` for semantic similarity.
- **Undisclosed AI detector**: ensemble (perplexity burst + Binoculars-style ratio + stylometric) producing a score in `[0, 100]`. The MVP ships a heuristic; swap in GPT-2-medium scoring when the model directory is populated.
- **Auth**: OAuth via ORCID (primary, verifies researchers), Google, and Bluesky, all resolving to an AT Protocol DID. Mastodon link-only for cross-posting.
- **Web**: Astro 5 server-rendered with React 19 islands for the submission wizard, the explainer tabs, the publish action, and the discussion thread.
- **Lexicons**: `app.openxiv.*` records in `packages/lexicons` with JSON schemas and matching zod validators.
- **Errors**: `neverthrow` Result types end to end. No silent catches.
- **Resilience**: opossum circuit breakers wrap every external (LLM, GROBID, tectonic, S3, ORCID, Bluesky PDS, jetstream). A single dependency going down does not take the system out.
- **Edge**: Caddy 2 in front of every service. Automatic HTTPS, HTTP/3, on-the-fly compression.
- **Observability**: Sentry SDK with `SENTRY_DSN` opt in; pino logs with `pino-pretty` in dev.

## Repository layout

```
openxiv/
  apps/
    api/              Fastify API + BullMQ workers (one image, two entrypoints).
      src/
        routes/       REST endpoints: auth, papers, posts, feed, uploads,
                      profiles, follows, endorsements, refusals, oai-pmh,
                      bsky-feed-generator, bsky-labeler, jetstream relay,
                      starter pack, daily-brief, search, topics, lens,
                      analytics, engagement, account-linking, did-web,
                      preregistrations, paper-edit, moderation, versions.
        services/     Application logic (submissions saga, feed, explain,
                      posts, users, social-push, jetstream-subscriber,
                      Trust Passport assembly, refusal packets, mastodon
                      crosspost, etc).
        workers/      BullMQ workers (compile, embed, explain, figures,
                      pdf-finalize, bsky-follow, mastodon-crosspost).
        plugins/      Fastify plugins (auth, error handler, OpenAPI).
        auth/         Session JWT signing, OAuth state, did:plc resolver.
        scripts/      Operator CLIs (sample-cover, register-bsky-feeds,
                      bsky-smoke, finalize-all-papers, figures-extract-all,
                      rasterize-brand).
        services/brand/  PDF cover assets (logo + masthead bitmaps).
        context.ts    DI bag: db, redis, clients, repos.
        index.ts      API entrypoint.
        worker.ts     Worker entrypoint, same context + services.
      Dockerfile      Multi-stage; tini-supervised; runs migrations on
                      first start.

    web/              Astro 5 SSR + React islands.
      src/
        pages/        /, /submit, /abs/[id], /@[handle], /auth/sign-in,
                      /about, /faq, /press, /policies/*, /terms, /privacy,
                      /dmca, /transparency, /glossary, /vocabulary,
                      /browse, /feeds, /feed.atom, /sitemap.xml, /stats,
                      /search, /topics/*, /compare, /lens/*, /docs/*,
                      /prereg/*, /embed/*, /admin/*.
                      /api-proxy/[...path] proxies browser to API so
                      cookies stay same-origin.
        components/   PaperRow, PostRow, AiBadge, Explainer, SubmissionWizard,
                      PublishButton, TrustPassportPanel, RefusalRow,
                      Provenance Timeline, EmbedCard, MastodonLink.
        layouts/      Base.astro with global head, JSON-LD,
                      RSS auto-discovery.
        lib/          api.ts (typed REST client), format.ts, jsonld.ts.
      public/
        brand/        logo-mark.svg, logo-full.svg, og-default.svg.
        humans.txt, llms.txt, llms-full.txt, manifest.json, opensearch.xml,
        robots.txt, oauth client metadata, schemas/*.json.
      Dockerfile      Multi-stage; serves with @astrojs/node standalone.

    feed-generator/   Standalone Bluesky custom-feed service.
      src/index.ts    Implements
                        /.well-known/did.json,
                        /xrpc/app.bsky.feed.describeFeedGenerator,
                        /xrpc/app.bsky.feed.getFeedSkeleton.
                      Six feeds: openxiv-latest, openxiv-featured,
                      openxiv-questions, openxiv-disclosed,
                      openxiv-beginner, openxiv-claims. Skeletons
                      reference the bridged `app.bsky.feed.post` URIs
                      so the Bluesky App View hydrates embed cards.

    extension/        Chrome / Edge / Firefox MV3 content script.
      manifest.json   Permission limited to arxiv.org/abs/*.
      content.js      Reads arXiv id, calls
                      ${API_BASE}/api/lookup?arxiv_id=...; if matched
                      shows Trust Passport lane badges in a corner
                      sidebar; otherwise a "submit to OpenXiv" CTA.

  packages/
    shared/           AppError, Result helpers, zod env schema, category
                      taxonomy, TID/at-uri ids, OpenXiv id formatter,
                      ISSN constants.
    lexicons/         JSON schemas in schemas/, zod validators in src/.
                      paper, summary, disclosure, post, review,
                      endorsement, citation, preprint, prereg.
    db/               Drizzle schema (users, papers, paper_versions,
                      paper_figures, paper_extras, paper_edits, posts,
                      follows, reviews, refusals, embeddings, jobs,
                      identity, social, bluesky, events, external,
                      featured, profile-cards, profile-modes).
                      Repositories + migration runner + index migrations.
    clients/          External integrations. Each has a real impl, a mock
                      impl, and a factory that picks via env flags.
                      storage (S3), llm (DeepSeek + Gemini), compiler
                      (tectonic), latexml, grobid, oauth (ORCID, Google,
                      Bluesky), pds (AT Protocol PDS client), detector
                      (AI ensemble), keywords (KeyBERT-style).
                      opossum circuit breaker wrapper, HTTP helper with
                      timeout + retry.

  e2e/                Playwright E2E against the docker-compose stack.
  docs/               ARCHITECTURE, ops runbook, dev onboarding,
                      policies, incidents, GITHUB-RELEASE-PREP,
                      security audit, release checklists.
  scripts/            Server bootstrap scripts (Contabo VPS),
                      live-preflight checks (Mastodon, LaTeXML).
  docker-compose.yml             Local dev stack.
  docker-compose.production.yml  Contabo production stack.
  Caddyfile                      Local dev edge.
  Caddyfile.production           Production edge config.
  .github/workflows/             CI: typecheck + lint + unit tests on
                                 Node 22 and 24; E2E via docker-compose.
  _legacy/                       Previous Python + Next.js prototype,
                                 kept for reference only.
```

## Lexicons (`app.openxiv.*`)

| Lexicon | Purpose |
|---|---|
| `app.openxiv.paper` | A preprint record. Authors, categories, abstract, license, blobs (PDF, source, HTML). |
| `app.openxiv.summary` | Plain-language summary at `school` / `undergrad` / `expert` tier. Required on submission. |
| `app.openxiv.disclosure` | Structured AI-use disclosure (`level`, `aiUsed`, `models`, attestation). |
| `app.openxiv.post` | Short post or thread reply. Shape-compatible with `app.bsky.feed.post` so Bluesky clients render it. |
| `app.openxiv.review` | Open review with verdict + confidence. |
| `app.openxiv.endorsement` | Typed verb endorsement: `verified-derivation`, `reproduced-result`, `checked-references`, `useful-background`, `important-but-flawed`, `needs-correction`. |
| `app.openxiv.citation` | Directed citation, builds the citation graph. |
| `app.openxiv.preprint` | Lighter-weight record used for the federated preprint timeline. |
| `app.openxiv.prereg` | Pre-registered hypothesis (research question, prediction, analysis plan, frozen at timestamp). |

JSON schemas live in `packages/lexicons/schemas/`. Zod validators live in `packages/lexicons/src/`.

## Submit saga (6 stages)

The submit wizard hands off to a BullMQ saga. Each stage is idempotent and
persists its outcome in `submission_sagas`. A per-stage retry endpoint is
available to the submitter and to admins.

1. `S1 ops_created`: compile (tectonic), upload PDF + HTML to S3, run GROBID for metadata, extract keywords with the KeyBERT-style client, run the undisclosed-AI detector when `level=none`.
2. `S2 ops_approved`: transition status to `pending_review` (single-instance MVP auto-approves; replace with a moderator gate once the instance opens up).
3. `S3 id_assigned`: atomic allocation of `openxiv:{primary_category}.{year}.{NNNNN}`.
4. `S4 pds_paper`: `com.atproto.repo.putRecord` of `app.openxiv.paper` into the author's PDS, status flips to `published`.
5. `S5 pds_summary_disclosure`: `app.openxiv.summary` + `app.openxiv.disclosure` records into the author's PDS.
6. `S6 bluesky_bridge`: `app.openxiv.post` referencing the paper, persisted locally so it shows in the OpenXiv feed and is mirrored to the author's `app.bsky.feed.post` bridge record.

## OAI-PMH and library indexing

The OAI-PMH 2.0 endpoint is at [`https://openxiv.net/oai-pmh`](https://openxiv.net/oai-pmh).

Supported verbs: `Identify`, `ListMetadataFormats`, `ListSets`, `ListIdentifiers`, `ListRecords`, `GetRecord`. Metadata format: `oai_dc`. Deleted-record strategy: `transient`. Resumption tokens are stateless and embed `until`, `from`, `set`, and `metadataPrefix` so harvesters can resume mid-page without server state.

The endpoint is validated by [BASE OVAL](https://oval.base-search.net/) and indexed by:

- [BASE](https://www.base-search.net/), Bielefeld Academic Search Engine.
- [CORE](https://core.ac.uk/), Open Access aggregator.
- Bluesky directory of custom feeds.
- [Wikidata](https://www.wikidata.org/wiki/Q139860032), preprint server entry with ISSN, language, country, headquarters, Bluesky handle.

OpenDOAR submission is in progress.

## Bluesky feed generator

`apps/feed-generator/` is a standalone Fastify service that serves the
Bluesky feed-generator XRPC surface:

```
GET /.well-known/did.json                              did:web document
GET /xrpc/app.bsky.feed.describeFeedGenerator          lists feeds
GET /xrpc/app.bsky.feed.getFeedSkeleton?feed=at://...  returns skeleton
```

Six feeds are published under `did:web:openxiv.net`:

- `openxiv-latest`: every new paper as it lands.
- `openxiv-featured`: editor picks.
- `openxiv-questions`: open questions from researcher threads.
- `openxiv-disclosed`: papers with explicit AI disclosure (`assistant` and above).
- `openxiv-beginner`: papers with the strongest "school tier" explainer score.
- `openxiv-claims`: papers with at least one typed `verified-derivation` or `reproduced-result` endorsement.

The skeleton references the bridged `app.bsky.feed.post` URIs
(`paper_versions.bsky_post_uri`) so the Bluesky App View hydrates embed
cards natively.

## arXiv overlay browser extension

`apps/extension/` is an MV3 content script for Chrome, Edge, and Firefox.
On any `https://arxiv.org/abs/*` page it injects a sidebar with the
matching OpenXiv paper's Trust Passport lane badges, or a "submit to
OpenXiv" CTA if there is no match.

Install in developer mode:

1. Open `chrome://extensions` or the browser equivalent.
2. Enable Developer mode.
3. Load unpacked, point at `apps/extension`.
4. Open the extension's Options page and set the API base URL (default `http://localhost:4000` for dev).
5. Visit any `arxiv.org/abs/{id}` page.

Icons (`icon-16.png`, `icon-48.png`, `icon-128.png`) are placeholders;
swap before publishing to the Web Store.

## Quick start (Docker)

```bash
cp .env.example .env       # the defaults already match docker-compose
docker compose up --build  # first build ~3 min, subsequent starts ~10s
```

After the stack is healthy:

- **Web**: <http://localhost:4321>
- **API + OpenAPI docs**: <http://localhost:4000/docs>
- **OAI-PMH**: <http://localhost:4000/oai-pmh?verb=Identify>
- **Feed generator**: <http://localhost:4400/.well-known/did.json>
- **MinIO console**: <http://localhost:9001> (`minioadmin` / `minioadmin`)
- **GROBID**: <http://localhost:8070>
- **Postgres**: `postgres://openxiv:openxiv@localhost:5432/openxiv`
- **Redis**: `redis://localhost:6379`

Drizzle migrations run automatically on first start
(`packages/db/drizzle/0000_init.sql` and later).

Mock clients are on by default (`USE_MOCK_CLIENTS=true`) so the full
submit pipeline works without Gemini, ORCID, or a real tectonic image.
Switch them off individually as you wire real providers.

### Happy path, end to end

1. Visit <http://localhost:4321/auth/sign-in> and pick **Continue with ORCID** (mock; instantly logs you in as a seeded test author).
2. Go to **/submit** and walk through the 6-step wizard. Drop any `.tex`, `.pdf`, or `.tar.gz` as the source.
3. The API stores source to MinIO, creates a `papers` row in `compiling` state, writes the disclosure + summary, ensures a `submission_sagas` row, and enqueues a BullMQ saga job.
4. The worker runs the 6-stage saga, marking each stage done in `submission_sagas`.
5. Paper page is at `/abs/{openxiv-id}` (for example `/abs/cs.AI.2026.00001`). The page shows the AI-disclosure badge, the three explainer tabs (school, undergrad, expert), the Trust Passport, the Provenance Timeline, and per-stage retry buttons for the submitter and admins.
6. Owner profile lives at `/@{handle}` with unified All / Papers / Posts tabs, ORCID and moderator badges.

## Development

```bash
pnpm install
pnpm dev                # API only (port 4000)
pnpm dev:web            # Web only (port 4321)
pnpm dev:workers        # Worker only
pnpm dev:all            # All apps in parallel

pnpm typecheck
pnpm lint
pnpm test               # unit + property tests across the workspace
pnpm test:e2e           # Playwright happy path (requires docker compose up)
pnpm build              # build all packages then all apps
pnpm format             # prettier
```

Run migrations against a local Postgres without containers:

```bash
DATABASE_URL=postgres://openxiv:openxiv@localhost:5432/openxiv \
  pnpm db:migrate
```

Regenerate a new migration after editing the Drizzle schema:

```bash
pnpm db:generate
```

For a first-day setup checklist, see [`docs/dev/ONBOARDING.md`](docs/dev/ONBOARDING.md).
For production restart, secret rotation, and restore steps, see
[`docs/ops/RUNBOOK.md`](docs/ops/RUNBOOK.md).

## Configuration

All config is validated by `packages/shared/src/env.ts` (zod) on startup.
In production the app fails fast on unsafe mock flags, wildcard CORS,
localhost public bases, missing required provider credentials, and
default MinIO credentials. See [`.env.example`](.env.example) for the
full list. Highlights:

- `USE_MOCK_CLIENTS=true` flips every external to its in-process mock.
- `USE_MOCK_LLM`, `USE_MOCK_GROBID`, `USE_MOCK_TECTONIC`, `USE_MOCK_LATEXML`, `USE_MOCK_DETECTOR`, `USE_MOCK_ORCID`, `USE_MOCK_BLUESKY` toggle individual services.
- `DETECTOR_*_WEIGHT` re-weights the undisclosed-AI ensemble.
- `ADMIN_DIDS` and `SUBMIT_ALLOW_DIDS` are comma-separated DID lists for admin and submit gates.
- `JETSTREAM_URL` points at the public Bluesky jetstream relay for the firehose subscriber.
- `OPENXIV_FLAG_LEGACY_UNPREFIXED_MOUNT=0` retires the legacy unprefixed API surface (default 1 during the migration window).

## Tests

- **Unit (vitest)**: every package and app has a `test` script. Run all with `pnpm test`.
- **Property-based (fast-check)**: invariants on the disclosure lexicon (`packages/lexicons/src/disclosure.property.test.ts`). Non-`none` levels must populate `aiUsed` and `models`. `none` must leave them empty. Cross-listing rules on the paper lexicon are property tested in `paper.crossListings.test.ts`.
- **Contract**: JSON lexicons are validated against the corresponding zod schemas via the validator tests in `packages/lexicons`.
- **Integration**: route-level tests under `apps/api/src/routes/*.test.ts` cover the OAI-PMH verbs, the Bluesky starter pack, the moderation flow, account linking, profile assembly, and the events log.
- **E2E (Playwright)**: `e2e/tests/happy-path.spec.ts` drives the full flow. Sign-in, submit, poll for worker completion, publish, see on home feed.

CI runs the unit job on Node 22 and 24, then the E2E job through
`docker compose up`. See [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Production deployment

The single live instance runs on a Contabo Cloud VPS with Caddy 2 in
front of `docker-compose.production.yml`. The compose file pins the API
to the multi-stage image built from `apps/api/Dockerfile` and the web
to `apps/web/Dockerfile`; workers reuse the API image with a different
entrypoint (`worker.ts`). The feed generator runs as its own service so
it can be put behind its own subdomain.

Backups: nightly `pg_dump` to an off-site S3, snapshot retention 30
days. Object storage in production is Hetzner Object Storage,
S3-compatible, region `eu-central`.

Observability is opt-in. Set `SENTRY_DSN` to ship server errors.
Logs are JSON via pino in production; dev uses `pino-pretty`.

For the full topology, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
For incident response and rotation, see [`docs/ops/RUNBOOK.md`](docs/ops/RUNBOOK.md).

## Single-owner mode

OpenXiv MVP is a single-instance deployment with one owner who is also
the only moderator. Wire it via env:

```
ADMIN_DIDS=did:plc:zxyourblueskydid000000001
SUBMIT_ALLOW_DIDS=did:plc:zxyourblueskydid000000001
```

On first sign-in the owner's DID is auto-promoted to `moderator` and
shown with a badge in the header. With `SUBMIT_ALLOW_DIDS` set, only
listed DIDs can hit `POST /api/submissions` and random visitors get a
403. Leave it empty for open submissions.

## Auth flows

- **Mock** (default in dev): the OAuth `authorize` endpoint returns a relative URL with a base64-encoded test profile in `code`. The Astro app proxies `/api-proxy/auth/dev/mock-callback` to the API so cookies land on the web origin. Logging in instantly creates `A. Author` and starts a session.
- **ORCID** (real): register at <https://orcid.org/developer-tools> or <https://sandbox.orcid.org/developer-tools> for testing. Set `ORCID_CLIENT_ID`, `ORCID_CLIENT_SECRET`, `ORCID_USE_SANDBOX=true` for sandbox, and flip `USE_MOCK_ORCID=false`. Callback URL must match the public web base, for example `https://openxiv.net/api-proxy/auth/orcid/callback`.
- **Google** (real): register at <https://console.cloud.google.com/apis/credentials>. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Callback `${PUBLIC_WEB_BASE}/api-proxy/auth/google/callback`.
- **Bluesky** (real): AT Protocol OAuth (client metadata URL or pre-registered client id). The wire format sits in `packages/clients/src/oauth/bluesky.ts`; production should adopt `@atproto/oauth-client-node` for DPoP, PAR, and refresh rotation.
- **Mastodon** (cross-post link only): the `auth-mastodon` route lets an authenticated OpenXiv user link a Mastodon account so the optional cross-post worker can mirror new paper posts to a Mastodon instance.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for local setup, the small-commit
PR policy, and the TypeScript strict baseline. The project follows
the [Contributor Covenant 2.1](CODE_OF_CONDUCT.md).

Security reports: see [`SECURITY.md`](SECURITY.md). Private vulnerability
reports go to the operator address in `apps/web/public/humans.txt`.

For architecture context before sending a PR, read
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and the matching policy
documents under [`docs/policy/`](docs/policy/).

## License

[AGPL-3.0-or-later](LICENSE). Any modified version that talks to users
over a network must publish its source under the same license.

This project is a single-operator instance run by David Alfyorov in
Vilnius, Lithuania. Source is open. The data and the indexed records
remain in each author's PDS under their own control.
