# Release Checklist

Run date: 2026-05-20.

This checklist summarizes the first public GitHub release prep work. The
operator still owns the final Git review and push.

## Landed

- Added `LICENSE` with AGPL 3.0 text from GNU.
- Added `license: AGPL-3.0-or-later` to every workspace `package.json`.
- Rebuilt `.env.example` from `packages/shared/src/env.ts`.
- Added `CONTRIBUTING.md`.
- Added `CODE_OF_CONDUCT.md` from Contributor Covenant 2.1 with the contact
  email from `apps/web/public/humans.txt`.
- Added `SECURITY.md`.
- Added GitHub bug and feature issue templates.
- Added GitHub pull request template.
- Added `.gitattributes` for Astro language detection.
- Expanded `.gitignore` for `.pnpm-store`, local output, Playwright MCP state,
  local archives, root screenshots, root PDFs, local documents, and the local
  credentials note.
- Added ignore rules for local root drafts, local root TeX scratch files,
  `_legacy`, OpenXiv patch file lists, and `.key.pub` files.
- Added an ignore rule for local `.claude` agent state.
- Redacted `openxiv-secrets.md`.
- Added `docs/security-audit.md`.
- Added `docs/GITHUB-RELEASE-PREP.md`.
- Added `docs/ARCHITECTURE.md`.
- Fixed the root `dev:workers` script to run the API worker entrypoint.
- Initialized local Git metadata on branch `main`. No commit was made. No
  remote was added.

## Verification

- `.env.example` coverage: `missing=none`, `extra=none` against `parseEnv`.
- Package license check: all workspace package files declare
  `AGPL-3.0-or-later`.
- Edited-file voice scan: no em dashes or banned words found.
- `docs/ARCHITECTURE.md` line count: 390.
- `CONTRIBUTING.md` line count: 60.
- `.gitignore` covers `.env`, `.env.*`, `node_modules`, `dist`, `build`,
  `.astro`, `.turbo`, `.DS_Store`, `*.log`, `coverage`, `.pnpm-store`,
  `.vscode`, `.idea`, and `.cache`.
- Secret scan: `openxiv-secrets.md:15` was fixed. Remaining sensitive matches
  are ignored `.env` files, placeholder examples, variable names, or operator
  smoke-test placeholders.
- TODO scan in user-visible code paths: no `TODO`, `FIXME`, or `XXX` matches.
- Production-path scan: no `debugger` or `console.log` matches.
- `corepack.cmd pnpm typecheck`: passed.
- `corepack.cmd pnpm test`: passed. Summary across packages was 800 passed and
  3 skipped.
- `corepack.cmd pnpm --filter @openxiv/web build`: passed.
- `git status --short --branch`: passed. It shows `No commits yet on main` and
  only public source files for the first commit.
- `git remote -v`: passed with no remotes.
- `git check-ignore -v`: confirmed local `.env` files, SSH key files,
  `openxiv-secrets.md`, local archives, screenshots, PDFs, documents,
  `_legacy`, `.claude`, and build output are ignored.

## Manual Operator Checks

- Review `README.md`. It was not edited in this goal.
- Review `openxiv-secrets.md` and keep any real credentials outside Git.
- Keep `.env`, `.env.server`, `apps/api/.env`, and `apps/web/.env` out of Git.
- Keep `ssh-key-2026-05-17.key` out of Git.
- Keep `ssh-key-2026-05-17.key.pub` out of Git.
- Decide whether to remove local archives, screenshots, PDFs, and documents
  from the working directory before creating the public repo.
- Review `docs/GITHUB-RELEASE-PREP.md`.
- Add the GitHub repository description and topics after repository creation.
- Create the social preview image manually.
- Confirm no remote is pushed until the checklist is reviewed.
