import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { TOKEN_LIMITS, estimateTokens } from './tokens.js';

describe('estimateTokens', () => {
  it('returns 0 for empty / non-string input', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(undefined as unknown as string)).toBe(0);
    expect(estimateTokens(null as unknown as string)).toBe(0);
  });

  it('returns a small positive integer for short ASCII text', () => {
    expect(estimateTokens('hello')).toBeGreaterThan(0);
    expect(estimateTokens('hello')).toBeLessThan(5);
  });

  it('is monotonic — concatenating text cannot decrease the estimate', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 200 }), fc.string({ minLength: 0, maxLength: 200 }), (a, b) => {
        return estimateTokens(a + b) >= Math.max(estimateTokens(a), estimateTokens(b));
      }),
    );
  });

  it('treats CJK as denser than ASCII (more tokens per character)', () => {
    const ascii = 'a'.repeat(200);
    const cjk = '中'.repeat(200);
    expect(estimateTokens(cjk)).toBeGreaterThan(estimateTokens(ascii));
  });

  it('is conservative — overcounts rather than undercounts', () => {
    // Real BPE for "the quick brown fox jumped over the lazy dog" is ~10 tokens.
    // Our estimator should not return less than that.
    const text = 'the quick brown fox jumped over the lazy dog';
    expect(estimateTokens(text)).toBeGreaterThanOrEqual(10);
  });

  it('exposes documented limit constants in the right ballpark', () => {
    expect(TOKEN_LIMITS.geminiEmbedding).toBe(2048);
    expect(TOKEN_LIMITS.geminiEmbeddingSafe).toBeLessThan(TOKEN_LIMITS.geminiEmbedding);
    expect(TOKEN_LIMITS.geminiTextSafe).toBeGreaterThan(0);
    expect(TOKEN_LIMITS.deepseekTextSafe).toBeGreaterThan(0);
  });
});
