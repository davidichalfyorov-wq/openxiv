import { ResultAsync } from '@openxiv/shared';
import { createHash } from 'node:crypto';
import type { LlmClient } from './interface.js';

/**
 * Deterministic mock LLM. Summaries echo a synthesised plain-language template
 * derived from the prompt; embeddings are stable hashes mapped into a 768-dim
 * unit-vector space so similarity queries behave plausibly without a network.
 */
export function makeMockLlmClient(): LlmClient {
  return {
    generateText(prompt) {
      const head = prompt.slice(0, 200).replace(/\s+/g, ' ').trim();
      const text = [
        `This paper investigates a question implied by: "${head.slice(0, 120)}…".`,
        `The authors describe their approach in clear steps that build on prior work.`,
        `They report measurable results and acknowledge the limits of their setup.`,
        `Implications point to follow-up experiments and possible new applications.`,
        `In short: a focused contribution presented with enough context for readers to verify.`,
      ].join(' ');
      return ResultAsync.fromSafePromise(Promise.resolve(text));
    },
    generateEmbedding(text) {
      return ResultAsync.fromSafePromise(Promise.resolve(hashToVector(text, 768)));
    },
  };
}

/**
 * Hash a string into a pseudo-random unit vector of given dimension.
 * Same text => same vector across runs.
 */
function hashToVector(text: string, dim: number): number[] {
  const seed = createHash('sha256').update(text).digest();
  const out = new Array<number>(dim);
  let h0 = seed[0]! ^ (seed[1]! << 8) ^ (seed[2]! << 16) ^ (seed[3]! << 24);
  let h1 = seed[4]! ^ (seed[5]! << 8) ^ (seed[6]! << 16) ^ (seed[7]! << 24);
  for (let i = 0; i < dim; i += 1) {
    // xorshift-ish PRNG, mapped into [-1, 1]
    h0 ^= h0 << 13;
    h0 ^= h0 >>> 17;
    h0 ^= h0 << 5;
    h1 ^= h1 << 11;
    h1 ^= h1 >>> 19;
    h1 ^= h1 << 7;
    const v = ((h0 ^ h1) >>> 0) / 0xffffffff;
    out[i] = v * 2 - 1;
  }
  // L2-normalise so cosine similarity is well-defined.
  const norm = Math.sqrt(out.reduce((acc, x) => acc + x * x, 0)) || 1;
  for (let i = 0; i < dim; i += 1) out[i] = out[i]! / norm;
  return out;
}
