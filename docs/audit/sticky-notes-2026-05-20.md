# Sticky Note Surface Audit - 2026-05-20

Scope: paper reading surfaces under `apps/web/src/pages/abs/[...id].astro` and reusable side/footer cards. The intended behavior is that only the site header is sticky. Paper utility cards stay in natural document flow so Trust Passport, AI Usage Card, Endorsements, and Article artifacts can be visible together when the viewport has room.

## Inventory

| Surface                                 | File                                              | Current role                                                                               | Responsive guard                                                                                              |
| --------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| AI Usage Card, compact side version     | `apps/web/src/components/AIUsageCard.astro`       | Visible near the reader beside the paper body. Full export UI stays in the footer version. | `clamp()` padding, wrapped header, `minmax(0, 1fr)` facts, `overflow-wrap:anywhere`, mobile one-column facts. |
| Trust Passport                          | `apps/web/src/components/TrustPanel.astro`        | Full lane list in the non-sticky paper tools column.                                       | Wider side rail, `clamp()` padding, `line-height:1.5`, wrapped lane labels, 44px summary/action targets.      |
| Endorsements                            | `apps/web/src/components/EndorsementsPanel.astro` | Typed social review panel after Trust Passport.                                            | Wrapped labels and DIDs, `minmax(0, 1fr)` rows, 44px form controls, mobile one-column bars.                   |
| Article artifacts                       | `apps/web/src/pages/abs/[...id].astro`            | Footer card for Trust Passport, JSON-LD, raw HTML, and source links.                       | `clamp()` padding, `min-width:0`, `overflow-wrap:anywhere`, footer stays outside the reader scroll context.   |
| Source PDF / One Hard Question / Claims | `apps/web/src/pages/abs/[...id].astro`            | Secondary reader cards.                                                                    | Side column is `position:static`, `max-height:none`, `overflow:visible`, card children have `min-width:0`.    |

## Layout Rules

- `.paper-reader-shell` uses `grid-template-columns: minmax(0, 1fr) minmax(460px, 520px)` on wide screens, then collapses to one column below `1180px`.
- The paper side rail is explicitly `position: static`; there is no sticky reader rail to collide with the header.
- Mobile-only changes are inside `@media (max-width: 768px)` where they affect viewport fit, math scrolling, figures, citation links, and touch targets.
- Raw HTML and full AI Usage export details remain in the footer, so they do not scroll inside the paper/body tool area.
- References remain in the article flow, but the generated bibliography block is a native accordion. It is not a sticky card and does not compete with the reader side rail.
- Inline paper figure zoom uses a native dialog appended to the page body. It is not sticky and keeps only the site header as the persistent positioned surface.

## Acceptance Checks

- `apps/web/tests/passport-surface.test.ts` asserts no metadata clipping patterns in card components, confirms the widened reader rail, and checks responsive card CSS tokens.
- The mobile paper rendering test in `apps/web/tests/mathjax-rendering.test.ts` asserts `viewport-fit=cover`, `user-scalable=yes`, safe-area padding, mobile math scroll containers, figure containment, and 44px reference backlink targets.
- `apps/web/src/lib/html-postprocess.test.ts` covers the generic references accordion, lazy raster figures, SVG normalization, paragraph flow, identifier linking, and compact backlinks using synthetic LaTeXML fixtures.
- `scripts/verify-latexml-production-layout.mjs` covers production paper and reading pages at 320, 375, 768, 1180, 1440, 1920, and 3840px, including light/dark mobile variants.
