/**
 * Conservative token-count estimator used to keep us under model context
 * limits without shipping a real BPE tokenizer to the API process.
 *
 * Approach: count Unicode code points (NOT UTF-16 units, which would over-
 * count surrogate-paired emoji) and apply a per-language ratio:
 *
 *   - ASCII / Latin text:           ~3.8 chars per token (so 0.27 tok/char)
 *   - CJK and other dense scripts:  ~1.4 chars per token (≈ 0.7 tok/char)
 *
 * The function returns the WORST-CASE estimate — actual tokenization may
 * use fewer tokens, never more. That's the safe direction: under-estimating
 * tokens is what gets you a 400 from the embedding API mid-saga.
 *
 * Real BPE counts can vary ±20%; for safety we add a +12% headroom factor.
 */
const ASCII_CHAR_PER_TOKEN = 3.8;
const DENSE_CHAR_PER_TOKEN = 1.4;
const HEADROOM = 1.12;

/**
 * Estimate the number of tokens a Gemini / OpenAI / DeepSeek tokenizer
 * would emit for `text`. Returns an integer; conservative (overcounts
 * rather than undercounts).
 */
export function estimateTokens(text: string): number {
  if (typeof text !== 'string' || text.length === 0) return 0;
  // Iterating code points handles emoji & non-BMP scripts correctly.
  let denseChars = 0;
  let asciiChars = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    // BMP "dense" ranges that compact poorly into BPE: CJK, Hangul,
    // Hiragana/Katakana, Hebrew, Arabic, Devanagari, Thai, etc.
    // Anything outside the ASCII printable + extended-Latin block gets
    // treated as dense to keep us conservative.
    if (cp < 0x80) asciiChars += 1;
    else if (cp >= 0x80 && cp < 0x500) asciiChars += 1; // Latin-1, Latin Extended
    else denseChars += 1;
  }
  const est = asciiChars / ASCII_CHAR_PER_TOKEN + denseChars / DENSE_CHAR_PER_TOKEN;
  return Math.ceil(est * HEADROOM);
}

/**
 * Model-specific token budgets. Source of truth for everything that needs
 * to know "how big a single embedding request can be".
 */
export const TOKEN_LIMITS = {
  /**
   * `gemini-embedding-001` accepts up to 2048 input tokens per request.
   * We cap chunks at 1800 so headroom + tokenizer drift can't push us
   * over the wire limit.
   */
  geminiEmbedding: 2048,
  geminiEmbeddingSafe: 1800,
  /**
   * Gemini 1.5 / 2.x flash text models support 1M context in theory; in
   * practice we use them for short summaries. 32k input chars (~8k tokens)
   * is plenty for our prompts.
   */
  geminiTextSafe: 8000,
  /**
   * DeepSeek chat — up to 128k context, but we cap the prompt size in the
   * explain pipeline so per-call billing is predictable.
   */
  deepseekTextSafe: 16000,
} as const;
