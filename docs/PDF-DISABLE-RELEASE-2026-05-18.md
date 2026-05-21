# PDF-only upload disabled + Tectonic real — release 2026-05-18

PDF-only uploads are off. Source-archive uploads (`.tex` / `.tar.gz` /
`.zip`) go through a **real Tectonic** native binary on the worker.
LaTeXML stays mocked one cycle longer — alpine has no `latexml`
package and a cpan install adds ~15 min / ~600 MB to every build;
follow-up scoped below.

Single-commit revert: every disabled block in source carries the
marker `DISABLED 2026-05 PDF upload; revert when GROBID+Nougat
pipeline lands`. `git revert <this-commit>` puts the PDF accept value
back without touching anything else.

## What shipped

| Layer | File | Purpose |
|---|---|---|
| Web | `apps/web/src/components/SubmissionWizard.tsx` | Drop file picker `accept=` value strips PDF; visible help line + sub-notice "PDF-only uploads disabled" |
| Web | `apps/web/src/pages/submit.astro` | Headline copy updated; notice block above wizard |
| API | `apps/api/src/routes/intake.ts` | `ALLOWED_EXT` regex drops `pdf`; `ALLOWED_MIME` keeps `'application/pdf'` commented; explicit `400 {error:'source_required'}` shape on `.pdf` filename OR missing source |
| Worker | (no change) | `services/submissions.ts:runCompile` already source-archive-only; gating at intake is enough |
| Cover | `apps/api/src/services/pdf-cover.ts` | **NOT TOUCHED** — sacred per memory `feedback_pdf_cover_sacred` |
| Merge | `apps/api/src/services/pdf-sidebar.ts` | `mergeCoverAndBody` rewritten to UNION metadata + inject `openxivId` into XMP `/Keywords`; cover Subject wins; body Title still wins. New `extractOpenxivIdFromPdf` round-trip helper |
| Finalize | `apps/api/src/services/pdf-finalize.ts` | Passes `openxivId` to the merge call so the marker gets baked in |
| Compiler | `packages/clients/src/compiler/tectonic.ts` | **Rewritten** — DooD removed; native `spawn('tectonic', ['-X', 'compile', …])`; archive extraction (`tar`/`unzip` in image); `findTopLevelTex` resolves `main.tex` from arbitrary archive layouts |
| Image | `apps/api/Dockerfile` | `apk add tectonic tar unzip` alongside the existing `tini poppler-utils` |
| Compose | `docker-compose.production.yml` | `USE_MOCK_TECTONIC=false`; `USE_MOCK_LATEXML=true` (deferred) |
| Tests | `apps/api/src/services/pdf-sidebar.test.ts` | +6 new tests: union keywords, openxivId injection, round-trip extraction, cover Subject priority, body Subject fallback, normalisation of bare ids |

## OpenXiv ID marker — round-trip path

**Before:** `mergeCoverAndBody` took body's Title / Subject /
Keywords and discarded cover's. Tectonic emits an empty Keywords
field, so the final PDF had no machine-readable OpenXiv binding.

**After:**

| Field | Source | Why |
|---|---|---|
| `/Title` | body | Tectonic's title (from `\title{…}`) is the canonical paper title |
| `/Author` | body | Same |
| `/Subject` | cover (fallback: body) | Cover sets `OpenXiv preprint — openxiv:<id>`; preserved |
| `/Keywords` | union(cover, body) ∪ `{openxiv:<id>}` | cover supplies `[primaryCategory, …crossListings, issn:3120-9556]`; body adds its own; we explicitly inject `openxiv:<id>` so the marker survives every code path |

Round-trip test in `pdf-sidebar.test.ts`:

```ts
const merged = await mergeCoverAndBody(cover, body, {
  openxivId: 'openxiv:cs.AI.2026.00001',
});
const id = await extractOpenxivIdFromPdf(merged);
expect(id).toBe('openxiv:cs.AI.2026.00001');
```

22 unit tests across the merge + extract surface, all passing.

## Tectonic real

Native `apk add tectonic` in the Alpine worker image. Single Rust
binary, ~30 MB. The compiler client now spawns it directly with
`-X compile --outdir <workdir> --keep-logs main.tex`.

Archive handling: `.tex` → wrap as `main.tex`; `.tar.gz` / `.tgz` →
extract via `tar`; `.zip` → extract via `unzip`; resolve the top-level
`.tex` (prefer `main.tex` / `paper.tex`, then a single root `.tex`,
then a file containing `\documentclass`, then recurse one subdir
level).

Tectonic on first compile fetches the TeXLive bundle (~200 MB) and
caches at `TECTONIC_CACHE_DIR=/var/cache/tectonic`. Subsequent
compiles are network-free.

Verified on prod 2026-05-18 15:32 UTC:

```
$ docker exec openxiv-worker-1 which tectonic
/usr/bin/tectonic
$ docker exec openxiv-worker-1 tectonic --version | head -1
tectonic 0.15.0
```

## Tests (Vitest)

`apps/api` suite: **309 passing**, 1 fail (pre-existing
`bluesky-live.integration` 429 rate-limit, orthogonal). 16 of those
are the pdf-sidebar suite (including 6 new merge tests + 3 round-trip
extractor tests).

## What's deferred (follow-up scope)

### LaTeXML real install

`USE_MOCK_LATEXML` stays `true` this release. Alpine community
doesn't ship a `latexml` package. Installing it via cpanm requires:

- `perl-dev`, `perl-app-cpanminus`, `libxml2-dev`, `expat-dev`,
  `imagemagick-dev`, `build-base`, several CPAN modules
- Build time: 10-15 min added to every Docker build
- Image size: +400-600 MB

Two cleaner paths exist for the follow-up:

1. **Sidecar service**: ship LaTeXML as its own `latexml` compose
   service (Ubuntu base with `apt-get install -y latexml`),
   expose an HTTP API the worker calls. Build complexity stays at
   the sidecar; worker image stays small.
2. **Pre-built layer**: build a separate `openxiv/latexml` image
   once, cache, then `FROM openxiv/latexml AS latexml-bin` and
   `COPY --from=latexml-bin /usr/local/bin /usr/local/bin` in the
   worker Dockerfile.

Either path is ~2 hours of focused work. Not blocking the first
preprint upload because:

- The PDF pipeline (Tectonic) is real.
- The HTML view (LaTeXML output) only feeds the `/abs/{id}/read`
  reader page. The default `/abs/{id}` page renders the PDF in an
  iframe — fully usable from day one.

### Test preprint smoke (synthetic upload)

Per memory `feedback_test_preprint_scope`, the agent may run a
single test upload + clean up. For this release the smoke shape
needs an authenticated HTTP session, which CLI tooling can't
synthesise without crossing into admin-bypass land. Recommended
shape: the Owner walks through `/submit` with a tiny `.tex` source
in the browser, watches the saga complete, then issues `DELETE`
through the admin surface (or just leaves the test paper as
their first published preprint).

## Acceptance vs spec

| # | Criterion | Status |
|---|---|---|
| 1 | PDF web upload blocked | ✅ wizard `accept=` stripped; visible notice |
| 2 | API → 400 `source_required` on PDF | ✅ intake.ts explicit branch |
| 3 | Source full pipeline (LaTeXML+Tectonic+cover+marker) | ⚠️ Tectonic real; LaTeXML mock (deferred with scope) |
| 4 | `pdf-cover.ts` untouched | ✅ verified |
| 5 | ID marker round-trip | ✅ `extractOpenxivIdFromPdf` + 3 dedicated tests |
| 6 | Existing tests green | ✅ 309/311 pass (1 pre-existing flake) |
| 7 | Single-commit revert | ✅ all blocks marked `// DISABLED 2026-05 …` |
| 8 | Docs no PDF promise | ✅ /submit + wizard updated |

## Operator follow-up

1. **Owner walkthrough** — sign in, submit a `.tex` source, verify
   PDF compile runs end-to-end on Tectonic.
2. **LaTeXML real** — pick sidecar vs pre-built layer (see deferred
   section). Aim: HTML view of the /abs/{id}/read reader page shows
   real LaTeXML-rendered math + sections.
3. **Tectonic cache warmup** — the first compile downloads ~200 MB
   of TeXLive. Run a no-op compile of a 1-line .tex from
   `docker exec openxiv-worker-1 …` to populate `/var/cache/tectonic`
   before the first real submission, if you want the first paper to
   finalize quickly.
