import { describe, expect, it } from 'vitest';
import { linkCitationText, resolveCitationTargets } from './citation-resolver';

describe('citation resolver', () => {
  it('extracts modern arXiv, legacy arXiv, and DOI targets from one reference', () => {
    const targets = resolveCitationTargets(
      'See arXiv:2301.01234v2, hep-th/9901001, and DOI 10.1145/123.456 for context.',
    );

    expect(targets).toEqual([
      {
        kind: 'arxiv',
        raw: 'arXiv:2301.01234v2',
        value: '2301.01234v2',
        url: 'https://arxiv.org/abs/2301.01234v2',
      },
      {
        kind: 'arxiv',
        raw: 'hep-th/9901001',
        value: 'hep-th/9901001',
        url: 'https://arxiv.org/abs/hep-th/9901001',
      },
      {
        kind: 'doi',
        raw: '10.1145/123.456',
        value: '10.1145/123.456',
        url: 'https://doi.org/10.1145/123.456',
      },
    ]);
  });

  it('ignores malformed partial identifiers', () => {
    expect(resolveCitationTargets('Malformed 10. and arXiv:bad and 2301.')).toEqual([]);
  });

  it('links each identifier once without nesting existing anchors', () => {
    const linked = linkCitationText(
      'arXiv:2301.01234 and DOI 10.1145/123.456, already <a href="https://doi.org/10.1/x">10.1/x</a>.',
    );

    expect(linked).toContain('href="https://arxiv.org/abs/2301.01234"');
    expect(linked).toContain('href="https://doi.org/10.1145/123.456"');
    expect(linked).toContain('already <a href="https://doi.org/10.1/x">10.1/x</a>');
  });
});
