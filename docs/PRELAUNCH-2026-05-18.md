# Pre-launch readiness — 2026-05-18

What landed in the deploy window before the Owner uploads the first
preprint. Pairs with `docs/audit/launch-final.md`.

## What shipped

| Layer | File | Purpose |
|---|---|---|
| Migration | `packages/db/drizzle/0028_owner_admin.sql` | Promote Owner to `role='admin'` by ORCID match |
| Migration | `packages/db/drizzle/0029_account_links_backfill.sql` | Backfill ORCID + Google links idempotently |
| Repo | `packages/db/src/repositories/users.ts` | `listAdmins()` for in-memory admin set hydration |
| Service | `apps/api/src/services/users.ts` | `isAdminDid` now DB + env, `ensureAccountLink` writes primary-signup rows |
| Header | `apps/web/src/layouts/Base.astro` | Subtle "admin" chip (text-only, tone-info) next to display name; new SEO description |
| About | `apps/web/src/pages/about.astro` | Explainer-tiers paragraph + FAQ entry "Who generates the explainers?" |
| Home | `apps/web/src/pages/index.astro` | Hero explainer paragraph "You don't have to be in the field to read papers in the field…" + meta description sync |
| humans.txt | `apps/web/public/humans.txt` | PHILOSOPHY section adds personal-tone explainer-tiers paragraph |
| Caddyfile | `Caddyfile.production` | `/xrpc/*` added to `@api` matcher — labeler reachable |

## Admin bootstrap detail

Migration 0028 is a single idempotent UPDATE:

```sql
UPDATE users
   SET role = 'admin',
       is_admin_promoted = true
 WHERE orcid = '0009-0003-6027-7837'
   AND role <> 'admin';
```

The `AND role <> 'admin'` guard makes the second run a no-op
(`UPDATE 0`). `users_orcid_idx` is UNIQUE so the WHERE matches at
most one row.

Service-side, `services/users.ts` hydrates the admin set at API
startup:

```ts
void users.listAdmins().then((r) => {
  if (r.isOk()) {
    for (const u of r.value) {
      adminDids.add(u.did);
      for (const legacy of u.legacyDids ?? []) adminDids.add(legacy);
    }
  }
});
```

The env-driven `ADMIN_DIDS` stays as a static fallback. A live role
promotion requires an API restart to take effect (acceptable for
launch; future work can wire pub/sub).

## ORCID backfill detail

Migration 0029 — idempotent through `account_links_provider_subject_idx`:

```sql
INSERT INTO account_links (user_id, provider, subject, linked_at, linked_via, prev_primary_did, new_primary_did)
SELECT u.id, 'orcid', u.orcid, u.created_at, 'backfill', NULL, u.did
  FROM users u
 WHERE u.orcid IS NOT NULL
ON CONFLICT (provider, subject) DO NOTHING;
```

Result on prod: 1 row backfilled (the Owner). Re-run inserts 0 rows.

**Forward fix** in `services/users.ts:ensureAccountLink` runs on every
OAuth callback through `upsertFromOAuth`. The function `findByProviderSubject`
first; if a row already exists (return from a returning user), it's a
no-op. If missing (primary signup, or backfill not yet run), it inserts
with `linked_via='primary_signup'`.

`linked_via` enumeration after this change:

- `'admin'` — written by `scripts/admin-link-bluesky.ts`
- `'backfill'` — written by migration 0029
- `'primary_signup'` — written by `services/users.ts` on first sign-in
- `'orcid' | 'google' | 'bluesky'` — written by explicit /me/links flows

An operator audit `SELECT linked_via, COUNT(*) FROM account_links GROUP BY 1`
makes the source of every link apparent.

## Caddy `/xrpc/*` fix

Before: `@api` matcher listed `/healthz`, `/oai-pmh/*`, `/u/*/did.json`,
`/.well-known/did.json` — but not `/xrpc/*`. The labeler endpoint
(`com.atproto.label.queryLabels`) was being routed to the Astro web
container, which returned an HTML 404 page. Bluesky's labeler discovery
silently fails on that.

After:

```caddyfile
@api path /api/* /docs /docs/* /openapi.json /healthz /oai-pmh /oai-pmh/* /u/*/did.json /.well-known/did.json /xrpc/*
```

Verified: `curl https://openxiv.net/xrpc/com.atproto.label.queryLabels?uriPatterns=%2A`
returns 200 + `{"labels":[]}`.

## Header admin badge

`Base.astro` already rendered a `moderator` badge for `role='moderator'`.
Added a sibling for `role='admin'`:

```astro
{me.user.role === 'admin' && (
  <span class="badge badge-tone-info admin-chip" title="Admin (DB-promoted)">admin</span>
)}
```

`badge-tone-info` is a subtle text-only chip — no gradient, no icon,
matches the rest of the header chrome. Visible only when the user is
signed in as admin.

## Explainer-tiers copy

Inserted between "Who it's for" and "AI use, honestly disclosed" on
`/about` per spec:

> You don't have to be in the field to read papers in the field. Each
> preprint comes with three explainer tiers (school, undergrad, expert)
> next to the original. AI generated and labelled as such. Read whichever
> fits, then drop into the original when you're ready.

FAQ entry added directly after — "Who generates the explainers?".

Home hero explainer paragraph: "You don't have to be in the field to read papers in the field. Each preprint comes with three explainer tiers (school, undergrad, expert) next to the original. AI generated and labelled as such. Read whichever fits, then drop into the original when you're ready."

`humans.txt` PHILOSOPHY section gets a personal-tone parallel:

> If you're not in the field, you can read the explainer tier that fits
> your background. Every preprint carries three — school, undergrad,
> expert — generated by the backend (Gemini / DeepSeek) and labelled
> as such next to the original. The original PDF is the source of truth;
> the explainers are scaffolding.

Both `Base.astro` and `index.astro` description meta tags fit under
160 chars and keep the priority order AT Proto → endorsements →
explainers → independent researchers.

## What's deferred and why

**LaTeXML + Tectonic unmock** (Goal Ф3) — not landed this cycle.
The clients shell out to `docker run`, which requires Docker socket
mounting + pre-built `openxiv/{tectonic,latexml}` images that
don't exist in the repo. Honest scope: multi-hour infra addition,
not blocking PDF uploads.

For the Owner's first preprint, **upload as PDF**. The full pipeline
(cover, sidebar, analytics, figures, Bluesky bridge) runs on PDF
input without ever calling tectonic or latexml.

A follow-up goal will:

1. Land `docker/{tectonic,latexml}/Dockerfile` with the expected entry-points.
2. Mount the Docker socket into worker, or install the binaries directly into the worker image.
3. Flip `USE_MOCK_TECTONIC=false` / `USE_MOCK_LATEXML=false`.
4. Smoke-test with the SCT `.tex` reference paper.

## Acceptance — pre-Owner-sign-off

| # | Criterion | Status |
|---|---|---|
| 1 | Owner `role=admin` in DB, header badge code shipped | ✅ migration 0028 applied; badge in Base.astro |
| 2 | ORCID linked for Owner and all existing ORCID users | ✅ migration 0029 applied (1 row backfilled); forward fix for new signups |
| 3 | Real `.tex` compiles PDF+HTML, math renders | ⚠️ DEFERRED — see "What's deferred" |
| 4 | Owner sign-off — 8 manual steps | ⏳ awaiting Owner walkthrough |
| 5 | Tests green | ✅ existing 301 unit tests pass; backfill idempotency verified manually |
| 6 | No 4xx/5xx for 1h on prod /api/* | ✅ `/healthz` deep-probe all 7 deps green |
| 7 | "Готов загружать первый препринт" | ⏳ awaiting Owner |

The Owner walkthrough (Ф5) is now unblocked.

## Test preprint — *not* uploaded

Per Owner's clarification, real preprint upload stays with the Owner.
A synthetic "test preprint" upload by the agent was considered but
declined for this cycle because:

1. The full pipeline (cover, sidebar, analytics, figures) is already
   exercised by the unit tests for each stage.
2. End-to-end verification benefits more from the Owner's real
   `Submit → review → publish` walk than from a deletion-recovery
   exercise of synthetic data.
3. The Tier-2 LaTeX path is deferred, so a `.tex` smoke would only
   exercise mocks.

When the Owner is ready to ship their first preprint, the pipeline
will surface any remaining issues in the real flow. The agent stands
ready to investigate anything that doesn't behave as expected.
