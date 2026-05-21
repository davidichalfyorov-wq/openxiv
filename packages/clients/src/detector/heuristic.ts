import { ResultAsync } from '@openxiv/shared';
import type { AiDetector, DetectorScore, DetectorWeights } from './interface.js';

/**
 * Heuristic detector that produces plausible scores from text statistics
 * alone. Real production wiring replaces this with GPT-2-medium perplexity,
 * Binoculars zero-shot, and stylometric burstiness/vocab metrics.
 *
 * Scoring intuition:
 *   • Burst: variance in per-sentence length (humans bursty, LLMs uniform)
 *   • Binoculars: lexical diversity (LLMs reuse common bigrams)
 *   • Stylometric: avg sentence length and punctuation rhythm
 */
export function makeHeuristicDetector(): AiDetector {
  return {
    score(text: string, weights: DetectorWeights) {
      const burstScore = scoreBurstiness(text);
      const binocularsScore = scoreLexicalDiversity(text);
      const stylometricScore = scoreSentenceUniformity(text);

      const wSum = weights.burst + weights.binoculars + weights.stylometric;
      const normW = wSum > 0
        ? {
            burst: weights.burst / wSum,
            binoculars: weights.binoculars / wSum,
            stylometric: weights.stylometric / wSum,
          }
        : { burst: 0.4, binoculars: 0.4, stylometric: 0.2 };

      const composite = Math.round(
        burstScore * normW.burst +
          binocularsScore * normW.binoculars +
          stylometricScore * normW.stylometric,
      );

      const result: DetectorScore = {
        score: clamp(composite, 0, 100),
        burstScore,
        binocularsScore,
        stylometricScore,
        modelVersions: {
          burst: 'heuristic-burst-v1',
          binoculars: 'heuristic-binoculars-v1',
          stylometric: 'heuristic-stylometric-v1',
        },
      };
      return ResultAsync.fromSafePromise(Promise.resolve(result));
    },
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/[.!?]+\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function scoreBurstiness(text: string): number {
  const sentences = splitSentences(text);
  if (sentences.length < 3) return 50;
  const lengths = sentences.map((s) => s.split(/\s+/).length);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / lengths.length;
  const cv = mean === 0 ? 0 : Math.sqrt(variance) / mean;
  // Low CV (uniform) => more LLM-like => higher score.
  return clamp(Math.round(100 - cv * 100), 0, 100);
}

function scoreLexicalDiversity(text: string): number {
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length < 50) return 50;
  const unique = new Set(tokens);
  const ttr = unique.size / tokens.length; // type-token ratio
  // Low TTR => more repetition => more LLM-like.
  return clamp(Math.round(100 - ttr * 100), 0, 100);
}

function scoreSentenceUniformity(text: string): number {
  const sentences = splitSentences(text);
  if (sentences.length < 3) return 50;
  const lengths = sentences.map((s) => s.length);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const tightlyClustered =
    lengths.filter((l) => Math.abs(l - mean) < 0.25 * mean).length / lengths.length;
  // Many sentences within ±25% of mean length => suspiciously uniform.
  return clamp(Math.round(tightlyClustered * 100), 0, 100);
}
