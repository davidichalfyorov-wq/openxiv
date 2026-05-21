import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { __testing, buildBskyPost, buildFacets } from './bluesky-bridge.js';
import type { PaperRecord, PaperVersionRecord } from '@openxiv/db';

/**
 * Tests for the pure functions in the bridge module. We deliberately do NOT
 * mock the bridge service end-to-end here — the network shape is covered by
 * `bluesky-bridge.integration.test.ts` which hits a real PDS test account.
 *
 * What is tested here:
 *   - buildBskyPost: deterministic record shape, length caps, embed, reply
 *   - buildFacets: byte-accurate ranges for URLs and #tags
 *   - utf8Truncate: never splits a code point, always honors the byte cap
 */

function fakePaper(over: Partial<PaperRecord> = {}): PaperRecord {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    openxivId: 'phys.2606.000123',
    uri: 'at://did:plc:author/app.openxiv.paper/abc',
    cid: 'bafyabc',
    submitterDid: 'did:plc:author123',
    title: 'A surprising result about quantum entropy in disordered systems',
    abstract: 'We prove that entropy bounds collapse when disorder exceeds threshold T*.',
    license: 'CC-BY-4.0',
    primaryCategory: 'phys',
    doi: null,
    status: 'published',
    versionNote: null,
    supersedesUri: null,
    submissionTermsVersion: '2025-01',
    submissionTermsAcceptedAt: new Date('2025-12-01'),
    oneHardQuestion: null,
    launchKit: null,
    createdAt: new Date('2025-12-01'),
    updatedAt: new Date('2025-12-01'),
    publishedAt: new Date('2025-12-01'),
    ...over,
  } as PaperRecord;
}

function fakeVersion(over: Partial<PaperVersionRecord> = {}): PaperVersionRecord {
  return {
    id: 'v0000000-0000-0000-0000-00000000000a',
    paperId: '11111111-1111-1111-1111-111111111111',
    versionNumber: 1,
    pdfKey: 'k/pdf',
    sourceKey: 'k/src',
    htmlKey: 'k/html',
    fileSha256: 'sha',
    sizeBytes: 1024,
    pageCount: 8,
    changeFlags: null,
    becauseOf: null,
    unresolved: null,
    changelogNote: null,
    diffUrl: null,
    bskyPostUri: null,
    bskyPostCid: null,
    bridgeStatus: 'none',
    bridgeError: null,
    bridgeAttemptedAt: null,
    createdAt: new Date('2025-12-01'),
    publishedAt: new Date('2025-12-01'),
    ...over,
  } as PaperVersionRecord;
}

describe('buildBskyPost', () => {
  it('builds a v1 post with embed.external and no reply', () => {
    const post = buildBskyPost({
      paper: fakePaper(),
      version: fakeVersion({ versionNumber: 1 }),
      publicBase: 'https://openxiv.net',
      anchor: null,
    });
    expect(post.$type).toBe('app.bsky.feed.post');
    expect(post.text.startsWith('New paper: ')).toBe(true);
    expect(post.text).toContain('#openxiv');
    expect(post.embed?.external.uri).toBe('https://openxiv.net/p/phys.2606.000123');
    expect(post.embed?.external.title).toBe(fakePaper().title);
    expect(post.embed?.external.description).toContain('entropy bounds collapse');
    expect(post.reply).toBeUndefined();
    expect(post.langs).toEqual(['en']);
    // facets always present because of #openxiv tag
    expect(post.facets?.length).toBeGreaterThan(0);
  });

  it('threads v2+ as a reply when anchor is present', () => {
    const post = buildBskyPost({
      paper: fakePaper(),
      version: fakeVersion({ versionNumber: 2 }),
      publicBase: 'https://openxiv.net',
      anchor: {
        rootUri: 'at://did:plc:author/app.bsky.feed.post/v1rkey',
        rootCid: 'bafyv1cid',
        parentUri: 'at://did:plc:author/app.bsky.feed.post/v1rkey',
        parentCid: 'bafyv1cid',
      },
    });
    expect(post.text.startsWith('Updated paper (v2): ')).toBe(true);
    expect(post.reply).toEqual({
      root: { uri: 'at://did:plc:author/app.bsky.feed.post/v1rkey', cid: 'bafyv1cid' },
      parent: { uri: 'at://did:plc:author/app.bsky.feed.post/v1rkey', cid: 'bafyv1cid' },
    });
  });

  it('never exceeds the 300-byte Bluesky text limit', () => {
    const longTitle = 'A '.repeat(400) + 'long title';
    const post = buildBskyPost({
      paper: fakePaper({ title: longTitle }),
      version: fakeVersion(),
      publicBase: 'https://openxiv.net',
      anchor: null,
    });
    expect(new TextEncoder().encode(post.text).length).toBeLessThanOrEqual(__testing.MAX_POST_TEXT_BYTES);
  });

  it('utf8Truncate never splits a multibyte code point and respects byte cap', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 1000 }),
        fc.integer({ min: 0, max: 1024 }),
        (s, max) => {
          const out = __testing.utf8Truncate(s, max);
          const bytes = new TextEncoder().encode(out);
          expect(bytes.length).toBeLessThanOrEqual(max);
          // Round-trip must succeed with fatal:true (no lone surrogates).
          expect(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toBe(out);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('falls back to title for description when abstract is null', () => {
    const post = buildBskyPost({
      paper: fakePaper({ abstract: null }),
      version: fakeVersion(),
      publicBase: 'https://openxiv.net',
      anchor: null,
    });
    expect(post.embed?.external.description).toBe(post.embed?.external.title);
  });

  it('honors trailing slash on publicBase', () => {
    const post = buildBskyPost({
      paper: fakePaper(),
      version: fakeVersion(),
      publicBase: 'https://openxiv.net/',
      anchor: null,
    });
    expect(post.embed?.external.uri).toBe('https://openxiv.net/p/phys.2606.000123');
  });
});

describe('buildFacets', () => {
  it('emits link facet with byte-accurate offsets for ASCII URLs', () => {
    const text = 'See https://example.com here.';
    const facets = buildFacets(text);
    const link = facets.find((f) => f.features[0]!.$type === 'app.bsky.richtext.facet#link');
    expect(link).toBeDefined();
    const slice = new TextEncoder()
      .encode(text)
      .slice(link!.index.byteStart, link!.index.byteEnd);
    expect(new TextDecoder().decode(slice)).toBe('https://example.com');
  });

  it('emits tag facet excluding the # character from the value', () => {
    const text = 'Cool finding #openxiv go';
    const facets = buildFacets(text);
    const tag = facets.find((f) => f.features[0]!.$type === 'app.bsky.richtext.facet#tag');
    expect(tag).toBeDefined();
    expect((tag!.features[0] as { tag: string }).tag).toBe('openxiv');
    const slice = new TextEncoder()
      .encode(text)
      .slice(tag!.index.byteStart, tag!.index.byteEnd);
    expect(new TextDecoder().decode(slice)).toBe('#openxiv');
  });

  it('handles multi-byte UTF-8 (cyrillic) before a tag correctly', () => {
    const text = 'Привет #наука!';
    const facets = buildFacets(text);
    const tag = facets.find((f) => f.features[0]!.$type === 'app.bsky.richtext.facet#tag');
    expect(tag).toBeDefined();
    const slice = new TextEncoder()
      .encode(text)
      .slice(tag!.index.byteStart, tag!.index.byteEnd);
    expect(new TextDecoder().decode(slice)).toBe('#наука');
  });

  it('does not emit facets whose byte ranges exceed the encoded text', () => {
    fc.assert(
      fc.property(fc.unicodeString({ minLength: 0, maxLength: 200 }), (s) => {
        const facets = buildFacets(s);
        const utf8 = new TextEncoder().encode(s);
        for (const f of facets) {
          expect(f.index.byteStart).toBeGreaterThanOrEqual(0);
          expect(f.index.byteEnd).toBeGreaterThanOrEqual(f.index.byteStart);
          expect(f.index.byteEnd).toBeLessThanOrEqual(utf8.length);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('handles multiple tags + URLs in one string', () => {
    const text = 'check https://a.example #foo and https://b.example #bar';
    const facets = buildFacets(text);
    const tags = facets.filter((f) => f.features[0]!.$type === 'app.bsky.richtext.facet#tag');
    const links = facets.filter((f) => f.features[0]!.$type === 'app.bsky.richtext.facet#link');
    expect(tags.length).toBe(2);
    expect(links.length).toBe(2);
  });
});
