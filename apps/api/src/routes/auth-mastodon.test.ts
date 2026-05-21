import { describe, expect, it } from 'vitest';
import { defaultMastodonRedirectUri } from './auth-mastodon.js';
import { normalizeInstanceUrl } from '../services/mastodon-crosspost.js';

describe('Mastodon OAuth redirect URI', () => {
  it('defaults to the reachable web proxy callback path', () => {
    expect(defaultMastodonRedirectUri('https://openxiv.net')).toBe(
      'https://openxiv.net/api-proxy/auth/mastodon/callback',
    );
  });
});

describe('Mastodon identity input normalization', () => {
  it.each([
    ['mastodon.social', 'https://mastodon.social'],
    ['https://mastodon.social/@ddavidich', 'https://mastodon.social'],
    ['@ddavidich@mastodon.social', 'https://mastodon.social'],
    ['ddavidich@mastodon.social', 'https://mastodon.social'],
    ['acct:ddavidich@mastodon.social', 'https://mastodon.social'],
  ])('turns %s into %s', (input, expected) => {
    expect(normalizeInstanceUrl(input)).toBe(expected);
  });
});
