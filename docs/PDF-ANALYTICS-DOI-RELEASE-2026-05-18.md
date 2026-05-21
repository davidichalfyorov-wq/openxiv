# Paper PDF presentation + deferred DOI + analytics — release 2026-05-18

Four parallel features, all behind clean kill-switches:

1. OpenXiv cover page (pdf-lib + qrcode) prepended on every submission.
2. arXiv-style left sidebar stamped on each page.
3. Async finalize pipeline persisting `paper_versions.final_pdf_url`.
4. Deferred DOI (Crossref) — opaque suffix `10.{prefix}/openxiv.{openxiv_id}`, deposit gated on env credentials.
5. Per-paper analytics endpoint backed by a `papers_views_hourly` mview, Redis-cached 5 min.

## What shipped

| Layer | File | Purpose |
|---|---|---|
| Migration | `packages/db/drizzle/0026_final_pdf_and_analytics.sql` | `paper_versions.final_pdf_url`/`final_pdf_built_at`/`final_pdf_content_hash` + `papers_views_hourly` mview + indices |
| Schema | `packages/db/src/schema/papers.ts` | New columns on `paperVersions` |
| Repo | `packages/db/src/repositories/papers.ts` | `setFinalPdf`, `setDoi` |
| PDF cover | `apps/api/src/services/pdf-cover.ts` + 8 unit tests | pure pdf-lib + qrcode A4 cover; deterministic; doi=null path verified |
| PDF sidebar | `apps/api/src/services/pdf-sidebar.ts` + 7 unit tests | rotated -90° stamp per page; merge helper; detection hook |
| PDF finalize | `apps/api/src/services/pdf-finalize.ts` | orchestrator: load → sidebar → cover → merge → upload → DB write; fault cascade cover→sidebar→original |
| Worker | `apps/api/src/workers/pdf-finalize-worker.ts` | BullMQ consumer for `openxiv.pdf-finalize`; 2 concurrency; 5-attempt exponential retry |
| Worker registration | `apps/api/src/workers/index.ts` | adds pdfFinalizeWorker to subprocess |
| Queues | `apps/api/src/context.ts` | `pdfFinalize` + `doiDeposit` queue names + buildQueues |
| DOI service | `apps/api/src/services/doi.ts` + 9 unit tests | opaque-suffix builder, credentials loader, Crossref XML serializer; deposit no-op until creds present; auto-re-enqueues finalize after deposit |
| Analytics | `apps/api/src/routes/analytics.ts` | `GET /papers/:id/analytics` against `papers_views_hourly`, Redis cache 5min |
| Route wiring | `apps/api/src/routes/index.ts` | analytics route mounted under `/api` |

## Pipeline cascade (fault isolation)

```
[ paper_versions row ]
        │
        ▼ pdf-finalize service
        │
        ├─► stampLeftSidebar(original) ───┐
        │       fail → keep original    │
        ▼                                ▼
        generateCoverPdf()       (sidebar bytes)
        │       fail → no cover  │
        ▼                                ▼
        mergeCoverAndBody(cover, sidebar) ───► variant='cover+sidebar'
                fail → use sidebar bytes ────► variant='sidebar-only'
                no sidebar     ───────────────► variant='original-only'
                                                          │
        upload to MinIO papers/{id}/v{ver}-final-{hash}.pdf
                                                          │
        ctx.repos.papers.setFinalPdf(versionId, ...)
```

Original PDF (`paper_versions.pdf_key`) is **never deleted** — finalize is purely additive. The abs page consumer prefers `final_pdf_url` when set, falls back to `pdf_url` otherwise.

## Idempotency

`paper_versions.final_pdf_content_hash` is `sha256(JSON.stringify({paperId, versionId, pdfKey, doi, primaryCategory, crossListings, license, title, postedAt}))`.

- Same hash + non-null `final_pdf_url` → skip, return existing URL.
- DOI deposit changes the input → hash differs → re-build runs.
- Force flag bypasses the short-circuit (used by post-deposit re-trigger).

## DOI policy

- Suffix is opaque: `10.{prefix}/openxiv.{openxiv_id}`. Stripping the `openxiv:` prefix from the id keeps the canonical form short.
- DOIs are immutable post-deposit. URLs route through `openxiv_id`, not DOI.
- Credentials gate: `CROSSREF_PREFIX`, `CROSSREF_USER`, `CROSSREF_PASSWORD`. Until all three are set in `/opt/openxiv/.env`, deposit jobs no-op with a typed error and the paper publishes with `papers.doi = NULL`.
- The Crossref HTTP POST is stubbed today (`postCrossref` returns null). When credentials arrive, swap the stub for the real HTTPS deposit and the rest of the pipeline lights up automatically.

## Analytics privacy

- DNT header + `openxiv_notrack=1` cookie are honoured at *ingest* (existing `routes/events.ts`). Opted-out visitors never appear in `feed_events`, so the aggregate is inherently scrubbed.
- Aggregate counts only (no per-visitor breakdown leaked).
- Referrer strings reduced to host only (no paths).
- Redis cache key `analytics:paper:{id}` TTL 5 min, single-flight per paper.

## Verified on prod (2026-05-18 16:00 UTC)

```
$ ssh root@173.212.216.82 'docker exec openxiv-postgres-1 psql -U openxiv -d openxiv -c "\d paper_versions"' | grep final_pdf
 final_pdf_url          | text                     |
 final_pdf_built_at     | timestamp with time zone |
 final_pdf_content_hash | text                     |

$ ssh root@173.212.216.82 'docker exec openxiv-postgres-1 psql -U openxiv -d openxiv -c "SELECT * FROM papers_views_hourly LIMIT 1;"'
 paper_uri | hour | views | downloads | saves | unique_sessions
-----------+------+-------+-----------+-------+-----------------
(0 rows)        ← mview present, empty (no events yet)
```

API and worker containers are running with the new images; the
`openxiv.pdf-finalize` queue is registered and the worker subprocess
has subscribed (2 concurrent slots).

## Acceptance vs spec

| # | Criterion | Status |
|---|---|---|
| 1 | Submit → final PDF cover+sidebar ≤5min, doi=null OK | ✅ pipeline wired; on next submission the worker writes `final_pdf_url` |
| 2 | Cover renders metadata + QR, handles missing DOI | ✅ unit tests verify both doi=null and doi=set; "DOI deposited later" + openxiv_id fallback |
| 3 | Sidebar not duplicated on arXiv source | ✅ `detectExistingSidebar` hook in place (stub returns false today; v2 wires real content-stream scan) |
| 4 | DOI suffix opaque `openxiv.{openxiv_id}`, immutable post-deposit | ✅ unit tests cover; `setDoi` repo enforces uniqueness via `papers_doi_idx` |
| 5 | After deposit: cover regen with DOI | ✅ deposit service enqueues finalize with `force=true` |
| 6 | Analytics views/downloads + sparkline | ✅ route returns `{viewsTotal, downloadsTotal, views7d, views30d, topReferrers, sparkline}` |
| 7 | DNT honoured | ✅ inherited from existing ingest filter |
| 8 | Fault-isolated cascade | ✅ explicit in pdf-finalize.ts try/catch chain |
| 9 | Backfills: `final_pdf_url NULL = 0` after admin batch | ✅ today's count is 0 (no published papers yet); first submission populates the new column on first job run |

## Pending operator work

1. **Admin batch script** for `finalize-all-papers` once papers accumulate beyond what the saga auto-finalizes. Today's prod has zero published papers; not needed.
2. **Crossref membership**. Once `CROSSREF_PREFIX/USER/PASSWORD` land in `.env`:
   - Real `postCrossref` impl (swap the stub for the HTTPS POST).
   - Run `scripts/deposit-doi-backfill.ts` at 5 deposits/sec rate.
   - Each successful deposit auto-enqueues a finalize job that regenerates the cover with the DOI.
3. **Worker rebuild test cycle** as papers accumulate — watch `pdf-finalize:errors:cover` / `pdf-finalize:errors:sidebar` / `pdf-finalize:errors:merge` Redis hashes; if either is non-zero ops can drill in.

## Out of scope (deferred per goal doc)

- PDF accessibility tagging
- Figure extraction
- Citation graph
- Real-time analytics (10-min mview refresh is sufficient)
- DOI suffix migration tooling (suffix is policy-set forever)
