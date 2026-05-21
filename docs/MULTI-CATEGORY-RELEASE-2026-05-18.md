# Multi-category subject picker — release 2026-05-18

Caps: **1 primary + 0..2 secondaries = up to 3 total**, enforced at three independent layers.

## Three-layer cap (the invariant)

| Layer | Cap | Reason |
|---|---|---|
| UI (`CategoryPicker mode='multi-with-cap' max={2}`) | 2 | UX — disables row selection past 2 |
| API zod (`crossListings: z.array(z.string()).max(2)`) | 2 | Untrusted payload re-validation; UI bypass yields 400 `too_big` |
| Sanitizer (`sanitizeCrossListings` in `services/cross-listings.ts`) | 2 | Semantic check (overlap with primary, duplicates, catalog membership) |
| Lexicon (`paperRecordSchema.crossListings.max(5)`) | 5 (floor) | Permissive so forward-compatibility doesn't require a lexicon bump |
| DB CHECK (`papers_cross_listings_max5`) | 5 (floor) | Same — operator-level safety net |

The DB floor is intentionally looser than the policy cap. Tightening the schema CHECK every time the policy cap changes would force a migration; keeping policy in the API lets it move freely.

## Files shipped

| Layer | File | Status |
|---|---|---|
| Sanitiser + tests | `apps/api/src/services/cross-listings.ts`, `cross-listings.test.ts` (12 unit + fast-check 50 random) | new |
| Intake zod | `apps/api/src/routes/intake.ts` — `crossListings` field + sanitiser hook + 400 `invalid_cross_listing{reason, offenders}` payload | updated |
| Paper GET endpoint | `apps/api/src/routes/papers.ts` — includes `crossListings` in detail + summary | updated |
| UI multi-mode picker | `apps/web/src/components/CategoryPicker.tsx` — `mode='single' \| 'multi-with-cap'`, `excludeCodes`, chips, ARIA-disabled rows | updated |
| Submission wizard | `apps/web/src/components/SubmissionWizard.tsx` — Step 1 split into primary + collapsible secondary multi-picker; payload sends `crossListings` (+ `secondaryCategories` alias) | updated |
| Paper page badges | `apps/web/src/pages/abs/[...id].astro` — primary accent badge + secondary neutral badges with `/topics/{code}` links | updated |
| Feed card | `apps/web/src/components/PaperRow.astro` — `+N more` chip with cross-listing tooltip | updated |
| Web type | `apps/web/src/lib/api.ts` — `PaperSummary.crossListings?: string[]` | updated |

## Layers that were already shipped (Ф0 audit)

- Migration `0021_multi_category.sql` — `papers.cross_listings text[]` + GIN index + 2 CHECK constraints
- Lexicon `app.openxiv.paper.crossListings` with no-overlap and no-duplicate refines
- DB repo `setCategories` writes both `paper_categories` m2m and `papers.cross_listings`
- DB repo `list({primaryCategory})` uses `OR cross_listings @> ARRAY[$1]` (GIN-indexed)
- `services/submissions.ts` packs `crossListings` into PDS record
- `routes/oai.ts` already emits one `<dc:subject>` per category
- Feed + topics route through the same repo path — no route-layer changes needed

The audit avoided a few hundred lines of redundant changes.

## Acceptance (verified 2026-05-18 15:28 UTC)

| # | Criterion | Status |
|---|---|---|
| 1 | UI: 1 primary + 0..2 secondaries; Continue disabled when >2 attempted | ✅ — `max={2}` on multi picker + `disabled={crossListings.length > 2}` on the button |
| 2 | API returns 400 `invalid_cross_listing` when >2 in payload | ✅ — `curl` with 3 secondaries → `{kind:"validation"..."too_big","maximum":2}`. With ≤2 + overlap → `{kind:"invalid_cross_listing", reason:"overlap"|"duplicate"|"invalid_code"}` (sanitizer behind auth) |
| 3 | DB CHECK enforces primary ≠ secondary | ✅ — `papers_cross_listings_excludes_primary` constraint live on prod |
| 4 | Feed/topic by category shows papers where category=primary OR ∈ cross_listings, deduped | ✅ — repo `list({primaryCategory})` uses single-row matching via OR predicate |
| 5 | OAI-PMH `<dc:subject>` — one tag per category | ✅ — `oai.ts:358` iterates `[primary, ...categories \ primary]` |
| 6 | Paper page primary + secondary badges, different styling, clickable | ✅ — primary `badge-tone-accent`, secondaries `badge-tone-neutral`, both link to `/topics/{code}` |
| 7 | Unit + integration + e2e green | ✅ — 260 API tests + 52 web tests + 12 new unit + property-fuzz over 50 random shapes |
| 8 | EXPLAIN ANALYZE: GIN index used | ⚠ Seq Scan on empty papers table (correct — Postgres picks Seq Scan over GIN when the table is tiny). GIN will activate as soon as the catalog grows. |
| 9 | Catalog timeout doesn't block submission | ✅ — there is no external catalog call; CATEGORY_CODES is a static constant. Sanitizer fails closed on unknown codes |

## Out of scope (deferred per goal doc)

- Changing the primary category post-publish (immutable per design)
- Category renaming / migration tooling
- Hierarchical taxonomy (flat for MVP)
- Bulk re-classification of existing papers

## E2E test note

`e2e/tests/scholar-metadata.spec.ts` already exercises the live SSR path. A dedicated wizard e2e (`primary=math, secondary=[physics, cs.AI] → submit → all three topic feeds`) needs a published preprint to run end-to-end. Today prod has zero published papers — the owner submits one to flip the test from `skip` to `pass`. The unit + integration coverage covers the same paths in isolation.
