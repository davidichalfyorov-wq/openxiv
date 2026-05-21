import {
  Errors,
  type AppResultAsync,
  ResultAsync,
  fromPromise,
} from '@openxiv/shared';
import type { BlueskyAgentSession } from '@openxiv/clients';
import type { PaperRecord, PaperVersionRecord } from '@openxiv/db';
import type { AppContext } from '../context.js';
import { isFeatureEnabled } from './flags.js';

/**
 * Bluesky cross-post bridge. For each paper version:
 *   - v1 → top-level app.bsky.feed.post with embed.external pointing to the
 *     openxiv.net/p/<id> page (title + abstract + thumbnail).
 *   - v2+ → reply to the v1 anchor, so updates surface as a thread under the
 *     original announcement instead of as new disconnected posts.
 *
 * Idempotency is enforced at the paper_versions row: if `bridge_status='posted'`
 * we return the cached URI/CID without making any network call. Saga retries
 * therefore can't double-post.
 *
 * Failure is non-fatal: a network or auth error sets `bridge_status='failed'`
 * with the error message but resolves Ok(undefined) to the saga. An admin can
 * later trigger a retry via the dedicated admin route.
 *
 * Gated by the feature flag `bluesky_bridge`: when off, the bridge marks
 * versions as `skipped` immediately so we don't leave orphaned `pending` rows.
 */

const BRIDGE_FLAG = 'bluesky_bridge';
const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/g;
const TAG_RE = /(^|[^\w#])#([\p{L}\p{N}_]{2,32})/gu;
const MAX_POST_TEXT_BYTES = 300;
const MAX_TITLE_BYTES = 200;
const MAX_DESC_BYTES = 300;

export interface BridgeContext {
  readonly publicBase: string;
}

export interface BlueskyBridgeService {
  /** Bridge a specific paper version (v1 or v2+). Idempotent on success. */
  bridgeVersion(input: {
    paper: PaperRecord;
    version: PaperVersionRecord;
  }): AppResultAsync<{ uri: string | null; cid: string | null; status: 'posted' | 'skipped' | 'failed' }>;
}

export function makeBlueskyBridgeService(
  ctx: AppContext,
  bridgeCtx: BridgeContext,
): BlueskyBridgeService {
  const { papers } = ctx.repos;
  const { bluesky } = ctx.clients;

  return {
    bridgeVersion({ paper, version }) {
      // Idempotency: cached posted version short-circuits.
      if (version.bridgeStatus === 'posted' && version.bskyPostUri) {
        return ResultAsync.fromSafePromise(
          Promise.resolve({
            uri: version.bskyPostUri,
            cid: version.bskyPostCid,
            status: 'posted' as const,
          }),
        );
      }

      // Feature flag gate. If disabled, mark skipped and exit.
      const skipped = (reason: string): AppResultAsync<{
        uri: string | null;
        cid: string | null;
        status: 'skipped';
      }> =>
        papers
          .setBridgeResult(version.id, { status: 'skipped', error: reason })
          .map(() => ({ uri: null, cid: null, status: 'skipped' as const }));

      const failed = (
        err: string,
      ): AppResultAsync<{ uri: string | null; cid: string | null; status: 'failed' }> =>
        papers
          .setBridgeResult(version.id, { status: 'failed', error: err })
          .map(() => ({ uri: null, cid: null, status: 'failed' as const }));

      return fromPromise(
        isFeatureEnabled(ctx, BRIDGE_FLAG, true),
        () => Errors.internal('flag read failure'),
      ).andThen((enabled) => {
        if (!enabled) return skipped('bridge flag off');
        if (!paper.uri) return skipped('paper not yet published to AT-proto');

        return bluesky.restoreSession(paper.submitterDid).andThen((session) => {
          return resolveAnchorIfReply({ papers, paper, currentVersion: version }).andThen(
            (anchor) => {
              const post = buildBskyPost({
                paper,
                version,
                publicBase: bridgeCtx.publicBase,
                anchor,
              });
              return postToBluesky(session, post)
                .andThen((written) =>
                  papers
                    .setBridgeResult(version.id, {
                      status: 'posted',
                      bskyPostUri: written.uri,
                      bskyPostCid: written.cid,
                    })
                    .map(() => ({ written })),
                )
                .andThen(({ written }) =>
                  // Auto-thread claim cards: only for v1 (anchor itself),
                  // and only when the author shipped >=2 claim cards.
                  postClaimRepliesIfApplicable({
                    paper,
                    version,
                    session,
                    papers,
                    publicBase: bridgeCtx.publicBase,
                    anchor: { uri: written.uri, cid: written.cid },
                  }).map(() => ({
                    uri: written.uri,
                    cid: written.cid,
                    status: 'posted' as const,
                  })),
                )
                .orElse((err) => failed(err.message));
            },
          );
        }).orElse((err) => failed(`session: ${err.message}`));
      });
    },
  };
}

function resolveAnchorIfReply({
  papers,
  paper,
  currentVersion,
}: {
  papers: AppContext['repos']['papers'];
  paper: PaperRecord;
  currentVersion: PaperVersionRecord;
}): AppResultAsync<{ rootUri: string; rootCid: string; parentUri: string; parentCid: string } | null> {
  if (currentVersion.versionNumber === 1) {
    return ResultAsync.fromSafePromise(Promise.resolve(null));
  }
  return papers.firstVersion(paper.id).map((v1) => {
    if (!v1 || v1.bridgeStatus !== 'posted' || !v1.bskyPostUri || !v1.bskyPostCid) {
      // v1 was never bridged or was scrubbed; degrade to a fresh top-level post.
      return null;
    }
    return {
      rootUri: v1.bskyPostUri,
      rootCid: v1.bskyPostCid,
      parentUri: v1.bskyPostUri,
      parentCid: v1.bskyPostCid,
    };
  });
}

export interface BuildBskyPostInput {
  readonly paper: PaperRecord;
  readonly version: PaperVersionRecord;
  readonly publicBase: string;
  readonly anchor: {
    rootUri: string;
    rootCid: string;
    parentUri: string;
    parentCid: string;
  } | null;
}

export interface BskyPostRecord {
  readonly $type: 'app.bsky.feed.post';
  readonly text: string;
  readonly createdAt: string;
  readonly langs?: string[];
  readonly facets?: Array<{
    index: { byteStart: number; byteEnd: number };
    features: Array<
      | { $type: 'app.bsky.richtext.facet#link'; uri: string }
      | { $type: 'app.bsky.richtext.facet#tag'; tag: string }
    >;
  }>;
  readonly embed?: {
    $type: 'app.bsky.embed.external';
    external: {
      uri: string;
      title: string;
      description: string;
    };
  };
  readonly reply?: {
    root: { uri: string; cid: string };
    parent: { uri: string; cid: string };
  };
}

/**
 * Compose the app.bsky.feed.post record for a paper version. Pure function so
 * it can be unit-tested without any network access — call this on every
 * candidate paper and assert facet byte positions, embed shape, and length.
 *
 * Exported for tests.
 */
export function buildBskyPost(input: BuildBskyPostInput): BskyPostRecord {
  const { paper, version, publicBase, anchor } = input;
  const id = paper.openxivId ?? paper.id.slice(0, 8);
  const paperUrl = `${publicBase.replace(/\/$/, '')}/p/${encodeURIComponent(id)}`;
  const title = utf8Truncate(paper.title, MAX_TITLE_BYTES);
  const description = utf8Truncate(paper.abstract ?? title, MAX_DESC_BYTES);

  const isVersionUpdate = version.versionNumber > 1;
  const verbPrefix = isVersionUpdate
    ? `Updated paper (v${version.versionNumber}): `
    : 'New paper: ';

  // Build the text: prefix + title + #openxiv hashtag at the end. We compute
  // facet byte ranges over the *final* text, not the title alone, because
  // facets index into the post text.
  const tagPrefix = '\n\n#openxiv';
  const rawText = `${verbPrefix}${title}${tagPrefix}`;
  const text = utf8Truncate(rawText, MAX_POST_TEXT_BYTES);

  const facets = buildFacets(text);
  const record: BskyPostRecord = {
    $type: 'app.bsky.feed.post',
    text,
    createdAt: new Date().toISOString(),
    langs: ['en'],
    embed: {
      $type: 'app.bsky.embed.external',
      external: {
        uri: paperUrl,
        title,
        description,
      },
    },
  };
  if (facets.length > 0) (record as { facets?: BskyPostRecord['facets'] }).facets = facets;
  if (anchor) {
    (record as { reply?: BskyPostRecord['reply'] }).reply = {
      root: { uri: anchor.rootUri, cid: anchor.rootCid },
      parent: { uri: anchor.parentUri, cid: anchor.parentCid },
    };
  }
  return record;
}

/** Compute the AT-proto facets array for a Bluesky post text. Exported for tests. */
export function buildFacets(text: string): NonNullable<BskyPostRecord['facets']> {
  const facets: NonNullable<BskyPostRecord['facets']> = [];
  const utf8 = new TextEncoder().encode(text);

  for (const match of text.matchAll(URL_RE)) {
    const uri = match[0];
    const idx = match.index;
    if (idx === undefined) continue;
    const byteStart = new TextEncoder().encode(text.slice(0, idx)).length;
    const byteEnd = byteStart + new TextEncoder().encode(uri).length;
    facets.push({
      index: { byteStart, byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri }],
    });
  }

  for (const match of text.matchAll(TAG_RE)) {
    const tag = match[2]!;
    const tagText = `#${tag}`;
    // match.index points to the character BEFORE the # (or 0 at start of string)
    const leadOffset = match[1]?.length ?? 0;
    const idx = (match.index ?? 0) + leadOffset;
    const byteStart = new TextEncoder().encode(text.slice(0, idx)).length;
    const byteEnd = byteStart + new TextEncoder().encode(tagText).length;
    facets.push({
      index: { byteStart, byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#tag', tag }],
    });
  }
  // Defensive: bsky rejects facets whose byteEnd exceeds the text byte length.
  return facets.filter((f) => f.index.byteEnd <= utf8.length);
}

/**
 * Truncate a string to at most `maxBytes` UTF-8 bytes without splitting a
 * code point. When truncated, an ellipsis (`…`, 3 bytes) is appended provided
 * `maxBytes >= 3`. Iterates by code point so the final output round-trips
 * through TextDecoder({fatal:true}).
 */
function utf8Truncate(input: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  const encoder = new TextEncoder();
  if (encoder.encode(input).length <= maxBytes) return input;
  const ellipsis = '…';
  const ellipsisBytes = encoder.encode(ellipsis).length;
  // Reserve space for the ellipsis if it fits.
  const budget = maxBytes >= ellipsisBytes ? maxBytes - ellipsisBytes : maxBytes;
  let out = '';
  let used = 0;
  // Iterate by code point so multi-byte chars are kept whole.
  for (const ch of input) {
    const chBytes = encoder.encode(ch).length;
    if (used + chBytes > budget) break;
    out += ch;
    used += chBytes;
  }
  return maxBytes >= ellipsisBytes ? out + ellipsis : out;
}

function postToBluesky(
  session: BlueskyAgentSession,
  record: BskyPostRecord,
): AppResultAsync<{ uri: string; cid: string }> {
  return session.post<{ uri: string; cid: string }>(
    'com.atproto.repo.createRecord',
    {
      repo: session.did,
      collection: 'app.bsky.feed.post',
      record,
    },
  );
}

/**
 * Auto-thread support: if the paper shipped >=2 claim cards, post each card
 * as a reply chained off the anchor. Each post records its (claimIdx, uri,
 * cid) in `paper_versions.bsky_thread_replies` so saga retries don't
 * double-post.
 *
 * Failure of any one reply doesn't roll back earlier replies — the partial
 * thread is preserved and `bridge_status` stays 'posted' (the anchor is up).
 */
function postClaimRepliesIfApplicable({
  paper,
  version,
  session,
  papers,
  publicBase,
  anchor,
}: {
  paper: PaperRecord;
  version: PaperVersionRecord;
  session: BlueskyAgentSession;
  papers: AppContext['repos']['papers'];
  publicBase: string;
  anchor: { uri: string; cid: string };
}): AppResultAsync<void> {
  // Only v1 spawns the thread — v2+ is itself a reply to v1, so a separate
  // sub-thread would be confusing.
  if (version.versionNumber !== 1) {
    return ResultAsync.fromSafePromise(Promise.resolve(undefined));
  }
  const cards = paper.launchKit?.claimCards;
  if (!cards || cards.length < 2) {
    return ResultAsync.fromSafePromise(Promise.resolve(undefined));
  }

  const alreadyPosted = new Set(
    (version.bskyThreadReplies ?? []).map((r) => r.claimIdx),
  );
  const root = { uri: anchor.uri, cid: anchor.cid };
  // Walk through the claim cards, chaining each new reply off the prior
  // reply's URI so it renders as a continuous thread.
  let parent: { uri: string; cid: string } = anchor;
  const work = async (): Promise<void> => {
    // Restore parent from the latest stored reply if we resumed mid-thread.
    const stored = (version.bskyThreadReplies ?? []).slice().sort((a, b) => a.claimIdx - b.claimIdx);
    if (stored.length > 0) {
      const last = stored[stored.length - 1]!;
      parent = { uri: last.uri, cid: last.cid };
    }
    for (let idx = 0; idx < Math.min(cards.length, 4); idx++) {
      if (alreadyPosted.has(idx)) continue;
      const card = cards[idx]!;
      const text = buildClaimReplyText(card, idx, cards.length);
      const reply: BskyPostRecord = {
        $type: 'app.bsky.feed.post',
        text,
        createdAt: new Date().toISOString(),
        langs: ['en'],
        reply: { root, parent },
      };
      const written = await session.post<{ uri: string; cid: string }>(
        'com.atproto.repo.createRecord',
        {
          repo: session.did,
          collection: 'app.bsky.feed.post',
          record: reply,
        },
      );
      if (written.isErr()) {
        // Halt the thread but preserve previously-posted entries.
        console.warn(
          `[bridge] claim reply ${idx} failed for paper ${paper.id}: ${written.error.message}`,
        );
        return;
      }
      await papers
        .appendBridgeReply(version.id, {
          claimIdx: idx,
          uri: written.value.uri,
          cid: written.value.cid,
        })
        .match(
          () => undefined,
          () => undefined,
        );
      parent = { uri: written.value.uri, cid: written.value.cid };
    }
    void publicBase;
  };
  return fromPromise(work(), () => Errors.internal('bridge.claimReplies'));
}

function buildClaimReplyText(
  card: { headline: string; supporting?: string },
  idx: number,
  total: number,
): string {
  const prefix = `Claim ${idx + 1}/${total}: `;
  const body = card.supporting ? `${card.headline}\n\n${card.supporting}` : card.headline;
  const remaining = 300 - prefix.length;
  // We don't want a hard truncation that drops the supporting text mid-word;
  // utf8Truncate honors code-point boundaries and appends an ellipsis.
  return prefix + utf8TruncatePub(body, remaining);
}

function utf8TruncatePub(input: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  const encoder = new TextEncoder();
  if (encoder.encode(input).length <= maxBytes) return input;
  const ellipsisBytes = encoder.encode('…').length;
  const budget = maxBytes >= ellipsisBytes ? maxBytes - ellipsisBytes : maxBytes;
  let out = '';
  let used = 0;
  for (const ch of input) {
    const chBytes = encoder.encode(ch).length;
    if (used + chBytes > budget) break;
    out += ch;
    used += chBytes;
  }
  return maxBytes >= ellipsisBytes ? out + '…' : out;
}

export const __testing = {
  URL_RE,
  TAG_RE,
  MAX_POST_TEXT_BYTES,
  MAX_TITLE_BYTES,
  MAX_DESC_BYTES,
  utf8Truncate,
};
