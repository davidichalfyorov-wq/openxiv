/**
 * Cross-listings sanitiser. The single canonical place that decides
 * whether a candidate `(primary, crossListings)` pair is acceptable, and
 * if so, what the normalised list looks like.
 *
 * Three layers cap the list to 2:
 *   1. UI (CategoryPicker `max` prop) — UX cap, advisory.
 *   2. Intake zod (`z.array(z.string()).max(2)`) — request validation.
 *   3. This sanitiser — semantic check + dedup + catalog membership.
 *
 * Multiple layers because the UI runs untrusted in the browser; the
 * server must never accept a payload that the UI somehow bypassed.
 *
 * The DB CHECK constraint is a *floor* at 5 (matching migration 0021).
 * It exists to catch operator-level mistakes like a backfill script;
 * the strict cap of 2 is policy that lives in the API, not in the
 * schema. Tightening the DB constraint to 2 would force a migration
 * every time policy moves.
 *
 * Output is a tagged result, never an exception, because every caller
 * wants to surface a 400 with a specific reason rather than catching.
 */

export const CROSS_LISTINGS_MAX = 2;

export type SanitizeReason =
  | 'overlap'
  | 'duplicate'
  | 'invalid_code'
  | 'too_many';

export interface SanitizeOk {
  ok: true;
  /** Normalised list — dedup'd, primary stripped, sorted, capped. */
  value: string[];
  /** Codes the user typed that we dropped. Surface in the UI. */
  dropped: string[];
}

export interface SanitizeError {
  ok: false;
  reason: SanitizeReason;
  /** The offending code(s) — gives the UI something concrete to show. */
  offenders: string[];
}

export type SanitizeResult = SanitizeOk | SanitizeError;

export interface SanitizeInput {
  primary: string;
  crossListings: readonly string[];
  /** Set of valid category codes. Pass `new Set(CATEGORY_CODES)`. */
  catalog: ReadonlySet<string>;
}

/**
 * Pure function. Order of checks:
 *   1. Reject any code outside the catalog → `invalid_code`. Catches a
 *      malicious payload with arbitrary text masquerading as a category.
 *   2. Reject if the list contains the primary → `overlap`. We surface
 *      this explicitly rather than silently filtering because the user
 *      probably made a mistake worth flagging.
 *   3. Reject if duplicates exist *after* removing the primary → `duplicate`.
 *      Same reason as overlap: silent dedup hides intent.
 *   4. Cap at CROSS_LISTINGS_MAX → `too_many` (anything past the cap).
 *
 * On success: dedup the list (defensive — won't fire after step 3),
 * filter the primary (defensive), sort alphabetically for a stable
 * persisted form. Sorted output also makes equality-based tests
 * deterministic.
 */
export function sanitizeCrossListings(input: SanitizeInput): SanitizeResult {
  const trimmed = input.crossListings
    .map((c) => (typeof c === 'string' ? c.trim() : ''))
    .filter((c) => c.length > 0);

  // Step 1: catalog membership.
  const unknown = trimmed.filter((c) => !input.catalog.has(c));
  if (unknown.length > 0) {
    return { ok: false, reason: 'invalid_code', offenders: unknown };
  }

  // Step 2: overlap with primary.
  const overlap = trimmed.filter((c) => c === input.primary);
  if (overlap.length > 0) {
    return { ok: false, reason: 'overlap', offenders: [input.primary] };
  }

  // Step 3: duplicates.
  const seen = new Set<string>();
  const dups: string[] = [];
  for (const c of trimmed) {
    if (seen.has(c)) dups.push(c);
    seen.add(c);
  }
  if (dups.length > 0) {
    return { ok: false, reason: 'duplicate', offenders: Array.from(new Set(dups)) };
  }

  // Step 4: cap. We treat exceeding-the-cap as a hard error rather than
  // silently slicing — the UI also rejects past the cap, so a payload
  // that gets here past 2 either bypassed the UI or arrived via API.
  if (trimmed.length > CROSS_LISTINGS_MAX) {
    return {
      ok: false,
      reason: 'too_many',
      offenders: trimmed.slice(CROSS_LISTINGS_MAX),
    };
  }

  // Success. Sort alphabetically for stable persisted form.
  const sorted = [...trimmed].sort((a, b) => a.localeCompare(b));
  return { ok: true, value: sorted, dropped: [] };
}

export const __testing = { CROSS_LISTINGS_MAX };
