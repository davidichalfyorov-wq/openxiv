# Moderation Policy (Draft)

## Positioning

OpenXiv is between arXiv and viXra. We are not viXra: we do moderate. We are
not arXiv: we do not gate on methodology, AI tool use, or absence of prior
peer review.

The 2025-2026 arXiv policy that triggers OpenXiv's existence — twelve-month
suspensions for AI-paper rule violations, with reinstated authors required to
have a subsequent preprint appear in peer review before submitting again — is
exactly the failure mode we want to avoid. It conflates editorial judgement
with infrastructure operation.

## Principles

1. **Disclosure over refusal.** Authors must disclose: AI tool use, funding,
   conflicts of interest, prior peer review status, and any retractions of
   related work. This metadata is shown to readers, not used to refuse the
   work.

2. **Scope, not merit.** A submission to `math.NT` must be number theory — not
   perpetual motion or biblical numerology. We refuse off-topic. We do not
   refuse "wrong-but-on-topic". Wrong-but-on-topic is what comments,
   replications, and rebuttal preprints are for.

3. **No peer-review precondition.** OpenXiv never requires that prior work
   have passed peer review.

4. **Holds, not bans, on first concern.** If a moderator has questions, the
   default action is `held` — author is asked to address specific concerns.
   `rejected` is reserved for clear policy violations. `banned` is reserved
   for repeated bad-faith behaviour after warnings.

5. **Public, auditable moderation log.** Every moderation action is recorded
   with actor, timestamp, action, and a public-facing reason. Authors can
   appeal. Appeals are decided by a different moderator than the original
   action, and the decision is logged.

6. **Reject hard, narrow grounds.** Grounds for outright rejection: identifiable
   harm (instructions for weapons of mass destruction, doxxing,
   harassment), proven plagiarism, falsified authorship/affiliation, clear
   fraud. Everything else is held or accepted-with-disclosure.

## What we do not do

- We do not refuse submissions for "extensive AI use." We require disclosure.
- We do not refuse submissions because the methodology is unconventional.
- We do not refuse submissions because prior work was not peer-reviewed.
- We do not require endorsement by an existing author (arXiv's endorsement
  system has known equity failure modes).
- We do not silently downrank, shadow-hide, or de-list. Either a preprint is
  accepted (publicly visible) or it is held/rejected (with logged reason).

## Mapping to the data model

`app/models/version.py` defines `ModerationAction` and `ModerationEvent`. Every
state transition writes an event row. The current state of a `PaperVersion` is
derived from `Paper.status` plus the latest event.

Disclosure fields live on `Paper` (TODO: extend the model with
`ai_disclosure`, `funding_disclosure`, `conflicts_of_interest`, and
`prior_peer_review_status` as required `Text` columns; current skeleton has
`license` and category info only).

## Open questions

- **Moderator pool.** Who moderates? Volunteer category editors (arXiv model)
  or rotating community moderators (Stack Exchange model)?
- **Time-to-decision SLA.** arXiv targets ~5 business days. We should aim
  tighter (~48h) because we're explicitly serving authors who feel underserved
  by slow gatekeeping.
- **Withdrawal vs retraction.** Author-initiated withdrawal of a version is
  always allowed; the version becomes a tombstone with the DOI preserved.
  Editor-initiated retraction (e.g. proven misconduct) is rarer and requires
  a documented rationale.
- **AI-generated submissions.** Pure LLM-output spam is real and will hit us.
  We will need an "AI-authored without human accountability" filter — likely
  signature analysis + a corresponding author identity check (ORCID +
  affiliation verification) rather than content classification, which is
  brittle.
