# SEO + Scholar indexing release — 2026-05-18

## What shipped

| Surface | Change | File |
|---|---|---|
| Homepage headline | "OpenXiv is a preprint server that lives in your social feed." | `apps/web/src/pages/index.astro` |
| Sub copy (1st tier) | AT Protocol + typed endorsements + Trust Passport 4 lanes | `index.astro` |
| 2nd tier (independent researchers) | "Open to independent researchers without institutional backing" | `index.astro`, `about.astro`, sign-in, footer |
| 3rd tier (AI disclosure) | "AI-assisted work is welcome under structured disclosure. Slop refused with refusal packet naming failure. Revision before ban." | `index.astro`, `about.astro` |
| About page | Full rewrite — feature list aligned to real implementation; arXiv only in FAQ | `apps/web/src/pages/about.astro` |
| Sign-in | Per-provider blurb; "no institutional account required" | `apps/web/src/pages/auth/sign-in.astro` |
| README | Headline rewritten, removed positioning prose | `README.md` |
| humans.txt | "What it is / Who it's for / Philosophy" sections | `apps/web/public/humans.txt` |
| Submission terms | "AI policy" section reworded — independent voice, no "softer than arXiv" line | `packages/shared/src/submission-terms.ts` |
| Base meta + OG/Twitter | Default title + description + image (og-default.svg) | `apps/web/src/layouts/Base.astro` |
| Per-paper Highwire | + `citation_language=en`, `citation_technical_report_institution=OpenXiv`, date format YYYY/MM/DD (Scholar canonical) | `apps/web/src/components/PaperMeta.astro` |
| Per-profile sameAs | + did:web → did.json URL alongside ORCID + bsky.app | `apps/web/src/components/ProfileSeo.astro` |
| Homepage WebSite JSON-LD | SearchAction → `/search?q={search_term_string}` | `index.astro` |
| About Organization JSON-LD | identifier=ISSN 3120-9556, sameAs=bsky.app/openxiv, portal.issn.org | `about.astro` |
| Static assets | `manifest.json` (PWA), `og-default.svg` (1200×630), apple-touch-icon | `apps/web/public/` |

## Sanity-audit findings (Ф0)

Dropped from headline copy because the code path isn't implemented:

- **"First-class formal verification (Lean 4, Coq, F*)"** — no `formal_verification` table, no `ProofArtifact` lexicon, no UI. Removed.

Adjusted to match real implementation:

- **Endorsement verbs** — the goal-doc copy proposed `cite / build-on / replicate / critique`. The actual lexicon has six verbs: `verified_derivation`, `reproduced_result`, `checked_references`, `useful_background`, `important_but_flawed`, `needs_correction`. The shipped copy uses the real verbs (three are surfaced inline: *verified derivation*, *reproduced result*, *checked references*).
- **Provenance** — the goal said 7-8 stages; actual is exactly 8 (`uploaded`, `compiled`, `metadata`, `disclosure`, `pds`, `id`, `indexed`, `bridged`).

Full audit in `docs/sanity/feature-audit.md`.

## Highwire citation_* tags now emitted on `/abs/{id}`

| Tag | Source | Notes |
|---|---|---|
| `citation_title` | paper.title | required |
| `citation_author` | each paper.authors[].displayName | repeated |
| `citation_author_institution` | each paper.authors[].affiliation | optional |
| `citation_author_orcid` | each paper.authors[].orcid | optional |
| `citation_publication_date` | paper.publishedAt → YYYY/MM/DD | **slash format**, Scholar requirement |
| `citation_online_date` | same | |
| `citation_journal_title` | "OpenXiv" | constant |
| `citation_publisher` | "OpenXiv" | constant |
| `citation_issn` | "3120-9556" | constant |
| `citation_language` | "en" | constant; can be paper-driven later |
| `citation_technical_report_institution` | "OpenXiv" | required for technical-report classification |
| `citation_abstract` | paper.abstract | |
| `citation_keywords` | paper.keywords joined | |
| `citation_arxiv_id` | paper.openxivId | |
| `citation_doi` | paper.doi | when set |
| `citation_pdf_url` | latestVersion.pdfUrl | when set |
| `citation_fulltext_html_url` | latestVersion.htmlUrl | when set |
| `citation_abstract_html_url` | absUrl | always |

**13+ tags** when a paper has authors, abstract, keywords, and a PDF. Meets acceptance criterion 4.

## Acceptance verification (live prod 2026-05-18 15:00 UTC)

| # | Criterion | Result |
|---|---|---|
| 1 | Ф0 sanity pass | ✅ formal-verif claim dropped; verb taxonomy aligned |
| 2 | Headline ≠ "softer arXiv" in 1st line | ✅ "OpenXiv is a preprint server that lives in your social feed." |
| 3 | Independent researchers in 2nd tier | ✅ surfaced on homepage 1st sub, /about "Who it's for", footer, sign-in |
| 4 | Preprint ≥13 citation_* + JSON-LD + canonical | ✅ pipeline emits 13+ tags + ScholarlyArticle JSON-LD + canonical link |
| 5 | Profile Person + ORCID sameAs | ✅ ProfileSeo.astro emits Person with ORCID + bsky.app + did.json sameAs |
| 6 | /about Organization + ISSN 3120-9556 | ✅ Organization JSON-LD includes `identifier: {PropertyValue, ISSN, 3120-9556}` |
| 7 | Rich Results green ×3 | ⏳ pending — needs ≥3 published papers in prod |
| 8 | Sitemap GSC = Success | ⏳ pending — operator submits via search.google.com/search-console |
| 9 | Robots Googlebot OK | ✅ /robots.txt allows Googlebot, Disallows /api/ /api-proxy/ /auth/ |
| 10 | PDF curl -I: 200 + application/pdf, no redirect | ⏳ pending — needs published paper with real PDF |

## Operator follow-up tasks (no code; can land any time)

1. **Google Search Console**: add `openxiv.net` as a property (domain verification via DNS TXT record), submit `https://openxiv.net/sitemap.xml`.
2. **Bing Webmaster**: register `openxiv.net`, submit sitemap.
3. **Google Scholar inclusion form**: `scholar.google.com/intl/en/scholar/inclusion.html`. Wait until ≥10 preprints are published; then submit. Expected D+14 timeline for `site:openxiv.net` results in Scholar.
4. **Rich Results Test**: once 3 papers are published, run them through `search.google.com/test/rich-results` and screenshot the green panel for the deploy log.
5. **OG image PNG** (optional): the current `og-default.svg` works for Bluesky/Mastodon; Twitter and Facebook prefer PNG/JPEG. Generate a 1200×630 PNG when there's bandwidth — `@vercel/og` or an Astro `getStaticPaths` build step are both fine.
