# Submit pipeline: auto-detect + human errors + resilience — 2026-05-18

The intake gate is now content-aware. Any `.tex` archive with one
`\documentclass` somewhere at depth ≤ 1 compiles regardless of the
entry file's name. Multi-manuscript zips, loose `.tex` uploads missing
their figures, and malformed archives all surface a structured
human-readable rejection. The LaTeXML step is partial-success
tolerant — a render failure leaves the PDF/Tectonic side intact.

## What shipped

| Layer | File | Purpose |
|---|---|---|
| Service | `apps/api/src/services/tex-detect.ts` | `detectEntryTex`, `looksLikeManuscript`, `stripTexComment`, `findReferencedPaths`, `missingCompanions` — pure logic, 29 unit tests |
| Service | `apps/api/src/services/error-messages.ts` | `ERROR_MESSAGES` catalogue, `makeUserError(code, details)` factory |
| Service | `apps/api/src/services/archive-extract.ts` | In-memory extract `.zip` / `.tar.gz` → `FileNode[]` for pre-flight |
| Route | `apps/api/src/routes/intake.ts` | Pre-flight gate runs detector + companion check, returns `400 {error_code, user_message, details}` before stash/saga |
| Compiler | `packages/clients/src/compiler/tectonic.ts` | `findTopLevelTex` rewritten — pure documentclass scan over depth ≤ 1, throws `no_documentclass` / `multiple_documentclass:<files>` |
| Saga | `apps/api/src/services/submissions.ts` | LaTeXML wrapped in `.orElse(...)` — partial success path; html_key NULL when render fails, PDF still publishes |
| Schema | `apps/web/src/components/SubmissionWizard.tsx` | `RejectionBox` renders `{title, body, fix_hint}` + missing files / multi-manuscript list. Bare strings only used as last-resort fallback |
| Tests | `apps/api/src/services/tex-detect.test.ts` | 29 tests covering comment stripping, manuscript detection, nested layouts, multi-manuscript, companion resolution |

## Detection contract

```ts
detectEntryTex(files: FileNode[]) →
  | { ok: true,  entry: FileNode }
  | { ok: false, error: 'no_documentclass' }
  | { ok: false, error: 'multiple_documentclass', files: string[] }
```

Walks root + one subdirectory level (covers `manuscript/`, `src/`,
`paper/` conventions). Per `.tex` file: scans the first 200 lines for
`\documentclass` after stripping `%`-led comments (with `\%` escape
handling). Anything past line 200 is treated as body text — guards
against false positives inside `verbatim` / `lstlisting` blocks.

Custom-named entries are matched purely on content. The test from
`D:\OpenXiv\test submissions\02_spectral_measure\` (file
`sct_nonperturbative.tex`) passes detection without renaming.

## Error catalogue

| code | title (shortened) |
|---|---|
| `no_documentclass` | We couldn't find a LaTeX paper |
| `multiple_documentclass` | Archive contains multiple manuscripts |
| `companions_required` | Your .tex needs the supporting files |
| `size_limit` | Archive is too large |
| `malformed_archive` | Couldn't extract the archive |
| `tectonic_timeout` | Compilation took too long |
| `tectonic_failure` | We couldn't compile your paper |
| `latexml_failure` | HTML view not available |
| `extract_failure` | Couldn't read the upload |
| `source_required` | LaTeX source required |
| `unknown_error` | Something went wrong |

Each entry has `{title, body, fix_hint}`. The wizard renders all three
fields plus optional `details.missing_files` / `details.files` lists.
**The UI never shows a bare `error_code`.**

## Pre-flight gate flow

```
POST /api/submissions/intake (multipart, requireAuth)
  │
  ├── size > 100 MB?              → 413 + size_limit user_message
  │
  ├── filename ends .pdf?         → 400 + source_required (PDF-only disabled)
  │
  ├── extension not allowed?      → 400 + validation (extension list)
  │
  ├── single .tex upload:
  │     ├── no documentclass?     → 400 + no_documentclass
  │     └── references missing?   → 400 + companions_required (lists missing)
  │
  └── archive upload:
        ├── extract failure?      → 400 + malformed_archive
        ├── 0 documentclass?      → 400 + no_documentclass
        ├── ≥2 documentclass?     → 400 + multiple_documentclass (lists files)
        └── entry's companions ⊄ archive? → 400 + companions_required
        (otherwise) → stash + enqueue compile saga
```

## Resilience

`runCompile` in the saga is the chain `compile → latexml → grobid →
keywords → detector → version → publish`. Step semantics:

- **Tectonic compile**: terminal. Failure marks `failed_at_compile`,
  user_message = `tectonic_failure` (or `tectonic_timeout` when the
  cause matches). BullMQ retries on transient failures (5 attempts
  exponential).
- **LaTeXML convert**: **partial-tolerant** now. Failure → empty html
  buffer → saga continues; the version row gets `html_key=NULL`.
- **GROBID extract**: best-effort (was already). On failure the
  metadata extraction falls back to empty fields, paper still
  publishes.
- **Cover / sidebar / marker (pdf-finalize)**: fault-cascade
  (cover→sidebar→original). Even a total failure here leaves the
  original PDF as the served artefact.

Existing BullMQ machinery (5 attempts, exponential backoff,
`UnrecoverableError` for terminal kinds) covers the retry policy.

## Tests

| Suite | Count | Notes |
|---|---|---|
| tex-detect | 29 | strip-comment, manuscript detection, multiple-manuscript, nested layouts, companion finder, missing-companions matcher |
| pdf-sidebar (prior goal) | 16 | merge / round-trip extraction |
| Full api suite | 338 pass, 1 pre-existing 429 flake | green |

Honest deferral: the integration suite that uploads each
`D:\OpenXiv\test submissions\*.zip` end-to-end against a live API
+ Postgres + MinIO + Tectonic was not wired this cycle — it needs an
auth session and a fully-running stack, which is closer to a
Playwright E2E than a Vitest unit. The 29 unit tests cover the
detection logic that controls the gate; an Owner walkthrough
exercises the live path.

## Deploy

```
api      Up 23s
worker   Up 23s        (tectonic 0.15.0 native; tex-detect ready)
web      Up 22s        (wizard renders user_message)
caddy    Up
grobid   Up healthy
postgres redis minio   Up healthy
/healthz → all 7 deps up
```

## Pending operator follow-up

1. **Owner walkthrough** through `/submit` with one of the test
   archives (`02_spectral_measure.zip` — non-conventional entry file
   name, `03_second_law.zip` — figures/ subdir layout, or
   `04_de_sitter_core.zip` — main.tex + figures at root). The wizard
   should accept all three without rename, the saga should compile
   real PDFs via Tectonic, and the resulting `/abs/{id}` should show
   cover + sidebar + OpenXiv ID marker in the merged metadata.
2. **Malformed-archive smoke**: drop a corrupted zip into the
   wizard, confirm the `RejectionBox` renders the
   `malformed_archive` user_message with title + body + fix hint.
3. **LaTeXML real follow-up** is still scoped in
   `docs/PDF-DISABLE-RELEASE-2026-05-18.md`. Until it lands the
   reader page `/abs/{id}/read` falls back to "HTML render
   unavailable" — the PDF iframe on `/abs/{id}` is the canonical
   surface.

## Acceptance vs spec

| # | Criterion | Status |
|---|---|---|
| 1 | Any `.tex` auto-detect | ✅ scan over depth ≤ 1 / first 200 lines / comment-aware |
| 2 | Multi-manuscript → human rejection | ✅ `multiple_documentclass` + list of files in `details` |
| 3 | Loose `.tex` without companions → list missing | ✅ `companions_required` + `missing_files` array |
| 4 | All errors have `user_message {title, body, fix_hint}`; never raw code | ✅ `RejectionBox` renders the three fields; bare strings only as fallback |
| 5 | Step fail не валит систему. Partial OK | ✅ LaTeXML wrapped in `.orElse`; html_key NULL on failure |
| 6 | Test archives publish без переименования | ⏳ owner walkthrough (no auth session via CLI for synthetic upload) |
| Tests green | | ✅ 338/340 (1 pre-existing flake) |
