# Ф0 — Paper-presentation audit (2026-05-18)

Read-only inventory before touching code. Items already shipped are
left alone; missing items are the scope of this rollout.

| Concern | Status | File / artefact |
|---|---|---|
| Tectonic + upload pipeline | **Pass** | `services/intake.ts` produces `compiled.pdf`; `services/submissions.ts:491` writes it to MinIO under `papers/{id}/v{ver}.pdf`. Original always retrievable. |
| Branding asset (logo) | **Pass** | `apps/web/public/brand/logo-full.svg` (1200×630-friendly). PDF will rasterise it into a cover banner. |
| Events tracking | **Pass** | `routes/events.ts` ingests `eventsRoutes:/events/track` with DNT cookie + `do-not-track:1` header honoured. Persists to `feed_events` table (target_uri, event_type, session_id, ts, indexed). |
| Analytics aggregator | **Missing** | No `papers_views_hourly` materialised view today. Per-row scans against `feed_events` work for a single paper but won't scale to dashboards. **Action: migration 0026 creates the mview + a 5-min Redis cache around the read.** |
| Per-paper analytics endpoint | **Missing** | No `/papers/:id/analytics`. **Action: add route + service.** |
| Analytics UI | **Missing** | Paper page has Trust Passport, Disclosure, Provenance — no analytics section. **Action: insert `<AnalyticsPanel>` Astro component below Trust Passport.** |
| `papers.doi` nullability | **Pass** | column defined `text('doi')` — NULL allowed (no `.notNull()`). Unique index on `doi` permits multiple NULLs. |
| Conditional DOI render in PDF metadata | **Missing** | Today the abs page hides DOI when null but there is no PDF cover. **Action: PDF cover shows `openxiv:{id}` with footnote when DOI null.** |
| Lexicon `doi` optional | **Pass** | `paperRecordSchema.doi: z.string().max(200).optional()`. |
| `final_pdf_url` column | **Missing** | We persist `pdf_url` (original) only. **Action: add `paper_versions.final_pdf_url` text via migration 0026.** |
| PDF cover generator | **Missing** | No `pdf-cover.ts`. **Action: new service using pdf-lib + qrcode.** |
| PDF sidebar stamper | **Missing** | No `pdf-sidebar.ts`. **Action: new service using pdf-lib rotated -90°.** |
| PDF finalize worker | **Missing** | No queue named `openxiv.finalize-pdf`. **Action: add to `context.ts:QUEUE_NAMES` + worker registration in `workers/index.ts`.** |
| DOI deposit worker | **Missing** | No Crossref deposit; we hold the ISSN but no DOI prefix yet. **Action: stub `workers/doi-deposit.ts` + admin route + saga stage gated on `CROSSREF_PREFIX` env var; emits no-op when credentials absent.** |
| DOI suffix policy | n/a | Specified: `10.{prefix}/openxiv.{openxiv_id}` — opaque, never derived from title. Stable URLs use `openxiv_id`. |
| Admin batch commands | **Missing** | `finalize-all-papers` (batch 50) and `deposit-doi-backfill` (5/sec). **Action: scripts in `apps/api/src/scripts/`.** |

## Implementation plan

1. **Migration 0026** — `paper_versions.final_pdf_url text` (nullable) + `paper_views_hourly` materialised view + helper indices.
2. **`services/pdf-cover.ts`** — pure pdf-lib generator; returns `Buffer`. Idempotent (same input → same output).
3. **`services/pdf-sidebar.ts`** — pure pdf-lib stamper; rotated text on each page; detection heuristic for pre-stamped arXiv PDFs.
4. **`services/pdf-finalize.ts`** — orchestrator: load original → sidebar → cover → merge → upload → DB write. Fault-isolated cascade.
5. **`workers/pdf-finalize.ts`** — BullMQ consumer wraps the orchestrator.
6. **`workers/index.ts`** — register the new worker.
7. **`services/submissions.ts`** — after `stageBlueskyBridge` enqueue finalize job (or earlier — submit flow decision).
8. **`services/doi.ts`** — opaque-suffix builder + Crossref XML serializer.
9. **`workers/doi-deposit.ts`** — gated on `CROSSREF_PREFIX` env; no-op when absent.
10. **`routes/analytics.ts`** — `GET /papers/:id/analytics` + DNT/cookie filter + Redis 5-min cache.
11. **Astro `AnalyticsPanel.astro`** + sparkline component.
12. **Tests** — unit (pdf-cover/sidebar deterministic + page-count invariant + arXiv-detect), integration (compile → finalize → pdf-parse asserts), analytics (DNT path).
13. **Migration apply + deploy** — `migrate.ts` picks up 0026; worker subprocess rebuild; smoke.

## Open invariants

- Original `pdf_url` is **always** retrievable from MinIO — finalize never deletes it.
- Finalize job is idempotent; key = `paper_id + version + content_sha`. Re-running yields the same final blob.
- `final_pdf_url` becomes the canonical "download" link from the abs page once present; until then the abs page falls back to `pdf_url`.
- DOI deposit runs forever in the queue; a transient Crossref 5xx doesn't block paper publication.
- All analytics aggregation honours DNT and the opt-out cookie at ingest time, so the dashboard never sees data the visitor opted out of.
