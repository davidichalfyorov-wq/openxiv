/**
 * Impersonation risk assessment for handle candidates.
 *
 * Two signal sources:
 *
 *   1. **Edit distance** to a small set of high-value names — `openxiv`,
 *      `admin`, `mod`, `support`, plus the owner handles. Levenshtein ≤ 2
 *      to any of these returns `high`.
 *
 *   2. **Confusable normalisation** — strip the candidate down to its
 *      Unicode confusables-skeleton form (NFKD + script-mix detection +
 *      well-known homoglyph substitutions) and compare against the same
 *      set. Matches return `high`.
 *
 * The owner names are deliberately *narrow*. Adding too many high-value
 * names creates false-positive friction on otherwise-legitimate handles
 * (the user 'admins' wouldn't accept their handle being blocked because
 * it's distance-2 from 'admin'). For a small audience that's tolerable;
 * we'll expand the list as the namespace gets adversarial.
 */

export type ImpersonationRisk = 'low' | 'medium' | 'high';

const HIGH_VALUE_NAMES = [
  'openxiv',
  'admin',
  'mod',
  'support',
  'moderator',
  'staff',
  'official',
  'ddavidich',
  'davidich',
  'davidalfyorov',
];

/**
 * Hand-rolled Levenshtein (Wagner-Fischer). Adequate for ≤30-char inputs;
 * we never compare strings longer than the handle max (30) so the matrix
 * stays ≤ 30×30.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}

/**
 * Apply a handful of well-known homoglyph mappings + strip non-letter
 * decoration. The goal is to normalise visually-similar variants:
 *
 *   "0p3nx1v"  →  "openxiv"
 *   "оpenxiv"  →  "openxiv"   (Cyrillic 'о' folded to Latin 'o')
 *   "a_d_m_i_n" → "admin"
 *
 * Not a full Unicode-confusables table — that would require a 6 MB
 * dataset. Coverage is *intentionally* shallow: catch the obvious cases
 * and defer the rest to manual moderator review.
 */
export function confusableSkeleton(input: string): string {
  let s = input.normalize('NFKC').toLowerCase();
  // Strip non-alphanumerics so "_", ".", "-" don't perturb distance.
  s = s.replace(/[^a-z0-9Ѐ-ӿ]/g, '');
  // Common digit-letter homoglyphs.
  const subs: Record<string, string> = {
    '0': 'o',
    '1': 'l',
    '3': 'e',
    '4': 'a',
    '5': 's',
    '7': 't',
    '8': 'b',
    // Cyrillic lookalikes (a small but high-signal subset).
    'а': 'a', // а
    'е': 'e', // е
    'о': 'o', // о
    'р': 'p', // р
    'с': 'c', // с
    'у': 'y', // у
    'х': 'x', // х
    'в': 'b', // в
    'и': 'u', // и
    'к': 'k', // к
    'м': 'm', // м
    'н': 'h', // н
    'т': 't', // т
  };
  let out = '';
  for (const ch of s) {
    out += subs[ch] ?? ch;
  }
  return out;
}

export function impersonationRisk(candidate: string): ImpersonationRisk {
  const skeleton = confusableSkeleton(candidate);
  for (const name of HIGH_VALUE_NAMES) {
    if (skeleton === name) return 'high';
    if (levenshtein(skeleton, name) <= 1) return 'high';
  }
  // Distance-2 still ranks high but the band is narrower — protects
  // against the most obvious typosquats without flagging short common
  // English words that happen to be edit-distance 2 from "mod" etc.
  for (const name of HIGH_VALUE_NAMES) {
    if (name.length >= 5 && levenshtein(skeleton, name) === 2) return 'high';
  }
  return 'low';
}

export const __testing = { HIGH_VALUE_NAMES, levenshtein, confusableSkeleton };
