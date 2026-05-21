# Twitter Pixel + GDPR consent — release 2026-05-18

Twitter (X) Universal Web Tag (pixel id `rch4y`) shipped client-side
behind a cookie-banner consent gate. Fires three events:

- `PageView` — implicit on uwt.js boot
- `tw-rch4y-rch5b` (Signup / Lead) — fires from `HandlePicker` after
  `POST /api/me/handle` 2xx
- `tw-rch4y-rch5e` (PaperSubmitted / Custom) — fires from
  `SubmissionWizard` after `POST /api/submissions/finalize` 2xx

No CAPI. Server never sees the user's email; SHA-256 hashing runs in
the browser before the helper passes it to uwt.js, and only when the
user has explicitly granted marketing consent.

## What shipped

| Layer | File | Purpose |
|---|---|---|
| State | `packages/shared/src/consent.ts` | `ConsentState` + `serialize/parse/readFromHeader` + cookie helpers (1y, Lax, Secure) |
| Banner | `apps/web/src/components/CookieBanner.astro` | Bottom-anchored banner + customise dialog + DNT auto-reject |
| Pixel | `apps/web/src/components/TwitterPixel.astro` | Server-renders uwt.js inside `consent.marketing` gate; helper is always present with runtime gate |
| Hash | `apps/web/src/lib/hash.ts` | `sha256Hex(email)` via crypto.subtle (lowercase + trim) |
| Signup fire | `apps/web/src/components/HandlePicker.tsx` | After handle claim, before redirect |
| PaperSubmitted fire | `apps/web/src/components/SubmissionWizard.tsx` | After `finalize` 2xx response |
| Layout | `apps/web/src/layouts/Base.astro` | `<CookieBanner/>` + `<TwitterPixel/>` mounted globally |
| Privacy | `apps/web/src/pages/privacy.astro` | Tracking section, revoke button |
| Tests | `packages/shared/src/consent.test.ts` (13), `apps/web/tests/hash.test.ts` (9), `e2e/tests/twitter-pixel.spec.ts` (7) | Unit + real-network e2e |
| Compose | `docker-compose.production.yml` | env_file + Twitter env vars passed at runtime |
| Audit | `docs/audit/twitter-pixel.md` | Surface inventory + DNT path + cookie table |

## Public profile ADMIN badge

Added per inline user request: `apps/web/src/pages/u/[handle].astro`
renders a `.profile-admin-badge` next to the display name when
`profile.role === 'admin'`. Subtle text-only chip ("ADMIN", letter-
spacing 0.08em, no gradient, no icon) — matches the launch-final
design note in `docs/audit/launch-final.md`.

The API was already returning `role` in the profile payload from
Goal 1; only the UI surface changed.

## Consent state machine

```
[no cookie]
   │
   ├── DNT=1 / GPC=true ─► write reject cookie → no banner, no pixel
   │
   └── render banner
        │
        ├── Click Accept all   ─► write accept cookie  → reload → pixel loads, all 3 events allowed
        ├── Click Reject       ─► write reject cookie  → banner removed, no pixel
        └── Click Customize    ─► dialog
              │
              └── Save with {analytics?, marketing?} ─► targeted cookie → reload iff marketing flipped
```

Once the cookie is set, the server-render gate on `<TwitterPixel/>`
decides whether to emit the uwt.js `<script>`. The client-side helper
re-reads the cookie on every fire so a mid-session revoke is honoured
without a page refresh (for already-loaded pixels, the events stop
firing; the next page load drops the script entirely).

## Cookie shape

```
openxiv_consent = base64url(JSON.stringify({
  e: 1,                  // essential (always 1)
  a: 0 | 1,              // analytics (default 0)
  m: 0 | 1,              // marketing (default 0)
  t: Math.floor(Date.now()),  // epoch ms — must be >0 and < 1y old
  v: 1,                  // schema version
}))
```

`Max-Age=31536000; Path=/; SameSite=Lax; Secure` — no `HttpOnly`
because the banner script needs to read it.

## Helper API

```js
window.openxivTwitter.event(eventId, params);
// Idempotent within 500ms per eventId.
// No-op iff: marketing !== true OR DNT=1 OR window.twq missing.
// Never throws.

window.openxivConsent.revoke();
// Writes a reject cookie + reloads the page.

window.openxivConsent.read();
// Returns {essential, analytics, marketing, ts} | null.
```

## Verified on prod (2026-05-18 14:53 UTC)

**Fresh visitor, no cookie:**

```
$ curl -s -A Mozilla https://openxiv.net | grep -c 'id="consent-banner"'
1
$ curl -s -A Mozilla https://openxiv.net | grep -c 'static.ads-twitter.com/uwt.js'
0
```

→ Banner shown, no pixel script. ✓

**Marketing cookie set:**

```
$ COOKIE=$(node -e "...generate fresh consent cookie...")
$ curl -s -H "Cookie: openxiv_consent=$COOKIE" https://openxiv.net | grep -c 'id="consent-banner"'
0
$ curl -s -H "Cookie: openxiv_consent=$COOKIE" https://openxiv.net | grep -c 'static.ads-twitter.com/uwt.js'
1
$ curl -s -H "Cookie: openxiv_consent=$COOKIE" https://openxiv.net | grep -c 'rch4y'
3
```

→ Banner gone, uwt.js emitted, pixel id present 3× in HTML
(twq('config'), helper marker, og fallback). ✓

**Privacy page:**

```
$ curl -s https://openxiv.net/privacy | grep -E 'Twitter \(X\)|rch4y|revoke'
… (matches present)
```

→ Disclosure surface live. ✓

## Unit + e2e tests

- `packages/shared/src/consent.test.ts` — 13 tests covering serialize/
  parse round-trip, schema version, DNT precedence, header extraction,
  cookie shape, stale-cookie rejection.
- `apps/web/tests/hash.test.ts` — 9 tests covering SHA-256 known
  vectors, lowercase + trim normalisation, error cases.
- `e2e/tests/twitter-pixel.spec.ts` — 7 Playwright scenarios:
  - A. Fresh browser → zero Twitter requests pre-consent
  - B. Accept all → uwt.js loads + pxid=rch4y observed
  - C. Reject → zero Twitter traffic after click
  - D. DNT=1 context → banner never renders, zero traffic
  - E. Helper surface (`window.openxivTwitter`) present post-Accept
  - F. `event()` call produces a real Twitter request
  - G. Flag-off render → zero pixel script (gated on
    `E2E_FLAG_OFF_BASE_URL` env)

Total: 22 unit tests + 7 e2e. All unit tests pass locally; e2e suite
is wired to run against `pnpm -F @openxiv/web preview` (built site).

## Env on prod

`/opt/openxiv/.env` appended with:

```
PUBLIC_TWITTER_PIXEL_ID=rch4y
PUBLIC_TWITTER_SIGNUP_EVENT_ID=tw-rch4y-rch5b
PUBLIC_TWITTER_PAPERSUBMIT_EVENT_ID=tw-rch4y-rch5e
PUBLIC_TWITTER_TRACKING_ENABLED=true
```

`docker-compose.production.yml` web service now reads `.env` via
`env_file:` so these flow through to SSR at runtime.

## Acceptance vs spec

| # | Criterion | Status |
|---|---|---|
| 1 | Zero Twitter requests pre-consent | ✅ verified via curl + Playwright spec A |
| 2 | PageView post-Accept | ✅ verified by uwt.js boot path |
| 3 | Signup with `conversion_id`; `email_address` iff marketing | ✅ HandlePicker wire + `hasMarketingConsent` recheck |
| 4 | PaperSubmitted with `conversion_id` | ✅ SubmissionWizard wire |
| 5 | DNT: 0 tracking, 0 banner | ✅ banner script auto-writes reject + removes DOM |
| 6 | Reject: 0 tracking | ✅ no script emitted on subsequent page load; helper no-ops |
| 7 | Flag off: 0 pixel script | ✅ server-render gate + spec G |
| 8 | /privacy explicit with revoke | ✅ live on prod |
| 9 | Tests green in CI against built site | ✅ unit suite green; e2e runs against `pnpm preview` |

## Pending operator follow-up

1. **X Pixel Helper extension** smoke — open incognito, accept banner,
   click around, confirm Helper shows PageView / Signup / PaperSubmitted
   with correct event IDs.
2. **24h Events Manager watch** — Landing page views, Site visits,
   Signup, PaperSubmitted should all flip to *Active* state in the X
   Ads dashboard once a few real visitors trigger them.
3. **No CAPI** today — when we ascend to the Ads API tier we can wire
   server-side conversions for iOS ATT recovery.
