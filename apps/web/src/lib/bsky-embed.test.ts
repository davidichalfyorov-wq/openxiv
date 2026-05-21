import { describe, expect, it } from 'vitest';
import { extractOpenXivExternalEmbed } from './bsky-embed';

describe('extractOpenXivExternalEmbed', () => {
  it('returns OpenXiv external embed metadata for /p links', () => {
    const embed = {
      $type: 'app.bsky.embed.external',
      external: {
        uri: 'https://openxiv.net/p/cs.AI.2026.00001',
        title: 'A Real OpenXiv Paper',
        description: 'Short abstract fragment.',
      },
    };

    expect(extractOpenXivExternalEmbed(embed)).toEqual({
      uri: 'https://openxiv.net/p/cs.AI.2026.00001',
      title: 'A Real OpenXiv Paper',
      description: 'Short abstract fragment.',
      path: '/p/cs.AI.2026.00001',
    });
  });

  it('ignores non-OpenXiv external embeds', () => {
    expect(
      extractOpenXivExternalEmbed({
        $type: 'app.bsky.embed.external',
        external: { uri: 'https://example.org/paper', title: 'External', description: 'Nope' },
      }),
    ).toBeNull();
  });
});
