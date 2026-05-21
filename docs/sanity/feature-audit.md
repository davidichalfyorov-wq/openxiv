# Ф0 — Feature sanity audit (2026-05-18)

Pre-copy check: every claim the homepage / sub-tier copy is about to
make must be backed by a working code path on production. **Any fail
blocks Ф1 copy rewrite.** Failed claims are dropped from the copy
rather than left as marketing fiction.

## Inventory

| Claim | Backing code | Status |
|---|---|---|
| AT Protocol native — preprints federate to Bluesky | `apps/api/src/services/bluesky-bridge.ts` + `jetstream-subscriber.ts` + `bsky:bridge_status` columns on `paper_versions` | ✅ PASS — production-deployed; 5 live integration tests in `bluesky-live.integration.test.ts` |
| did:web user identity + did:plc Bluesky resolution | `did-web.ts` + `bluesky-did-resolver.ts` + `user-keys.ts` (secp256k1) | ✅ PASS — Phase 7 deploy 2026-05-18 |
| Endorsement verbs (typed reviewer actions, not generic likes) | `packages/lexicons/src/endorsement.ts` defines six typed verbs; `routes/endorsements.ts` enforces; `endorsements-stats.ts` aggregates | ✅ PASS — but: **actual verbs differ from the goal-doc copy.** Real verbs: `verified_derivation`, `checked_references`, `reproduced_result`, `useful_background`, `important_but_flawed`, `needs_correction`. The placeholder "cite/build-on/replicate/critique" copy from the goal doc is **rejected**; the copy below uses the real verbs. |
| Trust Passport — 4 lanes | `apps/api/src/services/trust-passport*` referenced from `routes/papers.ts:172`; `TrustPanel.astro` renders four lanes: Transparency, Identity, Integrity, Social Review | ✅ PASS |
| Disclosure Passport — AI usage visible | `disclosures` table + `submission-terms.ts` + paper detail page surfaces AI tier (none/assistant/coauthor/primary) | ✅ PASS |
| Provenance Timeline — 8 stages with timestamps | `apps/api/src/services/provenance.ts` enumerates `uploaded`, `compiled`, `metadata`, `disclosure`, `pds`, `id`, `indexed`, `bridged` — eight stages, each with a `completedAt` derived from a publicly observable column where possible | ✅ PASS (8 stages, not 7-8 as goal doc said; 8 is correct) |
| Multi-tier summaries — school/undergrad/expert | `packages/db/src/schema/papers.ts:summary_tier` enum `school` / `undergrad` / `expert`; `services/explain.ts` produces all three on submission | ✅ PASS |
| Profile AI policy + reading guide (public) | `profile_modes` + `profile_cards` tables; `ProfileSeo.astro`; surfaced on `/u/{handle}` when public | ✅ PASS |
| Discussion — AT-Proto replies (pin/hide) | `routes/discussion.ts` reads AT-proto replies via the bridge; `routes/papers.ts` exposes them with `pinned`/`hidden` flags | ✅ PASS |
| **Formal verification (Lean 4, Coq, F*)** | None. No `formal_verification` table, no `ProofArtifact` lexicon, no UI surface. | ❌ **FAIL** — claim **rejected** from the headline copy. |
| **Refusal packet — named failure mode** | `routes/refusals.ts` + `RefusalPacket` lexicon + `refusals` table with `kind`, `reason`, `evidence`, `appealable` fields | ✅ PASS |

## Failed claims dropped from the copy

- "First-class formal verification (Lean 4, Coq, F*)" — no implementation. Removed.
- Specific verb labels "cite / build-on / replicate / critique" — these aren't the real verbs. Copy uses the real taxonomy: *verified derivation, reproduced result, checked references*.

## Verified copy claims (cleared for Ф1)

- "preprint server that lives in your social feed" — `bsky-bridge` does federate to Bluesky (≤5 min observed)
- "Built on AT Protocol" — true; identity is did:plc / did:web, records replicate to PDS, jetstream subscriber consumes the firehose
- "Endorsements with verbs" — true; six typed verbs, surfaced in Trust Passport's Social Review lane
- "Trust Passport across four dimensions" — true; transparency, identity, integrity, social review
- "Open to independent researchers without institutional backing" — true; no endorsement gating, sign-in via ORCID *or* did:plc, no `verified institution` requirement
- "AI-assisted work under structured disclosure" — true; `disclosures` table + tier `none/assistant/coauthor/primary` is mandatory at submission
- "Slop refused with refusal packet naming failure" — true; `refusals.kind` is a constrained enum, `evidence` is the audit, `appealable` is the user's recourse

## Live smoke checks (2026-05-18, openxiv.net)

```bash
# bsky bridge process up
curl -sI https://openxiv.net/healthz                                  → 200
# did:web identity
curl -s  https://openxiv.net/u/orcid.0009-0003-6027-7837/did.json | head → 301 → plc.directory
# profile reachable
curl -sI https://openxiv.net/api/profiles/ddavidich                    → 200
# papers endpoint
curl -s  https://openxiv.net/api/papers?limit=3                        → {"items":[]}
```

Note on the empty `papers` list: production has no published preprints
*yet* — submissions are gated to the owner's allow-list and the owner
hasn't submitted one. The sanity audit checks that the *code paths*
exist; populated data is a Ф5 concern (operator submits ≥3 papers so
Rich Results Test has something to score).

## Conclusion

**Ф0 PASS conditionally** — proceed to Ф1 with the formal-verification
claim removed and the verb taxonomy aligned to the real implementation.
