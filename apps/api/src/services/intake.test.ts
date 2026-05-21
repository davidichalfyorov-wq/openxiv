import { describe, expect, it } from 'vitest';
import { mergeMetadata } from './intake.js';

describe('mergeMetadata', () => {
  it('prefers explicit TeX authors over noisy GROBID citation authors', () => {
    const merged = mergeMetadata(
      {
        title: 'GROBID title',
        abstract: 'GROBID abstract',
        authors: [
          { displayName: 'David Alfyorov' },
          { displayName: 'S Hayward' },
          { displayName: 'J Bardeen' },
        ],
        references: ['ref'],
        bodyText: 'GROBID body',
      },
      {
        title: 'TeX title',
        abstract: 'TeX abstract',
        authors: [{ displayName: 'David Alfyorov' }],
        keywords: [],
        bodyText: 'TeX body',
      },
    );

    expect(merged.title).toBe('TeX title');
    expect(merged.abstract).toBe('TeX abstract');
    expect(merged.authors).toEqual([{ displayName: 'David Alfyorov' }]);
    expect(merged.references).toEqual(['ref']);
    expect(merged.bodyText).toBe('GROBID body');
  });
});
