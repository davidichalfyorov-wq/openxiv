import { describe, expect, it } from 'vitest';
import { extractFallbackMetadataFromSource } from './metadata-fallback.js';

describe('extractFallbackMetadataFromSource', () => {
  it('extracts explicit TeX metadata when GROBID is unavailable', async () => {
    const source = Buffer.from(String.raw`
\documentclass{article}
\title{Reliable Launch Notes}
\author{Ada Lovelace \and Grace Hopper}
\begin{document}
\begin{abstract}
  This paper explains resilient metadata fallback.
\end{abstract}
\maketitle
\end{document}
`);

    const meta = await extractFallbackMetadataFromSource(source, 'main.tex');

    expect(meta).toMatchObject({
      title: 'Reliable Launch Notes',
      abstract: 'This paper explains resilient metadata fallback.',
      authors: [{ displayName: 'Ada Lovelace' }, { displayName: 'Grace Hopper' }],
      references: [],
    });
    expect(meta.bodyText).toContain('Reliable Launch Notes');
    expect(meta.bodyText).toContain('resilient metadata fallback');
  });

  it('returns an empty metadata envelope for binary-only sources', async () => {
    const meta = await extractFallbackMetadataFromSource(Buffer.from([0, 1, 2, 3, 4]), 'paper.pdf');

    expect(meta).toEqual({
      authors: [],
      references: [],
      bodyText: '',
    });
  });
});
