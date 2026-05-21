/**
 * Pure helpers used by the URL-salvage middleware. Kept in their own module
 * so vitest (which can't resolve `astro:middleware`) can exercise them
 * directly. Imported by `src/middleware.ts`.
 */

export const MAX_DECODE_PASSES = 5;
export const TARGET_PREFIXES = ['/u/', '/@'] as const;

export function decodeUntilStable(input: string): string {
  let current = input;
  for (let i = 0; i < MAX_DECODE_PASSES; i++) {
    if (!current.includes('%')) return current;
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      return current;
    }
    if (next === current) return current;
    current = next;
  }
  return current;
}

export function isMultiplyEncoded(segment: string): boolean {
  // `%25` is the URL-encoded form of `%`, which only appears when the
  // string was URL-encoded at least once already — the canonical signal
  // that the URL has been encoded more than once on the way here.
  return segment.includes('%25');
}

/**
 * Inspect a path and, if it targets `/u/<bad>` or `/@<bad>` with a
 * multiply-encoded slug, return the clean replacement path. Returns
 * null when no salvage is needed.
 */
export function salvageProfilePath(path: string): string | null {
  const prefix = TARGET_PREFIXES.find((p) => path.startsWith(p));
  if (!prefix) return null;
  const tail = path.slice(prefix.length);
  const slashIdx = tail.indexOf('/');
  const segment = slashIdx >= 0 ? tail.slice(0, slashIdx) : tail;
  const rest = slashIdx >= 0 ? tail.slice(slashIdx) : '';
  if (!isMultiplyEncoded(segment)) return null;
  const decoded = decodeUntilStable(segment);
  if (decoded === segment) return null;
  return `${prefix}${encodeURIComponent(decoded)}${rest}`;
}
