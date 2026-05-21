import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { TOKEN_LIMITS, estimateTokens } from '@openxiv/shared';
import { MAX_SECTIONS_PER_PAPER, chunkSections, splitByTokens, truncateByTokens } from './sections.js';

const MAX = TOKEN_LIMITS.geminiEmbeddingSafe;

describe('chunkSections — invariants', () => {
  it('returns [] for empty input', () => {
    expect(chunkSections({ text: '' })).toEqual([]);
    expect(chunkSections({ text: '   \n  \t  ' })).toEqual([]);
  });

  it('returns exactly one chunk for a tiny paper', () => {
    const out = chunkSections({ text: 'Just one short paragraph.' });
    expect(out).toHaveLength(1);
    expect(out[0]!.sectionIdx).toBe(0);
    expect(out[0]!.content).toContain('one short paragraph');
  });

  it('never emits a chunk exceeding the embedding model limit', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 12_000 }),
        (text) => {
          const out = chunkSections({ text });
          for (const c of out) {
            if (estimateTokens(c.content) > MAX) return false;
          }
          return true;
        },
      ),
      { numRuns: 80 },
    );
  });

  it('caps section count at MAX_SECTIONS_PER_PAPER', () => {
    // 200 short headed sections = adversarial input.
    const text = Array.from({ length: 200 }, (_, i) => `# Section ${i}\nBody paragraph ${i} text content here long enough to register.`).join('\n\n');
    const out = chunkSections({ text });
    expect(out.length).toBeLessThanOrEqual(MAX_SECTIONS_PER_PAPER);
  });

  it('preserves order — sectionIdx is monotonic 0..N-1', () => {
    const text = Array.from({ length: 30 }, (_, i) => `# Title ${i}\nbody ${i} content paragraph text.`).join('\n\n');
    const out = chunkSections({ text });
    out.forEach((c, i) => expect(c.sectionIdx).toBe(i));
  });

  it('produces stable, slug-safe anchors', () => {
    const out = chunkSections({ text: '# A Funky Heading: With Punctuation!\nfollowed by some content text here at least long enough for a chunk.' });
    expect(out[0]!.anchor).toMatch(/^[a-z0-9-]*$/);
    expect(out[0]!.anchor!.length).toBeLessThanOrEqual(64);
  });

  it('keeps short References blocks as their own indexed section', () => {
    const out = chunkSections({
      text: [
        '1. Discussion',
        'Short body that cites the retained bibliography [1].',
        '',
        'References',
        '[1] A. Einstein. Annalen der Physik. doi:10.1002/andp.19163540702',
      ].join('\n'),
    });

    expect(out.some((section) => section.title === 'References')).toBe(true);
  });

  it('handles long ascii prose by splitting at sentence boundaries', () => {
    const para = 'Lorem ipsum dolor sit amet. '.repeat(800); // ~22k chars, way over limit
    const out = chunkSections({ text: para });
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) {
      expect(estimateTokens(c.content)).toBeLessThanOrEqual(MAX);
    }
  });

  it('handles CJK text without tearing code points', () => {
    const cjk = '中文测试段落。'.repeat(500);
    const out = chunkSections({ text: cjk });
    // None of the chunks should contain a lone surrogate or replacement char.
    for (const c of out) {
      expect(c.content.includes('�')).toBe(false);
      expect(estimateTokens(c.content)).toBeLessThanOrEqual(MAX);
    }
  });
});

describe('splitByTokens', () => {
  it('every piece fits within maxTokens', () => {
    const txt = 'The five boxing wizards jump quickly. '.repeat(400);
    const pieces = splitByTokens(txt, 100);
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) {
      expect(estimateTokens(p)).toBeLessThanOrEqual(100);
    }
  });

  it('round-trips short text unchanged', () => {
    const pieces = splitByTokens('hello world', 1000);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toBe('hello world');
  });
});

describe('truncateByTokens', () => {
  it('returns input unchanged when already small', () => {
    expect(truncateByTokens('short', 1000)).toBe('short');
  });

  it('produces output within the cap', () => {
    const long = 'x '.repeat(10_000);
    const out = truncateByTokens(long, 50);
    expect(estimateTokens(out)).toBeLessThanOrEqual(50);
  });
});
