import { describe, expect, it } from 'vitest';
import { STARTER_SUGGESTIONS, deriveStarterPackDeepLink } from './bsky-starter-pack.js';

describe('deriveStarterPackDeepLink', () => {
  it('reconstructs the bsky.app share URL for a valid AT-URI', () => {
    const uri = 'at://did:plc:abcdef/app.bsky.graph.starterpack/3kt7yz4w';
    expect(deriveStarterPackDeepLink(uri)).toBe(
      'https://bsky.app/starter-pack/did%3Aplc%3Aabcdef/3kt7yz4w',
    );
  });

  it('returns null when collection is wrong', () => {
    expect(
      deriveStarterPackDeepLink('at://did:plc:abc/app.bsky.feed.post/xyz'),
    ).toBeNull();
  });

  it('returns null for a malformed AT-URI', () => {
    expect(deriveStarterPackDeepLink('not-an-at-uri')).toBeNull();
    expect(deriveStarterPackDeepLink('at://')).toBeNull();
    expect(deriveStarterPackDeepLink('')).toBeNull();
  });

  it('handles a did:web identifier', () => {
    const link = deriveStarterPackDeepLink(
      'at://did:web:example.com/app.bsky.graph.starterpack/abc',
    );
    expect(link).toMatch(/did%3Aweb%3Aexample\.com/);
  });
});

describe('STARTER_SUGGESTIONS', () => {
  it('ships resolved did:plc suggestions for onboarding Follow all', () => {
    expect(STARTER_SUGGESTIONS.length).toBeGreaterThanOrEqual(5);
    for (const item of STARTER_SUGGESTIONS) {
      expect(item.did).toMatch(/^did:plc:/);
      expect(item.handle.length).toBeGreaterThan(3);
      expect(item.label.length).toBeGreaterThan(3);
    }
  });
});
