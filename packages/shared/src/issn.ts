/**
 * OpenXiv's registered ISSN (online).
 *
 * Registered with the ISSN International Centre on 2026-05-18.
 * Portal record: https://portal.issn.org/resource/ISSN/3120-9556
 *
 * The number is structured as four digits, hyphen, three digits, one
 * check digit (which may be X). Exposed as a constant so every emission
 * point — citation_issn, JSON-LD Periodical.issn, urn:issn in OAI-PMH,
 * DataCite ISSN identifier, humans.txt — references the same source of
 * truth and the test gate guards drift.
 */
export const OPENXIV_ISSN = '3120-9556';

/**
 * Validate an ISSN's structure + check digit. Used by tests and any
 * future code that ingests ISSNs from external sources (e.g. linked-
 * publication enrichment). Pure function.
 *
 * The check digit algorithm (ISO 3297):
 *   1. Strip the hyphen — call the first seven digits d1..d7.
 *   2. Sum := 8*d1 + 7*d2 + 6*d3 + 5*d4 + 4*d5 + 3*d6 + 2*d7.
 *   3. mod := sum mod 11.
 *   4. checkDigit := (11 - mod) mod 11. If 10, encode as 'X'.
 */
export function isValidIssn(input: string): boolean {
  if (typeof input !== 'string') return false;
  const m = /^(\d{4})-(\d{3})([0-9X])$/.exec(input);
  if (!m) return false;
  const digits = (m[1]! + m[2]!).split('').map((c) => Number.parseInt(c, 10));
  const provided = m[3]! === 'X' ? 10 : Number.parseInt(m[3]!, 10);
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += digits[i]! * (8 - i);
  const expected = (11 - (sum % 11)) % 11;
  return provided === expected;
}

/**
 * Canonical URN form of an ISSN, suitable for use as an OAI-PMH or
 * DataCite identifier (`urn:issn:NNNN-NNNN`).
 */
export function issnUrn(issn: string = OPENXIV_ISSN): string {
  return `urn:issn:${issn}`;
}

/**
 * Canonical portal.issn.org URL — what humans click to verify the
 * registration. Renders the metadata page.
 */
export function issnPortalUrl(issn: string = OPENXIV_ISSN): string {
  return `https://portal.issn.org/resource/ISSN/${issn}`;
}
