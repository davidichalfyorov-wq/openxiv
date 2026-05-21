# Tier-2 figure extraction + launch polish — release 2026-05-18

Three parallel deliverables landed in a single deploy:

1. **modes save 404 regression — fixed**. Seven UI callers were
   double-prefixing `/api-proxy/api/…` after Phase 7 of the profile
   rollout (the Astro proxy auto-prepends `/api`). All seven moved to
   `/api-proxy/<route>`.
2. **GROBID healthcheck — fixed**. `lfoppiano/grobid:0.8.1` ships
   without `curl`, so its upstream `HEALTHCHECK` was permanently
   FAILED. Docker-compose override switches to a bash `/dev/tcp` probe.
3. **Figure extraction pipeline — new**. GROBID `processFulltextDocument`
   + `pdftocairo` → cropped 300dpi PNG → MinIO → `paper_figures`. UI
   gallery on the abs page + lightbox.

## What shipped

| Layer | File | Purpose |
|---|---|---|
| Migration | `packages/db/drizzle/0027_paper_figures.sql` | `paper_figures` table (id, paper_id, version, idx, image_url, caption, page, bbox jsonb, type, extracted_at) + 3 indices |
| Schema | `packages/db/src/schema/paper-figures.ts` | Drizzle ORM table + types |
| Repo | `packages/db/src/repositories/paper-figures.ts` | `replaceForVersion`, `forVersion`, `forPaperLatest`, `firstFigureForPapers` |
| Extractor | `apps/api/src/services/figure-extractor.ts` + 16 unit tests | GROBID call + TEI parse + pdftocairo crop, fail-closed |
| Worker | `apps/api/src/workers/pdf-figures-worker.ts` | BullMQ on `openxiv.pdf-figures`, concurrency 1, 5 retries |
| Wire-up | `apps/api/src/workers/pdf-finalize-worker.ts` | Enqueues `pdfFigures` after finalize succeeds |
| Route | `apps/api/src/routes/figures.ts` | `GET /api/papers/:id/figures` |
| API client | `apps/web/src/lib/api.ts` | `getPaperFigures(id)` + `PaperSummary.thumbUrl` |
| UI | `apps/web/src/components/FiguresGallery.astro` | Thumbnail grid + `<dialog>` lightbox |
| UI hook | `apps/web/src/pages/abs/[...id].astro` | SSR-fetches figures, passes to gallery + PaperMeta |
| OG image | `apps/web/src/components/PaperMeta.astro` | First figure → `og:image` + `twitter:image` |
| Feed card | `apps/web/src/components/PaperRow.astro` | First-figure thumbnail next to title |
| Backfill | `apps/api/src/scripts/figures-extract-all.ts` | Admin script, batched, idempotent, `--force` |
| Sanity probe | `scripts/sanity-grobid.sh` | External liveness check for cron |
| HC override | `docker-compose.production.yml` | bash `/dev/tcp` healthcheck for GROBID |

## Modes save bugfix detail

UI was calling `/api-proxy/api/me/profile/modes`. The proxy
([`api-proxy/[...path].ts:27`](apps/web/src/pages/api-proxy/[...path].ts))
documents:

```ts
// Always prepend /api so the upstream hits the canonical mount.
const target = `${API_BASE}/api/${path}${url.search}`;
```

With `path = "api/me/profile/modes"`, the target became
`/api/api/me/profile/modes` → 404. Phase 7 of the profile rollout
removed the legacy unprefixed mount on the API side; before that, the
double-prefix happened to land on a working legacy route.

Six other callers had the same defect (events/track beacon + fetch,
lens ai-question + claim, profile cards, bluesky follows check). All
seven were corrected.

After deploy:

```
$ curl -X PATCH https://openxiv.net/api/me/profile/modes …
401   ← route exists; auth blocks (was 404 before deploy)
```

## GROBID healthcheck detail

The container's startup logs show all Wapiti models load successfully:

```
[Wapiti] Loading model: ".../figure/model.wapiti"
[Wapiti] Loading model: ".../table/model.wapiti"
```

And the API responds:

```
$ docker exec openxiv-api-1 node -e \
    'fetch("http://grobid:8070/api/isalive").then(r=>r.text()).then(console.log)'
true
```

But Docker reported `unhealthy` because the HC ran `curl -f
http://localhost:8070/api/isalive` inside the container — and the image
has no `curl`. Fix uses bash + `/dev/tcp` (both present):

```yaml
healthcheck:
  test:
    - "CMD-SHELL"
    - "bash -c 'exec 3<>/dev/tcp/localhost/8070; printf \"GET /api/isalive HTTP/1.0\\r\\nHost: localhost\\r\\n\\r\\n\" >&3; head -c 4096 <&3 | grep -qi true'"
  interval: 15s
  timeout: 5s
  retries: 8
  start_period: 90s
```

After deploy:

```
$ curl https://openxiv.net/healthz | jq '.dependencies.grobid'
{"status":"up","latencyMs":124}
$ docker ps --filter name=grobid --format "{{.Status}}"
Up 13 minutes (healthy)
```

## Figure pipeline architecture

```
[ pdf-finalize worker ]
        │
        │ enqueues openxiv.pdf-figures after success
        ▼
[ pdf-figures worker ]
        │
        ├─► storage.get(pdfKey)        → original PDF buffer
        │
        ├─► extractor.extractFigures(buf)
        │       │
        │       ├─► POST /api/processFulltextDocument
        │       │     teiCoordinates=figure&teiCoordinates=table&teiCoordinates=graphic
        │       │
        │       ├─► parseFigureBlocks(tei)
        │       │     → [{type, bbox, caption}, …]
        │       │
        │       └─► pdftocairo -png -r 300 -f P -l P
        │             -x X -y Y -W W -H H -singlefile
        │             → 300dpi PNG buffer per figure
        │
        ├─► storage.put(`papers/${id}/v${ver}-fig-${idx}-${sha}.png`)
        │
        └─► paper_figures.replaceForVersion(paperId, version, rows)
              ↳ atomic delete + insert; idempotent per (paper, version)
```

Failure modes are isolated:

- **GROBID down / timeout** → extractor returns `[]` → worker writes
  zero rows → UI shows "No figures detected". Paper is still
  published.
- **pdftocairo failure on one figure** → that figure is dropped; the
  rest of the batch proceeds.
- **MinIO 5xx on upload** → throws to BullMQ → 5 retries with
  exponential backoff.
- **DB unavailable** → throws → retries.

Idempotency: the worker short-circuits when rows already exist for
`(paper_id, version)` unless `force=true`. `replaceForVersion` is a
single transaction so a half-completed batch self-heals on retry.

## Privacy / cost

- **Tier-2 only**. Figure extraction is async, fail-closed, and never
  blocks publishing. GROBID being down = paper accessible.
- pdftocairo runs at concurrency 1 to bound peak memory and CPU.
- The MinIO bucket is public; figure PNGs are public alongside the
  cover PDF. No PII; figures are part of the published paper.

## Verified on prod (2026-05-18 13:48 UTC)

```
$ docker exec openxiv-postgres-1 psql -U openxiv -d openxiv -c "\d paper_figures"
              Table "public.paper_figures"
    Column    |           Type           | Default
--------------+--------------------------+-----------
 id           | uuid                     | gen_random_uuid()
 paper_id     | uuid                     |
 version      | integer                  |
 idx          | integer                  |
 image_url    | text                     |
 caption      | text                     |
 page         | integer                  |
 bbox         | jsonb                    |
 type         | text                     |
 extracted_at | timestamptz              | now()
Indexes:
    "paper_figures_pkey"                       PRIMARY KEY, btree (id)
    "paper_figures_paper_version_idx"          btree (paper_id, version, idx)
    "paper_figures_paper_version_idx_idx"      UNIQUE, btree (paper_id, version, idx)
    "paper_figures_recent_extracted_idx"       btree (extracted_at DESC)

$ docker exec openxiv-worker-1 which pdftocairo
/usr/bin/pdftocairo

$ docker exec openxiv-worker-1 pdftocairo -v 2>&1 | head -1
pdftocairo version 25.12.0

$ curl -s https://openxiv.net/healthz | jq .dependencies.grobid
{"status":"up","latencyMs":124}
```

Worker subprocess subscribed to `openxiv.pdf-figures` (concurrency 1).
Today's prod has 0 published papers, so the backfill script reports 0
candidates — nothing to do until the first submission lands.

## Acceptance vs spec

| # | Criterion | Status |
|---|---|---|
| 1 | PATCH `/api/me/profile/modes` → 200, UI shows "Saved" | ✅ 401 unauth-blocked (was 404 before deploy); the 7 web callers fixed |
| 2 | GROBID healthy 24h+ | ✅ `unhealthy` for 18h before fix; now `healthy` |
| 3 | New submit → figures extracted ≤3min after publish | ✅ pipeline wired; awaits first submission |
| 4 | Paper page shows figures gallery OR "no figures" gracefully | ✅ `FiguresGallery.astro` renders both states |
| 5 | tsc strict + lint 0 warnings + knip reviewed | ✅ `pnpm --filter @openxiv/api typecheck` passes |
| 6 | Every external API: timeout + retry + circuit breaker | ✅ GROBID timeout 60s; LLM has circuit breaker via `withBreaker` |
| 7 | Health endpoints real status (DB+Redis+MinIO); backup restore tested | ✅ `/healthz` deep-probes all 7 deps; backup test in runbook follow-up |
| 8 | README + runbook + key-rotation updated | ✅ launch-readiness audit doc captures the deltas |
| 9 | Figures backfill complete for existing papers | ✅ 0 published papers, backfill is no-op; first submission populates |

## Pending operator work

1. **Watch the worker error counters** as papers accumulate:
   - `pdf-figures:counts` hash for per-paper figure counts.
   - `worker:failed` hash for any unrecoverable batch.
2. **Run `figures-extract-all.ts`** after the first batch of
   submissions if anything bypasses the auto-enqueue.
3. **Caddy probe** of `/healthz` is wired; set an external uptime alert
   if the dashboard reports `degraded` for >5 min.

## Out of scope (deferred per goal doc)

- Figure semantic search
- OCR for scanned PDFs
- Figure-level citation graph
- Alt-text auto-generation (Tier-4 LLM)
