# PDF-only upload disable — audit, 2026-05-18

Punch-list of code paths that currently accept a `.pdf` source. Each
entry below points to the file + line range and the change required
to disable while preserving a one-commit revert.

## Web (form + wizard)

| File | Lines | Change |
|---|---|---|
| `apps/web/src/components/SubmissionWizard.tsx` | 546-549 | Drop "/ .pdf" from the visible help text; add notice about source-only. |
| `apps/web/src/components/SubmissionWizard.tsx` | 589 | Comment out `pdf` + `application/pdf` from the `accept=` attribute. Wrap edit with `// DISABLED 2026-05 PDF upload; revert when GROBID+Nougat pipeline lands` so the diff is one block. |

## API (intake)

| File | Lines | Change |
|---|---|---|
| `apps/api/src/routes/intake.ts` | 18-29 | `ALLOWED_MIME` keeps `application/pdf` commented (revert-marker). `ALLOWED_EXT` drops `pdf` from the regex. |
| `apps/api/src/routes/intake.ts` | 131-136 | Validation emits `Errors.validation('source must be one of: .tex, .tar.gz, .tgz, .zip — PDF-only uploads are disabled')` when failing. The 400-shape is `{error: 'source_required', message: 'LaTeX source archive required.'}`. |

The intake route hands the saga to `services/submissions.ts` which
just forwards `source.bytes` and `source.filename` — no PDF-specific
branch lives in the saga itself today. Once a `.pdf` filename can't
reach the saga (gate at intake), no further worker change is needed.

## Worker / services

| File | Note |
|---|---|
| `apps/api/src/services/submissions.ts:478-520` (`runCompile`) | Already source-archive-first: `compiler.compile()` → PDF, `latexml.convertToHtml()` → HTML, `grobid.extract()` → metadata. No PDF fallback branch. Gating at intake makes a `.pdf` reaching the saga unreachable. |
| `apps/api/src/services/intake.ts` | The intake-only stash also forwards to `compiler.compile()`. Same story. |
| `apps/api/src/services/pdf-finalize.ts` | Operates on the *already-compiled* PDF; no upload path. |

## Cover generator (sacred)

`apps/api/src/services/pdf-cover.ts` — **NOT TOUCHED.** Cover input
flows from `pdf-finalize.ts:buildCoverInput`, which sources every
field from the paper row + version row + repos. Verified: title /
authors / abstract / openxivId / doi / primaryCategory / crossListings
/ license / version / postedAt / disclosureLevel / trust all populate
from the source-upload path.

## OpenXiv ID marker

Current state:

| Surface | Source | Persists after `mergeCoverAndBody`? |
|---|---|---|
| Cover XMP `/Subject` = `OpenXiv preprint — {openxivId}` | `pdf-cover.ts:135` | **NO** — `pdf-sidebar.ts:144` overwrites with body Subject |
| Cover XMP `/Keywords` = `[primaryCategory, ...crossListings, 'issn:3120-9556']` | `pdf-cover.ts:136` | **NO** — overwritten by body keywords; also `openxivId` itself not in keywords today |
| Cover visible "Cite as: {openxivId}" | `pdf-cover.ts:616` | YES (rendered into the page bitmap) |
| Body-page sidebar `openxiv:{id}v{N} [{cat}] {date}` | `pdf-sidebar.ts:stampLeftSidebar` | YES (drawn into each body page before merge) |

**Gap:** `mergeCoverAndBody` discards cover metadata in favour of body.
Tectonic-produced PDFs typically have empty Subject and Keywords, so
the final blob's XMP is also empty.

**Fix scope (this goal):** rewrite `mergeCoverAndBody` to *union*
metadata and accept an explicit `openxivId` we inject into Keywords.
Body's Title still wins; cover's Subject + ISSN-tagged Keywords are
preserved alongside.

## Database

`paper_versions.pdf_key`, `source_key`, `final_pdf_url` — **no change**
per goal directive. Existing PDF-only rows (none today: 0 published
papers) remain readable.

## Docs

| File | Edit |
|---|---|
| `apps/web/src/pages/about.astro` | No PDF promise — verified |
| `apps/web/src/pages/submit.astro` | Update help line: source archive required |
| `apps/web/src/pages/terms.astro` | Audit; swap to source-only if needed |
| `apps/web/src/pages/privacy.astro` | No upload-format claim — no change |
| `README.md` | Replace any `.pdf` upload mention |

## Tests

| File | Change |
|---|---|
| `e2e/tests/happy-path.spec.ts` | If uploading PDF, swap to a `.tex` archive |
| API integration | Search for `mimetype: 'application/pdf'`; convert to `400 source_required` expectation |

## Compiler readiness

`USE_MOCK_TECTONIC` and `USE_MOCK_LATEXML` are currently `true` on
prod. **Not acceptable** per user clarification ("Убедись что
компилятор тоже работает безупречно. Я не шучу сейчас.").

Plan: install `tectonic` + `latexml` as native Alpine packages in the
worker image, rewrite the two client adapters to spawn binaries
directly (no `docker run`), flip env flags. Verified target: a real
`.tex` source archive uploaded through the wizard produces a real
PDF + HTML through Tectonic/LaTeXML on prod.

## Acceptance map

| Spec criterion | Phase |
|---|---|
| PDF web upload blocked | Ф1 — accept= edit |
| PDF API 400 source_required | Ф2 — intake.ts |
| Source full pipeline | Ф3+Ф6 — native binaries + ID-marker preserve |
| pdf-cover.ts not touched | Verified |
| ID marker round-trip | Ф6 — mergeCoverAndBody rewrite |
| Existing tests green | Ф8 |
| Single-commit revert | All edits use `// DISABLED 2026-05 …` markers |
| Docs no PDF promise | Ф7 |
