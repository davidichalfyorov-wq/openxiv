import { describe, expect, it } from 'vitest';
import { FEED_NAMES, feedNameFromUri, feedUri } from './index.js';

describe('feed-generator', () => {
  it('round-trips every feed through the at-URI form', () => {
    for (const n of FEED_NAMES) {
      const uri = feedUri(n);
      expect(uri).toMatch(/^at:\/\/did:web:[^/]+\/app\.bsky\.feed\.generator\/[^/]+$/);
      expect(feedNameFromUri(uri)).toBe(n);
    }
  });

  it('also accepts the short feed name (the API form)', () => {
    for (const n of FEED_NAMES) {
      expect(feedNameFromUri(n)).toBe(n);
    }
  });

  it('rejects unknown feeds', () => {
    expect(feedNameFromUri('at://did:web:somewhere/app.bsky.feed.generator/unknown')).toBeNull();
    expect(feedNameFromUri('not-a-uri')).toBeNull();
    expect(feedNameFromUri('')).toBeNull();
  });

  it('rejects mismatched lexicon', () => {
    expect(
      feedNameFromUri('at://did:web:openxiv.net/app.bsky.graph.list/openxiv-latest'),
    ).toBeNull();
  });
});
