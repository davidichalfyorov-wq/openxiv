# Architecture

OpenXiv is a single-instance preprint server.

It combines a public web app, an API, background workers, shared packages,
Postgres, Redis, object storage, and AT Protocol records.

The current production target is Docker Compose on a Contabo VPS.

Caddy 2 terminates HTTP and HTTPS.

The application services run behind Caddy.

The database, Redis, MinIO, and GROBID stay internal to the Compose network.

The public site is `openxiv.net`.

The stack is built for one operator and one moderation team.

It is not a multi-tenant platform.

## Runtime Shape

The repo is a pnpm workspace.

Workspace apps live under `apps`.

Shared packages live under `packages`.

End-to-end tests live under `e2e`.

The main runtime packages are TypeScript.

The web app is Astro.

The API is Fastify.

The worker runtime uses BullMQ over Redis.

The database layer uses Drizzle ORM.

Object storage uses the S3 API.

Local development uses MinIO for S3.

Production also uses MinIO in the current Compose topology.

GROBID extracts paper metadata.

Tectonic compiles LaTeX source archives to PDF.

LaTeXML converts source into HTML where possible.

LLM clients produce summaries and related text when they are enabled.

Mock clients are allowed in local development.

Mock clients are rejected in production by the environment parser.

## Apps

### `apps/api`

`apps/api` is the server-side application.

It owns HTTP routes, auth callbacks, moderation endpoints, paper submission,
paper publishing, OAI-PMH, Bluesky bridge routes, profile routes, and API
health checks.

The API starts from `apps/api/src/index.ts`.

The server is assembled in `apps/api/src/server.ts`.

Request-wide services are built in `apps/api/src/context.ts`.

Session cookies are signed with `SESSION_SECRET`.

JWTs are signed with `JWT_SECRET`.

The API validates environment variables through `parseEnv` from
`@openxiv/shared`.

The API reads and writes paper records through `@openxiv/db`.

It writes binary objects through the storage client from `@openxiv/clients`.

It talks to ORCID, Google, Bluesky, Mastodon, GROBID, Tectonic, LaTeXML, and
LLM providers through client adapters.

Routes are split by domain under `apps/api/src/routes`.

Submission logic lives in `apps/api/src/services/submissions.ts`.

Moderation logic lives in `apps/api/src/services/moderation.ts` and
`apps/api/src/routes/moderation.ts`.

Account-linking routes handle ORCID and Mastodon links.

The API also exposes Bluesky feed skeleton support for the feed generator.

### `apps/web`

`apps/web` is the public site and signed-in user interface.

It is an Astro SSR app.

It renders the home page, paper pages, policy pages, submission flow, identity
settings, profile pages, admin pages, and moderation UI.

The app reads public URLs from environment variables.

Server-rendered pages call the API through configured base URLs.

The public `humans.txt` file lives at `apps/web/public/humans.txt`.

Brand assets live at `apps/web/public/brand`.

The public logo path is `/brand/logo-full.svg`.

Policy pages live under `apps/web/src/pages/policies`.

The about page lives at `apps/web/src/pages/about.astro`.

The release prose in this repo should match those pages: short sentences,
plain claims, and no sales copy.

### `apps/worker`

There is no standalone `apps/worker` package in the current tree.

The worker runtime is implemented by `apps/api/src/worker.ts`.

The workspace script is `corepack.cmd pnpm dev:workers`.

The production Compose service is named `worker`.

It runs the API package worker entrypoint.

Workers consume BullMQ queues from Redis.

Workers compile PDFs, extract metadata, build HTML, create summaries, publish
records, and run post-publish jobs.

Worker concurrency is set through production Compose environment variables.

The worker uses the same `parseEnv` schema as the API.

This keeps runtime validation shared between API and worker processes.

### `apps/feed-generator`

`apps/feed-generator` is a small Fastify service for Bluesky custom feeds.

It serves a `did:web` document.

It describes available feeds to the Bluesky App View.

It returns feed skeletons through
`/xrpc/app.bsky.feed.getFeedSkeleton`.

It asks the API for paper post URIs.

Bluesky hydrates those posts through its own App View.

The feed generator has its own DID and public URL settings.

The default feed generator DID is `did:web:openxiv.net`.

The default local port is `4400`.

### `apps/extension`

`apps/extension` is a static browser extension package.

It is part of the workspace.

It has no bundling step today.

It is not on the critical production path for first public release.

## Shared Packages

### `packages/db`

`packages/db` contains the Drizzle schema and repositories.

Schema files live under `packages/db/src/schema`.

Repository modules live under `packages/db/src/repositories`.

The package exports database client helpers, schema modules, and repositories.

Paper records, users, jobs, events, endorsements, profiles, labels, feeds,
figures, and moderation state all pass through this layer.

Migrations are generated by Drizzle Kit.

The production database is Postgres with pgvector enabled.

### `packages/shared`

`packages/shared` contains cross-app types and utilities.

The environment schema lives at `packages/shared/src/env.ts`.

Submission terms, categories, ids, trust lanes, result helpers, and error types
also live here.

`parseEnv` is the startup gate for API and worker processes.

Production checks reject placeholder signing secrets.

Production checks reject low-entropy signing secrets.

Production checks reject mock clients.

Production checks require HTTPS public URLs.

Production checks require explicit CORS origins.

### `packages/lexicons`

`packages/lexicons` defines OpenXiv AT Protocol record schemas.

The schemas describe papers, summaries, disclosures, endorsements, citations,
reviews, posts, profiles, and preregistrations.

The package exports validators and JSON schema data.

The API uses these schemas when creating or validating records.

The package is versioned with the rest of the monorepo.

### `packages/clients`

`packages/clients` contains external service adapters.

It includes OAuth clients.

It includes storage clients.

It includes compiler and converter clients.

It includes LLM and detector clients.

It includes circuit-breaker wrappers around external calls.

The API and worker should use this package instead of building direct provider
calls in route handlers.

## Submit Saga

The submit saga is the main paper-ingest flow.

It starts when an author submits metadata and a source archive.

The API persists the initial paper record.

The API stores the uploaded source object.

The API enqueues compile work.

The worker compiles the source archive with Tectonic.

The worker stores the compiled PDF.

The worker sends the PDF or source-derived content to GROBID.

GROBID extraction is best effort.

The worker generates or stores summaries when LLM clients are enabled.

The worker runs detector and provenance steps.

The paper moves to `pending_review`.

Manual moderation is required before public publish.

The approval checkpoint is `stagePaperApproved`.

Acceptance requires a compiled latest version.

Conditional rejection keeps the paper in review state and asks for a new
version.

Final rejection withdraws the submission path.

After approval, the saga publishes the OpenXiv paper record.

It creates or updates public web records.

It writes AT Protocol records where the linked identity allows it.

It bridges the accepted paper to Bluesky when configured.

It queues post-publish jobs such as feeds, figures, indexing, and notifications.

The local database remains the App View index for OpenXiv.

## AT Protocol Record Location

OpenXiv is an App View.

The author owns AT Protocol records in their PDS.

That PDS may be Bluesky's PDS or a self-hosted PDS.

OpenXiv indexes records that the author publishes.

OpenXiv does not own the author's PDS.

OpenXiv-native records use the `app.openxiv.*` namespace.

Paper records, summaries, disclosures, endorsements, reviews, citations, and
profile policy records use OpenXiv lexicons.

Bluesky feed posts use Bluesky lexicons.

The bridge creates embed-rich Bluesky posts for accepted papers.

The feed generator returns Bluesky post URIs, not OpenXiv-native paper URIs.

This is because the Bluesky App View hydrates Bluesky feed posts.

OpenXiv keeps its own database index so the web app and API can serve paper
pages even when external providers are slow.

## Deployment Topology

Production uses `docker-compose.yml` plus `docker-compose.production.yml`.

The host is a Contabo VPS.

Caddy 2 is the only public edge service.

Caddy listens on ports 80 and 443.

Caddy routes public web traffic to the Astro service.

Caddy routes API traffic to the Fastify service.

Caddy also fronts MinIO public download paths where configured.

Postgres is internal.

Redis is internal.

MinIO is internal except for public object delivery through Caddy.

GROBID is internal.

The API service runs with production environment variables.

The worker service runs the same package with the worker entrypoint.

The web service runs Astro SSR.

Secrets are supplied through ignored environment files on the host.

Production Compose overrides disable host ports for internal services.

Production Compose sets memory limits for the main services.

The API and worker must not run with mock clients in production.

The public URLs must be HTTPS in production.

The operator runs database migrations before or during deployment.

The operator checks `/healthz` after deployment.

## Operational Boundaries

The first public release targets a single operator.

The moderation model is small.

The first public release does not add multi-tenant hosting.

The first public release does not add organization accounts.

The first public release does not require GitHub Discussions.

The first public release does not require GitHub Sponsors.

The first public release does not require Codespaces.

README content is intentionally outside this release-prep goal.

Production server configuration is outside this release-prep goal.
