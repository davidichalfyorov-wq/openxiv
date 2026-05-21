import { describe, expect, it } from 'vitest';
import { isOpenxivMention, matchedOpenxivId, __testing } from './jetstream-subscriber.js';

describe('jetstream filter: isOpenxivMention', () => {
  it('matches openxiv.net/abs/ in body text', () => {
    expect(
      isOpenxivMention({ text: 'Cool paper: https://openxiv.net/abs/phys.2606.000123' }),
    ).toBe(true);
  });

  it('matches openxiv:id token in body text', () => {
    expect(isOpenxivMention({ text: 'Read openxiv:phys.2606.000123 now.' })).toBe(true);
  });

  it('matches openxiv URL hidden inside an embed.external', () => {
    expect(
      isOpenxivMention({
        text: 'see the link',
        embed: {
          $type: 'app.bsky.embed.external',
          external: { uri: 'https://openxiv.net/abs/cs.2606.999999' },
        },
      }),
    ).toBe(true);
  });

  it('matches openxiv URL inside a facet link feature', () => {
    expect(
      isOpenxivMention({
        text: 'check this',
        facets: [
          {
            features: [
              { $type: 'app.bsky.richtext.facet#link', uri: 'https://openxiv.net/abs/q.2606.000001' },
            ],
          },
        ],
      }),
    ).toBe(true);
  });

  it('rejects bare openxiv mentions (not the URL form)', () => {
    expect(isOpenxivMention({ text: 'I read papers on openxiv every day' })).toBe(false);
  });

  it('rejects unrelated bsky posts', () => {
    expect(isOpenxivMention({ text: 'Just saw a cute cat on bsky.app' })).toBe(false);
    expect(isOpenxivMention({ text: 'https://arxiv.org/abs/2310.12345' })).toBe(false);
  });
});

describe('matchedOpenxivId extracts the abs URL', () => {
  it('reconstructs from openxiv:id token', () => {
    expect(matchedOpenxivId({ text: 'openxiv:phys.2606.000123 is great' })).toEqual({
      openxivAbsUrl: 'https://openxiv.net/abs/phys.2606.000123',
    });
  });

  it('reconstructs from openxiv.net/abs/ URL', () => {
    expect(
      matchedOpenxivId({ text: 'see https://openxiv.net/abs/cs.2606.001 ok?' }),
    ).toEqual({
      openxivAbsUrl: 'https://openxiv.net/abs/cs.2606.001',
    });
  });

  it('returns null on non-matching post', () => {
    expect(matchedOpenxivId({ text: 'unrelated' })).toBeNull();
  });
});

describe('jetstream constants', () => {
  it('exposes reasonable reconnect bounds', () => {
    expect(__testing.RECONNECT_BASE_MS).toBe(1000);
    expect(__testing.RECONNECT_MAX_MS).toBe(60_000);
  });
});
