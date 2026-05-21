# Bluesky go-live runbook

Steps to flip OpenXiv from "skeleton + mocks" to a live AT-proto deployment.
Everything here is human-driven: each step needs credentials, DNS, or a UI
action that the codebase cannot perform on its own.

The code path is complete. What this doc covers is the manual configuration
the operator (you) must do once on production before the first sign-in.

## 0. Prerequisites

You need:
- A Bluesky account that will publish the feeds and own the starter pack.
  Suggested handle: `openxiv.bsky.social` (the org account).
- A second Bluesky account for integration tests. Suggested handle:
  `openxiv-test.bsky.social`. Use a separate email; never reuse the
  publisher's password.
- DNS control of `openxiv.net` (you already have it).
- Production deploy with HTTPS on `openxiv.net`, `fg.openxiv.net`,
  `api.openxiv.net` (or whatever subdomains your Caddy config uses).

## 1. Create the test account

Bluesky does not expose a programmatic signup with email + invite, so do
this in the browser at https://bsky.app/signup using
`openxiv-test.bsky.social` as the handle.

After signup, generate an **app password** (Settings → App Passwords) named
something like `e2e-tests`. Copy the value once — Bluesky won't show it
again. Store it in your password manager and in the CI secret store.

Do the same for the publisher account (`openxiv.bsky.social`) — generate a
separate app password named `feed-publisher`. **Never** use either main
password.

## 2. Publish the OAuth client metadata document

Deploy the Astro web app. The endpoint
`https://openxiv.net/oauth/client-metadata.json` must serve a JSON document
(see `apps/web/src/pages/oauth/client-metadata.json.ts`). Verify with:

```bash
curl -s https://openxiv.net/oauth/client-metadata.json | jq .
```

Expect:
```json
{
  "client_id": "https://openxiv.net/oauth/client-metadata.json",
  "client_name": "OpenXiv",
  "redirect_uris": ["https://api.openxiv.net/auth/bluesky/callback"],
  "scope": "atproto transition:generic",
  "dpop_bound_access_tokens": true,
  ...
}
```

Set the API's env: `BLUESKY_OAUTH_CLIENT_ID=https://openxiv.net/oauth/client-metadata.json`.

## 3. Publish the feed-generator DID document

The feed-gen process serves `/.well-known/did.json` itself. Make sure
`did:web:openxiv.net` resolves to a document containing the BskyFeedGenerator
service block. Verify with:

```bash
curl -s https://openxiv.net/.well-known/did.json | jq .
```

If you host the feed-gen on a subdomain (`fg.openxiv.net`), use
`did:web:fg.openxiv.net` and route the `.well-known` path there instead.
The `serviceEndpoint` in the DID document must be the public HTTPS URL of
the feed-gen process (what bsky's App View will call).

Update env:
```
FEED_GENERATOR_DID=did:web:openxiv.net
FEED_GENERATOR_PUBLIC_URL=https://fg.openxiv.net
```

## 4. Register the six feed records

Run once, on production, with the publisher app password:

```bash
FEED_PUBLISHER_HANDLE=openxiv.bsky.social \
FEED_PUBLISHER_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx \
FEED_GENERATOR_DID=did:web:openxiv.net \
ATPROTO_SERVICE_URL=https://bsky.social \
pnpm --filter @openxiv/api bsky:register-feeds
```

This publishes one `app.bsky.feed.generator` record per feed under the
publisher's PDS. The script is idempotent — re-run it whenever the feed
catalogue (display names / descriptions) changes.

You'll see output like:
```
[register] logged in as openxiv.bsky.social (did:plc:abcdef...)
[register] publishing under feed-gen DID did:web:openxiv.net
  ✔ openxiv-latest -> at://did:plc:abcdef/app.bsky.feed.generator/openxiv-latest
  ...
Add these to bsky.app:
  openxiv-latest: https://bsky.app/profile/did%3Aplc%3Aabcdef/feed/openxiv-latest
```

The "add to bsky.app" links are shareable. The `/feeds` page on the web app
also surfaces them under the publisher DID once feed records are live.

Submission to the Bluesky directory: Bluesky does not maintain a central
feed directory. A feed becomes discoverable as soon as its record is
indexed by the App View (usually <1 min). To boost discovery, post a
welcome thread from `openxiv.bsky.social` linking each feed.

## 5. Smoke test

Run the smoke check from a deployed host (or anywhere with public network
access):

```bash
BSKY_TEST_HANDLE=openxiv-test.bsky.social \
BSKY_TEST_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx \
ATPROTO_SERVICE_URL=https://bsky.social \
pnpm --filter @openxiv/api bsky:smoke
```

Expected output:
```
  • describeServer reachable on configured PDS... OK (180ms)
  • OAuth AS metadata discoverable... OK (160ms)
  • jetstream WebSocket upgrade endpoint reachable... OK (200ms)
  • app-password login + write + read + delete roundtrip... OK (1200ms)
[smoke] 4/4 checks passed
```

A failure here means production CAN'T sign anyone in via Bluesky. Fix it
before flipping the feature flag.

## 6. Run the live E2E roundtrip

The Playwright spec `e2e/tests/bluesky-roundtrip.spec.ts` requires the
same env variables and a running OpenXiv stack. It exercises:
- `describeServer` on the configured PDS
- `app.bsky.feed.describeFeedGenerator` returns the six feeds
- `app.bsky.feed.getFeedSkeleton` returns a valid skeleton shape
- The `/api/bsky/feeds` aggregator on the OpenXiv API
- An end-to-end write → read → delete on the test account

```bash
PUBLIC_API_BASE=https://api.openxiv.net \
FEED_GENERATOR_PUBLIC_URL=https://fg.openxiv.net \
BSKY_TEST_HANDLE=openxiv-test.bsky.social \
BSKY_TEST_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx \
pnpm --filter @openxiv/e2e test bluesky-roundtrip
```

When env vars are absent the spec auto-skips with a `BSKY_TEST_HANDLE and
BSKY_TEST_APP_PASSWORD are not set` reason — that's a green CI run with a
clear gap. Don't claim the bridge works without a green run here.

## 7. Enable feature flags

By default the cross-Bluesky features are gated. Flip them in production
Redis (or `OPENXIV_FLAG_*` env override) when you're ready:

```bash
# Bridge — start with this. Marks paper_versions.bridge_status='posted'
# after the v1 record lands on the author's PDS.
redis-cli HSET openxiv:flags bluesky_bridge 1

# Jetstream mention ingestion. Off by default — flip when the labeler is
# tested, otherwise you'll cross-post every bsky reference into your DB.
redis-cli HSET openxiv:flags bluesky_jetstream 1

# Bluesky follow graph mirror for "you follow on Bluesky" hints on /u/{}.
redis-cli HSET openxiv:flags bluesky_follows 1
```

Flag names live in `apps/api/src/services/flags.ts` under `FLAGS`.

## 8. Publish a starter pack

Use the admin route (your DID must be in `ADMIN_DIDS`):

```bash
curl -X POST https://api.openxiv.net/api/admin/bsky/starter-packs \
  -H "Cookie: <signed-in-admin-cookie>" \
  -H "content-type: application/json" \
  -d '{
    "name": "Scientists on OpenXiv",
    "description": "Researchers shipping preprints with full AI disclosure on OpenXiv.",
    "listName": "OpenXiv contributors",
    "dids": ["did:plc:...", "did:plc:..."],
    "feeds": ["at://did:plc:<publisher>/app.bsky.feed.generator/openxiv-latest"]
  }'
```

Response includes `bskyDeepLink` you can share publicly.

## 9. Operational notes

- **Rate limit**: bsky.social allows ~300 writes / 5 min per account. Our
  bridge writes one post per paper + up to 4 claim-card replies. Even at
  10 papers/min that's 50 writes — well inside the budget.
- **Token refresh**: the OAuth client library handles refresh transparently.
  Look for `[bsky.restoreSession]` lines in pino logs if you see degraded
  bridge behaviour.
- **Circuit breaker trips**: `[circuit:bsky.restoreSession] open` in logs
  means bsky.social was unhealthy for the rolling window. The bridge marks
  affected versions `bridge_status='failed'` — you can re-run the bridge
  via the admin retrigger once bsky recovers (TODO admin route).
- **Jetstream cursor**: on restart the consumer replays the last ~5 seconds
  from `bsky:jetstream:cursor`. If you ever need to reset, `redis-cli DEL
  bsky:jetstream:cursor` and restart workers.
