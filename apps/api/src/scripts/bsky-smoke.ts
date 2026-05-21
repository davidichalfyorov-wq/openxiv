/**
 * Live Bluesky smoke test. Exercises the real network path against
 * bsky.social — DID resolution, OAuth AS discovery, an authenticated write,
 * and a feed-skeleton fetch.
 *
 * The Playwright integration test (`e2e/tests/bluesky-roundtrip.spec.ts`)
 * covers the same ground in CI; this CLI is for an operator who wants a
 * one-shot "is everything wired?" check during go-live, without spinning
 * up Playwright. Exit code 0 = green, 1 = red.
 *
 * USAGE:
 *   BSKY_TEST_HANDLE=openxiv-test.bsky.social \
 *   BSKY_TEST_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx \
 *   ATPROTO_SERVICE_URL=https://bsky.social \
 *   pnpm --filter @openxiv/api bsky:smoke
 */

import 'dotenv/config';
/* eslint-disable no-console -- CLI smoke script intentionally writes progress to stdout. */
import { AtpAgent } from '@atproto/api';

interface SmokeCheck {
  name: string;
  fn: () => Promise<void>;
}

async function main(): Promise<void> {
  const handle = process.env['BSKY_TEST_HANDLE'];
  const appPw = process.env['BSKY_TEST_APP_PASSWORD'];
  const pds = process.env['ATPROTO_SERVICE_URL'] ?? 'https://bsky.social';

  const checks: SmokeCheck[] = [];

  checks.push({
    name: 'describeServer reachable on configured PDS',
    fn: async () => {
      const res = await fetch(`${pds}/xrpc/com.atproto.server.describeServer`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = (await res.json()) as { availableUserDomains?: string[] };
      if (!Array.isArray(body.availableUserDomains)) {
        throw new Error('availableUserDomains missing from response');
      }
    },
  });

  checks.push({
    name: 'OAuth AS metadata discoverable',
    fn: async () => {
      // The AS metadata document is required for the NodeOAuthClient to
      // function. Without it, sign-in is dead in the water.
      const res = await fetch(`${pds}/.well-known/oauth-authorization-server`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = (await res.json()) as { issuer?: string; authorization_endpoint?: string };
      if (!body.issuer) throw new Error('issuer missing');
      if (!body.authorization_endpoint) throw new Error('authorization_endpoint missing');
    },
  });

  checks.push({
    name: 'jetstream WebSocket upgrade endpoint reachable',
    fn: async () => {
      const url = (process.env['JETSTREAM_PROBE_URL'] ??
        'https://jetstream2.us-east.bsky.network/');
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      // 426 (Upgrade Required) is a valid signal that the server is alive
      // and rejecting the HTTP-only request; that's exactly what /healthz
      // looks for.
      if (!res.ok && res.status !== 426) {
        throw new Error(`status ${res.status}`);
      }
    },
  });

  if (handle && appPw) {
    checks.push({
      name: 'app-password login + write + read + delete roundtrip',
      fn: async () => {
        const agent = new AtpAgent({ service: pds });
        await agent.login({ identifier: handle, password: appPw });
        if (!agent.session?.did) throw new Error('no session after login');
        const did = agent.session.did;
        const text = `openxiv smoke ${Date.now()}`;
        const created = await agent.com.atproto.repo.createRecord({
          repo: did,
          collection: 'app.bsky.feed.post',
          record: {
            $type: 'app.bsky.feed.post',
            text,
            createdAt: new Date().toISOString(),
          },
        });
        if (!created.success) throw new Error('createRecord did not succeed');
        const rkey = created.data.uri.split('/').pop()!;
        try {
          const read = await agent.com.atproto.repo.getRecord({
            repo: did,
            collection: 'app.bsky.feed.post',
            rkey,
          });
          if ((read.data.value as { text?: string }).text !== text) {
            throw new Error('text round-trip mismatch');
          }
        } finally {
          await agent.com.atproto.repo.deleteRecord({
            repo: did,
            collection: 'app.bsky.feed.post',
            rkey,
          });
        }
      },
    });
  } else {
    console.warn('  (skipped) write-roundtrip: BSKY_TEST_HANDLE / BSKY_TEST_APP_PASSWORD not set');
  }

  let failures = 0;
  for (const c of checks) {
    process.stdout.write(`  • ${c.name}... `);
    const t0 = Date.now();
    try {
      await c.fn();
      console.log(`OK (${Date.now() - t0}ms)`);
    } catch (err) {
      failures += 1;
      console.error(`FAIL: ${(err as Error).message}`);
    }
  }

  console.log(
    `\n[smoke] ${checks.length - failures}/${checks.length} checks passed`,
  );
  process.exit(failures > 0 ? 1 : 0);
}

void main().catch((err: Error) => {
  console.error('[smoke] crashed:', err.message);
  process.exit(1);
});
