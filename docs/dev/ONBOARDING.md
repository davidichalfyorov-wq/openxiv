# Developer Onboarding

Target: a new developer can run OpenXiv locally in 30 minutes.

## Prerequisites

- Node 22.
- `corepack enable`.
- Docker Desktop or Docker Engine with Compose v2.
- Git, PowerShell or Bash, and enough disk for Postgres, MinIO, and GROBID.

## First Run

```bash
corepack enable
pnpm install
cp .env.example .env
docker compose up --build
```

Open:

- Web: http://localhost:4321
- API docs: http://localhost:4000/docs
- MinIO: http://localhost:9001

The local `.env.example` uses mock external clients by default. That is
intentional for onboarding; it lets signup, submit, compile, publish, and read
work without provider credentials.

## Verify The Workspace

In another shell:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @openxiv/e2e typecheck
```

Run Playwright locally only after the compose stack is healthy:

```bash
pnpm test:e2e
```

## Real Provider Work

Do not put production secrets in committed files.

- Mastodon live tests: `e2e/tests/mastodon-live.spec.ts`.
- Bluesky go-live notes: `docs/BLUESKY-GO-LIVE.md`.
- Secret storage and rotation: `docs/ops/secrets.md` and `docs/ops/RUNBOOK.md`.

When adding a new external integration, use a mock for local onboarding and a
bounded real client with timeout, retry, and graceful failure behavior.

## Common Problems

- `pnpm test` fails in `/events/track`: run DB migrations against the local
  Postgres with `pnpm --filter @openxiv/db migrate`.
- Astro typecheck asks to install `@astrojs/check`: run `pnpm install`; the
  package is part of `apps/web` dev dependencies.
- GROBID is slow on first start: wait for `docker compose ps grobid` to become
  healthy before testing PDF metadata extraction.
