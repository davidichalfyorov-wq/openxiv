import { ResultAsync } from '@openxiv/shared';
import type { KeywordExtractor } from './interface.js';

/**
 * Simple TF-IDF-ish keyword extractor — bigrams with stop-word filtering and
 * frequency weighting. Production should replace with KeyBERT for vector-aware
 * extraction, but this is enough to populate paper.keywords sensibly.
 */
const STOP_WORDS = new Set(
  [
    'a','an','and','are','as','at','be','but','by','for','from','has','have','i','in','is','it',
    'its','of','on','or','so','such','that','the','their','them','they','this','to','was','were',
    'we','what','when','where','which','who','will','with','you','your','our','can','also','these',
    'those','than','then','here','there','one','two','three','using','use','used','show','shown',
    'figure','table','section','result','results','propose','proposed','present','presented','approach',
  ],
);

export function makeTfidfKeywordExtractor(): KeywordExtractor {
  return {
    extract(text, opts = {}) {
      const max = opts.max ?? 12;
      const tokens = text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

      const unigrams = countFrequencies(tokens);
      const bigrams = countFrequencies(makeBigrams(tokens));

      const scored: Array<{ phrase: string; score: number }> = [];
      for (const [phrase, count] of unigrams) {
        scored.push({ phrase, score: count });
      }
      for (const [phrase, count] of bigrams) {
        // bigrams weighted slightly higher to surface multiword terms.
        scored.push({ phrase, score: count * 1.5 });
      }
      scored.sort((a, b) => b.score - a.score);
      const out: string[] = [];
      const seen = new Set<string>();
      for (const item of scored) {
        if (out.length >= max) break;
        if (seen.has(item.phrase)) continue;
        seen.add(item.phrase);
        out.push(item.phrase);
      }
      return ResultAsync.fromSafePromise(Promise.resolve(out));
    },
  };
}

function countFrequencies(items: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const item of items) m.set(item, (m.get(item) ?? 0) + 1);
  return m;
}

function makeBigrams(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    out.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return out;
}
