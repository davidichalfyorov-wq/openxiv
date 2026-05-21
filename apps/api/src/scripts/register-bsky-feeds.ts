/**
 * Register the six OpenXiv feeds as `app.bsky.feed.generator` records on
 * Bluesky. Runs once during deployment (or whenever the feed catalog
 * changes). Bluesky's feed catalogue is discovery-driven, not registry-
 * driven: publishing the record under your handle's PDS is what makes the
 * feed indexable by bsky.app's feed search.
 *
 * USAGE:
 *   FEED_PUBLISHER_HANDLE=openxiv.bsky.social \
 *   FEED_PUBLISHER_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx \
 *   FEED_GENERATOR_DID=did:web:openxiv.net \
 *   FEED_GENERATOR_PUBLIC_URL=https://fg.openxiv.net \
 *   ATPROTO_SERVICE_URL=https://bsky.social \
 *   pnpm --filter @openxiv/api exec tsx src/scripts/register-bsky-feeds.ts
 *
 * The publisher account ends up owning records like:
 *   at://did:plc:<publisher>/app.bsky.feed.generator/openxiv-latest
 * with the record's `did` field set to FEED_GENERATOR_DID — that's the
 * indirection the App View uses to find the getFeedSkeleton endpoint.
 *
 * Idempotent: re-running updates the existing records via `putRecord`,
 * keeping the same rkey so the public URI doesn't change.
 */

import 'dotenv/config';
/* eslint-disable no-console -- CLI registration script intentionally prints published feed URLs. */
import { AtpAgent } from '@atproto/api';

const FEEDS = [
  {
    rkey: 'openxiv-latest',
    displayName: 'OpenXiv — latest',
    description: 'Every new OpenXiv paper as it lands. Embed cards link to the abstract page.',
  },
  {
    rkey: 'openxiv-featured',
    displayName: 'OpenXiv — featured',
    description: 'Editor picks: papers worth your attention right now.',
  },
  {
    rkey: 'openxiv-questions',
    displayName: 'OpenXiv — hard questions',
    description: "Papers whose authors pinned a question they couldn't answer.",
  },
  {
    rkey: 'openxiv-disclosed',
    displayName: 'OpenXiv — fully disclosed',
    description: 'Papers with primary-author AI disclosure.',
  },
  {
    rkey: 'openxiv-beginner',
    displayName: "OpenXiv — explain like I'm new",
    description:
      'Every paper here has a school-level summary you can read in a minute.',
  },
  {
    rkey: 'openxiv-claims',
    displayName: 'OpenXiv — claim cards',
    description:
      'Papers shipped with 2+ author claim cards — easy to scan, easy to dispute.',
  },
];

interface RegisterOptions {
  readonly publisherHandle: string;
  readonly publisherAppPassword: string;
  readonly feedGeneratorDid: string;
  readonly atprotoServiceUrl: string;
}

async function main(): Promise<void> {
  const opts = readOpts();
  const agent = new AtpAgent({ service: opts.atprotoServiceUrl });
  await agent.login({
    identifier: opts.publisherHandle,
    password: opts.publisherAppPassword,
  });
  const publisherDid = agent.session?.did;
  if (!publisherDid) throw new Error('login succeeded but session.did is missing');
  console.log(`[register] logged in as ${opts.publisherHandle} (${publisherDid})`);
  console.log(`[register] publishing under feed-gen DID ${opts.feedGeneratorDid}`);

  const results: Array<{ rkey: string; uri: string; cid: string }> = [];
  for (const feed of FEEDS) {
    const record = {
      $type: 'app.bsky.feed.generator',
      did: opts.feedGeneratorDid,
      displayName: feed.displayName,
      description: feed.description,
      createdAt: new Date().toISOString(),
    };
    // putRecord = create-or-update at a fixed rkey. The record's CID will
    // change every time we putRecord with a new createdAt; that's fine and
    // expected by the App View.
    const res = await agent.com.atproto.repo.putRecord({
      repo: publisherDid,
      collection: 'app.bsky.feed.generator',
      rkey: feed.rkey,
      record,
    });
    if (!res.success) {
      throw new Error(`putRecord failed for ${feed.rkey}: ${JSON.stringify(res.data)}`);
    }
    results.push({ rkey: feed.rkey, uri: res.data.uri, cid: res.data.cid });
    console.log(`  ✔ ${feed.rkey} -> ${res.data.uri}`);
  }

  console.log('\n[register] all 6 feeds published.\n');
  console.log('Add these to bsky.app:');
  for (const r of results) {
    const [_at, _empty, did, _coll, rkey] = r.uri.split('/');
    console.log(
      `  ${r.rkey}: https://bsky.app/profile/${encodeURIComponent(did!)}/feed/${encodeURIComponent(rkey!)}`,
    );
  }
}

function readOpts(): RegisterOptions {
  const publisherHandle = process.env['FEED_PUBLISHER_HANDLE'];
  const publisherAppPassword = process.env['FEED_PUBLISHER_APP_PASSWORD'];
  const feedGeneratorDid = process.env['FEED_GENERATOR_DID'] ?? 'did:web:openxiv.net';
  const atprotoServiceUrl = process.env['ATPROTO_SERVICE_URL'] ?? 'https://bsky.social';
  if (!publisherHandle || !publisherAppPassword) {
    console.error(
      'Missing env: FEED_PUBLISHER_HANDLE and FEED_PUBLISHER_APP_PASSWORD must be set.',
    );
    process.exit(1);
  }
  return { publisherHandle, publisherAppPassword, feedGeneratorDid, atprotoServiceUrl };
}

void main().catch((err: Error) => {
  console.error('[register] failed:', err.message);
  process.exit(1);
});
