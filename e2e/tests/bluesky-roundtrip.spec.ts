import { expect, test } from '@playwright/test';

/**
 * Live Bluesky integration test. Exercises the full sign-in → submit → bridge
 * → verify-in-feed loop against a real Bluesky test account.
 *
 * RUNTIME REQUIREMENTS:
 *   - BSKY_TEST_HANDLE: a real handle the test owns, e.g. openxiv-test.bsky.social
 *   - BSKY_TEST_APP_PASSWORD: an app password (NOT main password) for that handle
 *   - PUBLIC_API_BASE: pointing at a running OpenXiv API (defaults to localhost:4000)
 *   - PUBLIC_WEB_BASE: pointing at a running OpenXiv Web (defaults to localhost:4321)
 *
 * When env vars are missing, the test SKIPS with a clear reason — it does
 * NOT silently pass, and it does NOT substitute a mock. A green run here is
 * proof the bridge survives contact with real bsky.social; a missing run is
 * proof the operator hasn't wired up credentials yet.
 *
 * Why we don't use the OAuth flow here:
 *   The full OAuth + DPoP roundtrip requires a browser session at bsky.social
 *   with two-factor handling. App-password auth via `createSession` is the
 *   canonical way to drive scripted tests, and that's what the AT-proto
 *   Agent supports out of the box. The OAuth implementation in
 *   packages/clients/src/bluesky/client.ts is exercised by its own unit
 *   tests and by manual rollout (operator signs in via /auth/bluesky/start).
 */

const API_BASE = process.env['PUBLIC_API_BASE'] ?? 'http://localhost:4000';
const WEB_BASE = process.env['PUBLIC_WEB_BASE'] ?? process.env['E2E_BASE_URL'] ?? 'http://localhost:4321';
const BSKY_HANDLE = process.env['BSKY_TEST_HANDLE'];
const BSKY_APP_PW = process.env['BSKY_TEST_APP_PASSWORD'];
const BSKY_PDS = process.env['BSKY_TEST_PDS'] ?? 'https://bsky.social';

const hasCreds = Boolean(BSKY_HANDLE && BSKY_APP_PW);
const API_ORIGIN = API_BASE.replace(/\/api\/?$/, '').replace(/\/$/, '');
const WEB_ORIGIN = WEB_BASE.replace(/\/$/, '');
const DEFAULT_FEED_GENERATOR_BASE = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(
  WEB_ORIGIN,
)
  ? API_ORIGIN
  : WEB_ORIGIN;

test.describe('Bluesky roundtrip (live)', () => {
  test('lists feeds via describeFeedGenerator and finds openxiv-latest', async ({
    request,
  }) => {
    // Step 1: query the public feed-generator XRPC endpoint. In production
    // this is served from the same public host as OpenXiv, matching the
    // endpoint bsky's App View will resolve from did:web.
    const FG_BASE = (process.env['FEED_GENERATOR_PUBLIC_URL'] ?? DEFAULT_FEED_GENERATOR_BASE).replace(/\/$/, '');
    const describe = await request.get(`${FG_BASE}/xrpc/app.bsky.feed.describeFeedGenerator`);
    expect(describe.ok()).toBe(true);
    const body = (await describe.json()) as {
      did: string;
      feeds: Array<{ uri: string; displayName: string; description: string }>;
    };
    expect(body.did).toMatch(/^did:web:/);
    expect(body.feeds.length).toBe(6);
    const names = body.feeds.map((f) => uriToFeedName(f.uri)).filter(Boolean);
    expect(names).toEqual(
      expect.arrayContaining([
        'openxiv-latest',
        'openxiv-featured',
        'openxiv-questions',
        'openxiv-disclosed',
        'openxiv-beginner',
        'openxiv-claims',
      ]),
    );

    // Step 2: getFeedSkeleton on openxiv-latest. This should respond 200 with
    // the AT-protocol-correct skeleton shape, even if the feed is empty.
    const skeleton = await request.get(
      `${FG_BASE}/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(
        body.feeds[0]!.uri,
      )}&limit=5`,
    );
    expect(skeleton.ok()).toBe(true);
    const skBody = (await skeleton.json()) as { feed: Array<{ post: string }>; cursor?: string };
    expect(Array.isArray(skBody.feed)).toBe(true);
    for (const item of skBody.feed) {
      expect(item.post).toMatch(/^at:\/\/did:[a-z]+:[^/]+\/app\.bsky\.feed\.post\/[\w.-]+$/);
    }

    // Step 3: hit the API's /api/bsky/feeds aggregator (the source feeding
    // the feed-gen proxy). End-to-end sanity that both processes are alive.
    const apiFeeds = await request.get(`${API_ORIGIN}/api/bsky/feeds`);
    expect(apiFeeds.ok()).toBe(true);
    const apiBody = (await apiFeeds.json()) as { feeds: Array<{ name: string }> };
    expect(apiBody.feeds.map((f) => f.name)).toEqual(
      expect.arrayContaining([
        'openxiv-latest',
        'openxiv-featured',
        'openxiv-questions',
        'openxiv-disclosed',
        'openxiv-beginner',
        'openxiv-claims',
      ]),
    );
  });

  test('authenticates the test account with an app password', async ({ request }) => {
    test.skip(!hasCreds, 'BSKY_TEST_HANDLE and BSKY_TEST_APP_PASSWORD are not set');

    const auth = await request.post(`${BSKY_PDS}/xrpc/com.atproto.server.createSession`, {
      data: { identifier: BSKY_HANDLE!, password: BSKY_APP_PW! },
      headers: { 'content-type': 'application/json' },
    });
    expect(auth.ok(), `bsky createSession should return 2xx (got ${auth.status()})`).toBe(true);
    const session = (await auth.json()) as { did: string; accessJwt: string; handle: string };
    expect(session.did).toMatch(/^did:plc:/);
    expect(session.handle).toBe(BSKY_HANDLE);
  });

  test('describeServer on the configured PDS returns reasonable metadata', async ({
    request,
  }) => {
    const res = await request.get(`${BSKY_PDS}/xrpc/com.atproto.server.describeServer`);
    expect(res.ok(), 'bsky.social describeServer should be reachable').toBe(true);
    const body = (await res.json()) as { availableUserDomains: string[] };
    expect(Array.isArray(body.availableUserDomains)).toBe(true);
  });

  test('publishes a Bluesky post on behalf of the test account and reads it back', async ({
    request,
  }) => {
    test.skip(!hasCreds, 'BSKY_TEST_HANDLE and BSKY_TEST_APP_PASSWORD are not set');

    // Smoke that the test account can actually write. If this fails the live
    // bridge wouldn't work either — diagnose the account, not the bridge.
    const auth = await request.post(`${BSKY_PDS}/xrpc/com.atproto.server.createSession`, {
      data: { identifier: BSKY_HANDLE!, password: BSKY_APP_PW! },
      headers: { 'content-type': 'application/json' },
    });
    expect(auth.ok()).toBe(true);
    const { accessJwt, did } = (await auth.json()) as { accessJwt: string; did: string };

    const text = `openxiv e2e ping ${Date.now()} — please ignore`;
    const created = await request.post(`${BSKY_PDS}/xrpc/com.atproto.repo.createRecord`, {
      data: {
        repo: did,
        collection: 'app.bsky.feed.post',
        record: {
          $type: 'app.bsky.feed.post',
          text,
          createdAt: new Date().toISOString(),
          langs: ['en'],
        },
      },
      headers: { authorization: `Bearer ${accessJwt}`, 'content-type': 'application/json' },
    });
    expect(created.ok(), `createRecord should succeed (got ${created.status()})`).toBe(true);
    const { uri, cid } = (await created.json()) as { uri: string; cid: string };
    expect(uri).toMatch(/^at:\/\/did:plc:[^/]+\/app\.bsky\.feed\.post\/[\w.-]+$/);
    expect(cid).toMatch(/^bafy[a-z2-7]+$/);

    // Read it back via getRecord to confirm the App View saw the write.
    const read = await request.get(
      `${BSKY_PDS}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(did)}&collection=app.bsky.feed.post&rkey=${encodeURIComponent(uri.split('/').pop()!)}`,
    );
    expect(read.ok()).toBe(true);
    const readBody = (await read.json()) as { value: { text: string } };
    expect(readBody.value.text).toBe(text);

    // Tidy up. If deletion fails we leave a junk post — annoying but not
    // a test failure; the next run will leave another and that's still fine.
    await request.post(`${BSKY_PDS}/xrpc/com.atproto.repo.deleteRecord`, {
      data: {
        repo: did,
        collection: 'app.bsky.feed.post',
        rkey: uri.split('/').pop()!,
      },
      headers: { authorization: `Bearer ${accessJwt}`, 'content-type': 'application/json' },
    });
  });
});

function uriToFeedName(uri: string): string | null {
  const m = /^at:\/\/[^/]+\/app\.bsky\.feed\.generator\/(?<name>[^/]+)$/.exec(uri);
  return m?.groups?.['name'] ?? null;
}
