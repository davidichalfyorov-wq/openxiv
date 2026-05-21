# GitHub Release Prep

This document is for the operator before the first public GitHub push.

## Repository Description Options

- OpenXiv is an AT Protocol preprint server with source-based submissions, public provenance, typed endorsements, OAI-PMH, and Bluesky federation.
- OpenXiv publishes preprints as web pages, PDFs, AT Protocol records, and Bluesky posts, with provenance and review signals attached to each paper.
- OpenXiv is a self-hostable preprint server for open science, built with Astro, Fastify, PostgreSQL, and AT Protocol federation.

## GitHub Topics: data-backed ranking

GitHub caps a repository at 20 topics. The set below was re-ranked on
2026-05-21 using direct fetches from each `github.com/topics/<tag>` page
and from the declared topics on five adjacent projects (DSpace, Invenio,
Zenodo, Janeway, plus the `eprints` topic page).

### Data sources

Per-topic repository counts and curated status, fetched on 2026-05-21:

| Topic | Public repos | Curated | Top repos signal |
|---|---:|---|---|
| typescript | 347,941 | no | generic language tag |
| postgresql | 90,594 | no | Supabase, NocoDB |
| self-hosted | 14,469 | no | awesome-selfhosted, n8n |
| latex | 13,283 | no | typesetting tools, not preprint |
| astro | 10,137 | no | Astro itself, docs sites |
| arxiv | 1,167 | no | ChatGPT-on-arXiv tools (wrong crowd) |
| bluesky | 1,085 | no | bluesky-social/pds, indigo |
| publishing | 1,302 | no | Ghost, pandoc, papermill |
| fastify | 4,782 | no | http-proxy-middleware, mercurius |
| atproto | 538 | **yes** | bluesky-social/pds, indigo, bridgy-fed |
| atprotocol | 188 | yes | atproto, ATProtoKit |
| activitypub | 577 | no | Mastodon, PeerTube, Lemmy |
| federation | 516 | **yes** | Nextcloud, Misskey, Pixelfed |
| fediverse | 715 | no | Mastodon, Lemmy, Owncast |
| decentralized | 3,339 | yes | LocalAI, Nextcloud server, Yjs |
| drizzle-orm | 3,416 | no | starter kits |
| open-access | 282 | **yes** | DSpace, Zenodo, JOSS |
| openaccess | 60 | yes | smaller form, library tooling |
| open-science | 1,467 | no | Zenodo |
| oai-pmh | 107 | **yes** | LibreCat/Catmandu, DSpace/xoai, sickle |
| scientific-publications | 214 | **yes** | Zenodo (declared), ar5iv |
| scientific-publishing | 38 | no | rxivist |
| academic-publishing | 96 | no | arxiv-vanity, engrafo |
| scholarly-communication | 45 | no | fatcat, OpenKnowledgeMaps, SHARE |
| institutional-repository | 27 | **yes** | Invenio, CERN, MyCoRe |
| digital-library | 167 | no | Zenodo, Invenio, fatcat |
| research-data-management | 215 | yes | Zenodo, RDMO |
| preprints | 72 | no | Janeway, quarto-preprint, rxiv-maker |
| preprint | 82 | no | LaTeX templates (LaPreprint, latex-paper) |
| preprint-server | 0 | no | empty topic, OpenXiv would own it |
| research | 10,999 | yes | ML/AI research dominated, not academic |
| eprints | 21 | yes | chive-pub, UB-Mannheim/uma_publist |
| repository | 4,001 | yes | generic software repository tools |

### Industry social proof, declared topics on adjacent projects

- **DSpace**: `java`, `open-source`, `repository`, `rest-api`, **`open-access`**, `dspace`.
- **Invenio (CERN)**: `python`, `flask`, `elasticsearch`, `redis`, `rabbitmq`, `json-schema`, `postgresql`, **`institutional-repository`**, `invenio`, **`digital-library`**, `multimedia-library`, `digital-repository`, `multimedia-repository`.
- **Zenodo (CERN)**: `python`, `flask`, `elasticsearch`, `postgresql`, **`open-access`**, **`open-science`**, `research-data-management`, `research-data-repository`, `invenio`, **`digital-library`**, `scientific-publications`, `library-management`, `zenodo`.
- **Janeway**: `journal`, `publishing`, **`preprints`**, `janeway`.

The tags bolded above are the ones used by at least two of the four
canonical preprint or repository projects, so they are the highest-signal
choices for OpenXiv's library and OA audience.

### Reasoning behind the final 20

The list is balanced across six audience pools. Each pool maps onto a
distinct discovery path:

| Audience pool | Final tags | Why |
|---|---|---|
| AT Protocol / Bluesky | `atproto`, `bluesky` | atproto is curated with 538 repos and includes bluesky-social/pds at top; bluesky has 1,085 repos and the largest social search traffic |
| Federation / decentralization | `federation`, `fediverse` | curated federation page sits next to Nextcloud and Misskey; fediverse pulls Mastodon-adjacent readers |
| Library / institutional | `oai-pmh`, `institutional-repository`, `digital-library`, `scientific-publications`, `scholarly-communication` | curated OAI-PMH page lists DSpace tooling; institutional-repository is the Invenio/CERN home; digital-library is where Zenodo lives; scientific-publications is curated and Zenodo-declared; scholarly-communication catches fatcat/SHARE readers |
| Open access / open science | `open-access`, `open-science` | curated open-access page lists DSpace, Zenodo, JOSS; open-science is the broadest umbrella with 1,467 repos |
| Preprint specific | `preprints`, `preprint-server`, `publishing` | preprints (plural) is the canonical Janeway-declared tag; preprint-server is empty so OpenXiv becomes the first entry; publishing is the broader catchment used by Janeway |
| Stack visibility | `typescript`, `astro`, `fastify`, `postgresql`, `drizzle-orm`, `self-hosted` | language and framework discovery; postgresql is shared with Invenio and Zenodo; self-hosted has 14,469 repos and the strongest self-host crowd |

### Final 20 (data-backed, copy-paste form)

Comma form:

```
atproto, bluesky, preprints, preprint-server, open-access, open-science, oai-pmh, institutional-repository, digital-library, scientific-publications, scholarly-communication, publishing, federation, fediverse, self-hosted, typescript, astro, fastify, postgresql, drizzle-orm
```

Space form:

```
atproto bluesky preprints preprint-server open-access open-science oai-pmh institutional-repository digital-library scientific-publications scholarly-communication publishing federation fediverse self-hosted typescript astro fastify postgresql drizzle-orm
```

Six of the twenty are curated topics with official GitHub pages
(`atproto`, `open-access`, `oai-pmh`, `institutional-repository`,
`scientific-publications`, `federation`). Curated pages get
preferential placement in `github.com/explore` and in topic discovery.

### Why specific tags were dropped

- **openaccess** (60, curated): the hyphenated `open-access` (282, curated) is the form DSpace and Zenodo declare. Keep the bigger one only.
- **preprint** (82): mostly LaTeX article templates. The plural `preprints` (72) is what Janeway declared. Keep the plural.
- **scientific-publishing** (38): smaller than the plural `scientific-publications` (214, curated) which Zenodo declared.
- **academic-publishing** (96): adjacent but the `publishing` tag (1,302, Janeway-declared) covers the same audience with more reach.
- **research** (10,999, curated): dominated by ML/AI research tooling (Microsoft qlib, google-research). The academic research crowd is better reached through `scholarly-communication` and `scientific-publications`.
- **arxiv** (1,167): dominated by ChatGPT-on-arXiv summarizers, not preprint servers.
- **latex** (13,283): typesetting tool ecosystem (KaTeX, marktext, Awesome-CV), not the preprint server crowd. OpenXiv accepts LaTeX through tectonic but is not a typesetting tool.
- **activitypub** (577): OpenXiv does not federate over ActivityPub. Use `federation` and `fediverse` for adjacent crowd.
- **decentralized** (3,339, curated): OpenXiv is federated, not P2P. Reserve the slot for `federation` instead.
- **self-hostable** (61): same audience as `self-hosted` (14,469) but two orders of magnitude smaller.
- **selfhosted** (1,269): the hyphenated form is 11x bigger.
- **atprotocol** (188, curated): the standard form is `atproto` (538). Keep the bigger one.
- **research-data-management** (215, curated): Zenodo declares it but OpenXiv is not an RDM tool.
- **repository** (4,001, curated): too generic; matches software registries more than preprint repos.
- **digital-repository** (Invenio-declared, very small): covered by `digital-library`.
- **eprints** (21, curated): legitimate library audience but extremely small. Reachable through `institutional-repository`.
- **journal** (declared by Janeway): OpenXiv is a preprint server, not a journal.

## Linguist Override

Astro files are first-party source. GitHub Linguist can classify Astro as
HTML in a way that inflates the language bar.

The repo includes `.gitattributes` with:

```gitattributes
*.astro linguist-language=Astro
```

Verify the language bar after the first push. If TypeScript percentage
still looks low, consider also:

```gitattributes
packages/db/drizzle/* linguist-generated=true
_legacy/** linguist-vendored=true
```

## Social Preview Image Spec

Create a 1280x640 PNG.

Use a dark background (`#0b0b0d` matches the masthead). Center
`/brand/logo-full.svg` with clear padding on all sides. Place
`openxiv.net` at the bottom center in small white text. Do not add
marketing text, claims, screenshots, or extra badges.

A safe layout: logo centred at 720x720 max, vertical padding of 80px
top and 80px bottom around the logo, footer text at 32px sans-serif
white set 40px above the bottom edge.

Do not generate this image in Codex. The operator creates and uploads
it in GitHub repository settings under Social preview.

## First Release File List

These files exist before the operator runs `git push`:

- `README.md`
- `LICENSE` (AGPL-3.0-or-later)
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `SECURITY.md`
- `.env.example`
- `package.json`
- `pnpm-workspace.yaml`
- `docs/ARCHITECTURE.md`
- `.github/workflows/ci.yml`
- `.github/ISSUE_TEMPLATE/{bug_report.md,feature_request.md,config.yml}`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.gitattributes` (Astro Linguist override)

## Pre-Push Verification Checklist

- Secret audit is clean or has only ignored local secret stores.
- `.env.example` covers every variable read by `parseEnv`.
- Every workspace `package.json` declares `AGPL-3.0-or-later`.
- `pnpm typecheck` is green.
- `pnpm test` is green.
- `pnpm --filter @openxiv/web build` is green.
- No `debugger` statements remain in production paths.
- No `console.log` calls remain in production paths (operator CLIs under `apps/api/src/scripts/` are allowed).
- `TODO`, `FIXME`, and `XXX` findings are reviewed in `docs/RELEASE-CHECKLIST.md`.
- `git status --short --branch` is checked in the operator shell before push.
- The Social preview image is generated and uploaded in repository settings.
- The repository About panel has the description and the 20-tag topic list applied.
