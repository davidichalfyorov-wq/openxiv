# OpenXiv retraction policy

Retraction on OpenXiv is **tombstoning, not deletion**. Citations are public infrastructure; breaking them rots the literature.

## Three retraction paths

### 1. Author self-retraction

Most common. The author discovers a serious error, withdraws the work, optionally replaces it with a new version.

- Author signs into OpenXiv, opens the paper, clicks **Retract** (Phase 2 UI; today via the API).
- Reason becomes public on the paper page.
- The OpenXiv id stays valid; resolving it loads the tombstone view (title, authors, retraction reason, link to replacement if any).
- AT-proto record `app.openxiv.paper` is rewritten with a `retracted: true` flag (lexicon Phase 2).
- DOI (when minted) is updated via the registrar's "withdrawn" mechanism — Crossref `withdrawn`, DataCite `tombstoned`.

### 2. Operator retraction

Triggered by:
- Verified plagiarism complaint
- Fabricated authorship (e.g. an author who never consented)
- Wilfully falsified `app.openxiv.disclosure` (claimed `level=none` while using AI generatively)
- DMCA / takedown notice that we accept after review
- Illegal content under operator jurisdiction

Operator drafts a public retraction notice and tombstones the paper. The original author is notified before the tombstone goes live whenever the case allows.

### 3. Algorithmic flag (does NOT auto-retract)

The undisclosed-AI detector and community flags are soft signals. They surface a paper for operator review but never retract it autonomously. False positives are too costly.

## Tombstone shape

A tombstoned paper page renders:

- Title, authors, original `app.openxiv.disclosure`.
- A banner: **RETRACTED — {reason class}**, with the public retraction note.
- Date of retraction and who issued it (`author` / `operator`).
- Link to the replacement OpenXiv id, if any.
- The original PDF stays downloadable (with a "retracted" watermark in the prod render path) unless DMCA prohibits.

## Audit log

Every retraction action records:
- `paper_id`, `retracted_at`, `retracted_by_did`, `retraction_class`, `notes`.
- An immutable AT-proto record `app.openxiv.retraction` (Phase 2 lexicon).
- Operator decisions also note any DMCA correspondence reference.

## Reversal

Author self-retractions can be reversed by the author within 30 days. Operator retractions can be appealed; if reversed, the tombstone becomes a "previously retracted" banner with the appeal outcome.

## What we will not do

- We will not silently delete content. Even when DMCA forces removal of the PDF, the tombstone page remains so the OpenXiv id keeps resolving.
- We will not retract for "the disclosure is embarrassing" — disclosure embarrassing the author is the system working as designed.
- We will not retract because the work is *wrong*. Open science makes room for wrong; retraction is for misconduct or rights violations.
