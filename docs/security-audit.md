# Security Audit

Run date: 2026-05-20.

Scope: files under `D:\OpenXiv` after local Git initialization.

The repo is an empty local Git repository on branch `main`. It has no commits
and no remotes. Secret checks used direct tree scans plus `git check-ignore`
for local credential files.

Generated dependency and build folders were skipped by the regex scan because
they are covered by ignore rules: `node_modules`, `dist`, `build`, `.astro`,
`.turbo`, `.cache`, `output`, `.next`, `coverage`, `playwright-report`, and
`test-results`.

Allowed public values were not treated as findings:

- Contabo IP `173.212.216.82`.
- ORCID public client id `APP-DV7EGBENG4396AG9`.
- Google public client ids beginning with `1049592257926-`.

## Findings

| Path | Line | Type | Status |
| --- | ---: | --- | --- |
| `openxiv-secrets.md` | 15 | Server root password in a repo-root note | Fixed. The file was redacted and is now explicitly ignored. |
| `ssh-key-2026-05-17.key` | 1 | Local SSH private key file in repo root | Not committed. The file is ignored by `*.key`; keep it out of the first push. |
| `ssh-key-2026-05-17.key.pub` | 1 | Local SSH public key file in repo root | Not committed. The file is ignored by `*.key.pub`; keep it out of the first push. |

## Review Notes

The local `.env`, `.env.server`, `apps/api/.env`, and `apps/web/.env` files
contain operator secrets or local credentials. They are ignored by `.gitignore`
and should stay local.

`git status --short --branch` shows a fresh repo with public source files
untracked for the first commit. It does not show ignored credential files,
local archives, screenshots, PDFs, documents, `_legacy`, `.claude`, or build
output.

The post-redaction regex scan found no hardcoded API key, JWT secret, OAuth
client secret, database password, or S3 secret literal in first-party source.
Remaining matches were ignored environment files, placeholder values in
`.env.example`, variable names, tests, or code that passes values from
`process.env`.

No key rotation was performed.
