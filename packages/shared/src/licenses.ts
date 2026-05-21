/**
 * Allowed publication licenses, SPDX where defined. The set is intentionally
 * narrow — every license here must be (a) unambiguous, (b) compatible with
 * a public preprint server's redistribution model, and (c) something we can
 * cleanly surface to crawlers via OAI-PMH and JSON-LD. Anything else gets
 * rejected at submission validation time.
 */
export const ALLOWED_LICENSES: readonly string[] = [
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'CC-BY-NC-4.0',
  'CC-BY-NC-SA-4.0',
  'CC-BY-ND-4.0',
  'CC0-1.0',
  'arXiv-nonexclusive-distrib',
  'all-rights-reserved',
] as const;

/**
 * ORCID iD format. 16 digits in 4-4-4-4 groups separated by hyphens. The last
 * char is an ISO 7064 MOD 11-2 check digit (0–9 or X). We only enforce shape
 * here — checksum verification happens at OAuth-confirm time when we have it.
 */
export const ORCID_REGEX = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

/**
 * Normalize an ORCID input to the bare 16-digit form. Researchers paste
 * any of these from their profile page or a citation:
 *
 *   https://orcid.org/0009-0003-6027-7837
 *   https://sandbox.orcid.org/0009-0003-6027-7837
 *   orcid.org/0009-0003-6027-7837
 *   0009-0003-6027-7837/         (trailing slash from a URL copy)
 *   "  0009-0003-6027-7837  "    (whitespace)
 *
 * All become `0009-0003-6027-7837`. Inputs that already match the regex
 * are returned unchanged. Inputs that do not match after stripping are
 * returned as-is so the existing ORCID_REGEX validator surfaces the
 * usual "must be 0000-0000-0000-000X" message.
 */
export function normalizeOrcid(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^(?:www\.)?(?:sandbox\.)?orcid\.org\//i, '')
    .replace(/\/$/, '');
}
