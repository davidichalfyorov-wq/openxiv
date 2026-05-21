import type { LlmClient, GenerateOptions, EmbedOptions } from './interface.js';
import { wrapBreaker } from '../circuit.js';

export interface BreakerWrapOptions {
  readonly name: string;
  /** Per-call hard timeout. Default 60s for text, 30s for embed. */
  readonly textTimeoutMs?: number;
  readonly embedTimeoutMs?: number;
  /** Failure-rate threshold to open the breaker (0..100). Default 50. */
  readonly errorThresholdPercent?: number;
  /** How long the breaker stays open before going half-open. Default 30s. */
  readonly resetTimeoutMs?: number;
  /** Minimum calls before failure percentage can open the breaker. Default 5. */
  readonly volumeThreshold?: number;
}

/**
 * Wrap an LLM client so generateText and generateEmbedding both pass through
 * an opossum circuit breaker. Per-method breakers because:
 *   - text vs embed have very different latency profiles; one timeout
 *     can't fit both.
 *   - if embeddings are healthy but text generation is broken, indexing
 *     should keep working.
 *
 * The wrapping is transparent — same `LlmClient` interface comes out, so
 * the factory can swap a wrapped client in without any caller change.
 */
export function withBreaker(inner: LlmClient, opts: BreakerWrapOptions): LlmClient {
  const textBreaker = wrapBreaker<
    { prompt: string; options?: GenerateOptions },
    string
  >(
    {
      name: `${opts.name}.generateText`,
      timeoutMs: opts.textTimeoutMs ?? 60_000,
      errorThresholdPercent: opts.errorThresholdPercent ?? 50,
      resetTimeoutMs: opts.resetTimeoutMs ?? 30_000,
      volumeThreshold: opts.volumeThreshold,
    },
    async ({ prompt, options }) => {
      const res = await inner.generateText(prompt, options);
      if (res.isErr()) throw res.error;
      return res.value;
    },
  );

  const embedBreaker = wrapBreaker<
    { text: string; options?: EmbedOptions },
    number[]
  >(
    {
      name: `${opts.name}.generateEmbedding`,
      timeoutMs: opts.embedTimeoutMs ?? 30_000,
      errorThresholdPercent: opts.errorThresholdPercent ?? 50,
      resetTimeoutMs: opts.resetTimeoutMs ?? 30_000,
      volumeThreshold: opts.volumeThreshold,
    },
    async ({ text, options }) => {
      const res = await inner.generateEmbedding(text, options);
      if (res.isErr()) throw res.error;
      return res.value;
    },
  );

  return {
    generateText(prompt, options) {
      return textBreaker({ prompt, ...(options ? { options } : {}) });
    },
    generateEmbedding(text, options) {
      return embedBreaker({ text, ...(options ? { options } : {}) });
    },
  };
}
