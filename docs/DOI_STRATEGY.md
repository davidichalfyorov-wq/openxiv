# DOI Strategy

## Question

How does a brand-new preprint server, with no institutional backing on day one,
issue DOIs that are real, persistent, and recognized by the global academic
infrastructure?

## The three real options

DOIs are issued through **Registration Agencies** under the DOI Foundation. For
academic content, three RAs matter:

| Path | Annual cost | DOI prefix | Strengths | Weaknesses |
|------|-------------|------------|-----------|------------|
| **Zenodo** (via DataCite) | $0 | `10.5281/zenodo.N` | Free, REST API, instant minting, citation export built in, sandbox available, run by CERN so trust is high | DOI owned by Zenodo, not OpenXiv; PDFs are hosted on Zenodo too (or dual-hosted); branding compromise |
| **DataCite direct** (via consortium member: CDL, EUDAT, CDL, etc.) | ~$500-1500 USD | Own prefix `10.NNNNN/openxiv.…` | Full ownership, used by OSF Preprints, PsyArXiv, SocArXiv | Need legal entity; need consortium agreement |
| **CrossRef "Posted Content"** | $275 + $1/DOI | Own prefix | Highest indexability in commercial DBs; used by bioRxiv, medRxiv, Research Square; CrossRef API is mature | Member application takes weeks; need org structure they recognize |

## Recommended progression

**Phase 0 — MVP (day 1)**: Zenodo via REST API.

- The Zenodo `deposit/depositions` flow yields a DOI in under a second.
- Use sandbox.zenodo.org during development. The sandbox issues real-looking
  but non-permanent DOIs — never use sandbox DOIs in production records.
- Zenodo's "concept DOI" semantics map cleanly onto our two-tier identifier
  model (one DOI per version, one DOI for the work).
- Each deposit can be filed into a Zenodo *community* (we create one called
  e.g. `openxiv`) so the records are visibly aggregated.

**Phase 1 — own prefix, DataCite**: when there is a legal entity and the
volume justifies it.

- Apply for membership through a DataCite consortium (cheaper than direct).
- New DOIs use the OpenXiv prefix.
- Existing Zenodo DOIs stay valid forever — DOIs are by definition persistent.
  Don't try to re-mint or migrate; just point forward.

**Phase 2 — CrossRef** (optional, only if the index difference matters):
some bibliometric tools and publishers privilege CrossRef. If a meaningful
fraction of OpenXiv content moves to peer review, CrossRef membership pays
for itself in linking.

## Internal identifier vs DOI

Don't conflate the two:

- **Internal ID** (`openxiv:2026.00001`): assigned at submission, immutable,
  visible in URLs. Like arXiv's `2401.12345`. No external dependency.
- **Concept DOI** (`Paper.concept_doi`): assigned when the *first version* is
  approved. Resolves to the latest version's landing page.
- **Version DOI** (`PaperVersion.version_doi`): one per version. Cites a
  specific snapshot.

Until DOIs exist, papers are still findable by internal ID. DOI minting is an
async post-approval step — never a submission blocker.

## Version semantics

We follow the **Zenodo / DataCite model**: each version gets its own DOI;
they're linked through `relatedIdentifier` of type `IsNewVersionOf` / `HasVersion`.
A concept DOI on `Paper` resolves to the latest published version.

This is cleaner than the arXiv model (one DOI for the work, version
distinguished only by `vN` suffix) for two reasons:

1. Bibliographic tools that ignore `vN` suffixes silently citation-collapse
   versions. With per-version DOIs, citations are unambiguous.
2. Withdrawn versions can be tombstoned without affecting other versions'
   citations.

## What we promise to authors

- DOI is permanent. Even if OpenXiv folds, Zenodo (CERN-backed) outlives us.
- The DOI resolves to a landing page we control while we exist; after that, to
  Zenodo's archived record.
- Versions are never silently overwritten. A `v2` is a new deposit; `v1`
  stays accessible at its own DOI.

## Code shape

`app/services/doi/base.py` defines `DOIProvider` with `mint()` /
`update_metadata()`. `zenodo.py` is the working implementation. `datacite.py`
and `crossref.py` will land when we move to Phase 1/2; the abstraction means
the rest of the codebase doesn't change.

## What this strategy does *not* address

- Cost beyond a few thousand deposits per year. CrossRef's $1/DOI starts
  mattering at scale.
- Archival redundancy beyond Zenodo. CLOCKSS / Portico / Internet Archive
  Scholar are separate concerns and worth pursuing once volume is real.
- DOI for datasets and software supplements attached to preprints — DataCite
  is the natural home for those; revisit when we support supplementary files.
