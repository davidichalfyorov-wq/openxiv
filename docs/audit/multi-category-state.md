# Ф0 — Multi-category state (2026-05-18)

Read-only audit of each layer the new submission flow has to traverse.
**Pass** = already shipped + verified. **Missing** = needs a code change
in this rollout. **Partial** = code exists but doesn't carry through.

| Layer | Status | Notes |
|---|---|---|
| Migration `0021_multi_category.sql` | **Pass** | `papers.cross_listings text[]` with `papers_cross_listings_gin_idx` (GIN), `CHECK length ≤ 5`, `CHECK primary_category != ANY(cross_listings)`. Already applied to prod. |
| Lexicon `app.openxiv.paper.crossListings` | **Pass** | `packages/lexicons/src/paper.ts` defines `crossListings: z.array(z.string().max(64)).max(5).default([])` + two `.refine` clauses (no primary-overlap, no dup). Floor is permissive 5; UI/API caps at 2. Backward-compat: missing field on old records is treated as `[]`. |
| DB repo `setCategories` | **Pass** | `packages/db/src/repositories/papers.ts:330` writes both `paper_categories` (legacy m2m, for query joins) and `papers.cross_listings` (text[], for GIN lookup) in a single transaction. Dedups and caps at 5. |
| DB repo `list({primaryCategory})` | **Pass** | `papers.ts:254` uses `WHERE primary_category = $1 OR cross_listings @> ARRAY[$1]::text[]` so feed/topic queries return papers cross-listed into the requested category without join. |
| `services/submissions.ts` packs into PDS | **Pass** | line 565: `crossListings: loaded.paper.crossListings ?? []` flows into the AT-proto record. |
| `routes/intake.ts` (finalize body) | **Partial** | accepts `secondaryCategories: z.array(z.string()).max(5)` — but with the wrong field name (should be `crossListings`) and the wrong cap (should be `max(2)`). No no-overlap-with-primary check; no dedup; no catalog membership check. **Action: rewrite the field.** |
| `routes/papers.ts` GET /:id response | **Missing** | line 108 returns `primaryCategory` but not `crossListings`. The UI can't render secondary badges without it. **Action: include crossListings.** |
| `routes/feed.ts` + `routes/topics.ts` | **Pass** (via repo) | They delegate filtering to `papers.list({primaryCategory})` which already uses the GIN-indexed `OR cross_listings @>` predicate. No changes needed at the route layer. |
| `routes/oai.ts` `<dc:subject>` | **Pass** | line 358: `[primaryCategory, ...categories.filter(c !== primary)]` emits one `<dc:subject>` element per category — the `categories` field is sourced from the legacy m2m, which `setCategories` keeps in sync with `cross_listings`. |
| `routes/oai.ts` arXiv-format `<categories>` | **Pass** | Same iteration covers it (verified line 358 path). |
| `apps/web/src/components/CategoryPicker.tsx` | **Missing** | Today: single-select only (`value: string`, `onChange: (code) => void`). **Action: add `mode: 'single' \| 'multi-with-cap'` + `max` prop; chips header with Remove; ARIA `aria-disabled` on rows when cap reached.** |
| `apps/web/src/components/SubmissionWizard.tsx` | **Missing** | Today: `secondaryCategories: string` (one comma-separated text field, no validation). **Action: split into `primaryCategory: string` + `secondaryCategories: string[]`; use the new multi-mode CategoryPicker for the secondary step.** |
| Paper page badges (`abs/[...id].astro`) | **Missing** | Today: shows primary only. **Action: render primary with `accent` tone + each cross-listing as a neutral badge linking to `/topics/{code}`.** |
| Profile page category union | **Partial** | Currently shows primary per paper. **Action: union across all `papers.primary_category` + `papers.cross_listings` for the profile owner.** (Lower priority — purely cosmetic; can land separately.) |
| Feed card (PaperRow) | **Missing** | Today: primary visible. **Action: append `+N more` chip when crossListings is non-empty; tooltip enumerates them.** |
| Catalog client fault tolerance | **Pass** | `/api/categories` returns the static `CATEGORY_CODES` constant — there's no external network call, so the "catalog timeout" failure mode of the goal doc is hypothetical. We still document the no-op fallback in code comments so the contract is explicit. |
| Sanitizer service | **Missing** | No central `sanitizeCrossListings` helper today. **Action: add `apps/api/src/services/cross-listings.ts` with `sanitize({primary, crossListings, catalog})` → dedup, drop overlap, cap-2, enforce catalog membership; return `{ value, warnings }`. Used by intake + paper-edit.** |
| Unit + integration + e2e tests | **Missing** | No `cross-listings.test.ts` today; the lexicon test only covers refines, not the route flow. **Action: cover all 5 paths (0/1/2/3+/overlap/dup) at unit, integration, and e2e levels.** |

## Conclusion

Plumbing below the API surface is already correct. The remaining work is
**three thin slices**:

1. **API gate** (`routes/intake.ts` + new `services/cross-listings.ts` + add `crossListings` to GET /papers/:id).
2. **UI** (multi-select CategoryPicker mode + SubmissionWizard state split + paper page + feed card).
3. **Tests** (unit sanitiser, integration submit-and-verify, e2e wizard happy + cap path).

No new migrations. No re-deploy of DB. Path to prod is a web + API build.
