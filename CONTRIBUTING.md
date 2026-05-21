# Contributing

OpenXiv is a TypeScript monorepo. It runs an Astro web app, a Fastify API,
BullMQ workers, shared packages, and a Playwright E2E package.

## Local setup

- Use Node 22 or newer.
- Enable pnpm through Corepack.
- Install dependencies with `corepack.cmd pnpm install`.
- Copy `.env.example` to `.env`.
- Fill only the values you need for the path you are testing.
- Start local services with `docker compose up -d postgres redis minio grobid`.
- Run the API with `corepack.cmd pnpm dev`.
- Run the web app with `corepack.cmd pnpm dev:web`.
- Run workers with `corepack.cmd pnpm dev:workers`.

## Tests

- Run all unit and package tests with `corepack.cmd pnpm test`.
- Run type checks with `corepack.cmd pnpm typecheck`.
- Run the web build with `corepack.cmd pnpm --filter @openxiv/web build`.
- Run E2E tests with `corepack.cmd pnpm test:e2e` when the local stack is up.
- Tests that need production accounts or external secrets must skip cleanly
  when those variables are absent.

## Pull requests

- Keep commits small and focused.
- Explain what changed and why.
- Add or update tests for behavior changes.
- Include the commands you ran.
- Do not force-push to shared branches.
- Do not include local `.env` files, private keys, database dumps, screenshots,
  build output, or archives.

## TypeScript baseline

The repo uses strict TypeScript. Keep `strict`, `noUncheckedIndexedAccess`,
`noImplicitOverride`, `noFallthroughCasesInSwitch`, and
`noPropertyAccessFromIndexSignature` green.

Do not weaken shared compiler settings to land a local change. Fix the type
instead.

## Current scope

In scope:

- Single-moderator MVP workflows.
- One public OpenXiv instance.
- AT Protocol records, Bluesky bridge work, OAI-PMH, and public paper pages.
- Local-first development with Docker Compose.

Out of scope:

- Multi-tenant hosting.
- Organization accounts.
- GitHub Sponsors, Discussions, and Codespaces.
- Production server configuration changes without operator approval.
