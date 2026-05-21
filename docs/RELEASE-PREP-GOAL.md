# OpenXiv first public GitHub release: codex goal

The repository has never been pushed to GitHub. There is no history to scrub. No keys have leaked. This document is the full instruction set for the codex agent. The short /goal command points here.

Goal: prepare the working tree so a clean first push produces a presentable open source project, with everything in place for mass discoverability on day one.

README.md is OUT OF SCOPE for this goal. The operator will write the real README in a separate goal. Touch README.md only to create a one-line placeholder if nothing exists.

## Voice rules (apply to every file you write or edit)

Mirror the prose in apps/web/src/pages/about.astro and apps/web/src/pages/policies/*. Short declarative sentences. No em dashes anywhere; use commas, periods, parentheses, or semicolons. Banned words: leverage, robust, seamless, comprehensive, delve, navigate the complexities, best-in-class, the trade-off is, concrete differences. No numbered-pattern lists like "(1) X. (2) Y. (3) Z." Do not overpromise capability. Do not underpromise it either. State what works, state what does not, move on. No emoji. No product-brochure copy.

## Tasks

### 1. Secret audit (source tree only)

Repo has never been pushed publicly. There is no leaked history. Walk every tracked and untracked file under the repo root. Flag hardcoded API keys, JWT/session secrets, OAuth client_secrets, DB passwords, S3 access keys. Do NOT flag the following, which are intentionally public: Contabo IP 173.212.216.82, ORCID client_id APP-DV7EGBENG4396AG9, Google client_id 1049592257926-*. Report findings at docs/security-audit.md with file path and line number. Fix in place by moving the literal value to .env and replacing with a process.env reference. Do not rotate any keys; they have never been exposed.

### 2. .env.example at repo root

Include every variable read by parseEnv in packages/shared/src/env.ts. One line per variable, one short comment, empty or clearly non-production placeholder. Group by section: database, redis, auth providers, storage, llm, indexing, public urls.

### 3. LICENSE

AGPL-3.0-or-later. Add the full text from gnu.org/licenses/agpl-3.0.txt verbatim at repo root. Update every package.json across the workspace to declare "license": "AGPL-3.0-or-later". Do not add per-file SPDX headers.

### 4. Standard files

CONTRIBUTING.md, under 150 lines: how to set up locally, how to run tests (pnpm test), PR guidelines (small focused commits, no force-push to shared branches), the TypeScript strict baseline, what is in/out of scope (single-moderator MVP, no multi-tenant work).

CODE_OF_CONDUCT.md: Contributor Covenant 2.1 verbatim. Use the contact email from /humans.txt. Do not invent a new address.

SECURITY.md: short. Private vulnerability reports to the same email. 72-hour expected first response. Supported versions: main branch only.

### 5. .github/ structure

- ISSUE_TEMPLATE/bug_report.md (what happened, what you expected, repro steps, environment, paper id if applicable)
- ISSUE_TEMPLATE/feature_request.md (problem, proposed solution, alternatives considered)
- ISSUE_TEMPLATE/config.yml (blank_issues_enabled: false)
- PULL_REQUEST_TEMPLATE.md (what, why, tests added, breaking yes/no)

Do not add FUNDING.yml unless a funding link already exists in the workspace.

### 6. .gitignore audit

Confirm coverage of: .env*, node_modules, dist, build, .astro, .turbo, .DS_Store, *.log, coverage, .pnpm-store, .vscode (allow shared settings.json if it exists), .idea, .cache. Add anything critical that is missing. Remove nothing.

### 7. Discoverability prep (the main deliverable beyond hygiene)

Create docs/GITHUB-RELEASE-PREP.md for the operator (not for end users):

(a) Three repository description variants, each one sentence, under 350 chars, no em dashes, no marketing words. Each should be ready to paste into the GitHub repo About field.

(b) GitHub Topics, 12 to 18 tags, ordered by expected impact for discoverability. Starting set to pick from and reorder: atproto, bluesky, preprint, preprint-server, scholarly-communication, open-science, scholcomm, oai-pmh, federated, federation, typescript, astro, fastify, nodejs, postgresql, drizzle-orm, self-hostable, latex, openaccess. Annotate each with a one-line reason. Output as a copy-pasteable comma-separated string at the bottom of the file.

(c) GitHub linguist override. Linguist tends to misdetect Astro as HTML which inflates the HTML percentage on the language bar. If override is needed, write the .gitattributes lines (e.g. "*.astro linguist-language=Astro").

(d) Social preview image spec: 1280x640 PNG. OpenXiv logo from /brand/logo-full.svg on dark background, openxiv.net visible at the bottom, no marketing text. Describe the layout. Do not generate the image.

(e) First-release file list (what must exist when the operator does git push): README.md (placeholder line only, real content written in a separate goal), LICENSE, CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md, .env.example, package.json, pnpm-workspace.yaml, docs/ARCHITECTURE.md.

(f) Pre-push verification checklist: secret audit clean, .env.example complete, license declared in every package.json, pnpm typecheck green, pnpm test green, pnpm build for web green, no debugger or console.log in production paths.

### 8. docs/ARCHITECTURE.md

If it exists, audit for em dashes and banned words; fix in place. If missing, write 200 to 400 lines of plain prose covering: each app (apps/api, apps/web, apps/worker, apps/feed-generator), each shared package (db, shared, lexicons, clients), the submit saga flow at high level, where AT-proto records live in the author PDS, deployment topology (docker-compose on Contabo with Caddy 2).

### 9. Verification

After changes:

- pnpm typecheck across all 7 packages, must be green
- pnpm test across all packages, must be green; mark tests that need production env vars as such and skip cleanly when those vars are absent
- pnpm build for the web app (Astro), must be green
- git status shows only expected files
- Grep the tree for TODO, FIXME, XXX in user-visible code paths and surface findings in the release checklist
- Generate docs/RELEASE-CHECKLIST.md summarising what landed and what the operator must verify manually before the first push

## Do not

- Write README.md beyond a single placeholder line. The operator writes the real README in a separate goal.
- Run git filter-repo or rewrite history. The repo has never been pushed.
- Rotate or regenerate any API keys.
- Touch production server configuration.
- Add emoji, em dashes, or marketing words to any file you create.
- Enable GitHub Discussions, Sponsors, or Codespaces.
- Push to any remote. The operator runs git push manually.

## Out of scope

README.md content. Release announcement copy. Repository creation on GitHub. Branch protection setup. CI/CD changes beyond what already exists in the workspace.
