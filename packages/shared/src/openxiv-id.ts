/**
 * arXiv-style identifiers: `openxiv:{subject}.{YYYY}.{NNNNN}`
 *
 * Examples
 *   openxiv:physics.2026.00001
 *   openxiv:hep-th.2026.00042
 *   openxiv:cs.AI.2026.00117
 *
 * The subject can contain a dot (e.g. cs.AI, physics.optics), so we parse from
 * the right: last 5 digits = sequence, preceding 4 digits = year, remainder
 * (after the openxiv: prefix) = subject.
 */
export interface ParsedOpenxivId {
  readonly subject: string;
  readonly year: number;
  readonly seq: number;
}

const ID_REGEX = /^(.+)\.(\d{4})\.(\d{5})$/;

export function formatOpenxivId(subject: string, year: number, seq: number): string {
  return `openxiv:${subject}.${year}.${String(seq).padStart(5, '0')}`;
}

/** "openxiv:cs.AI.2026.00117" → "cs.AI.2026.00117" (used in /abs/{id} URLs). */
export function openxivIdToUrl(openxivId: string): string {
  return openxivId.replace(/^openxiv:/, '');
}

/** Parse from either full form ("openxiv:cs.AI.2026.00117") or URL form. */
export function parseOpenxivId(idOrUrl: string): ParsedOpenxivId | null {
  const stripped = idOrUrl.replace(/^openxiv:/, '').trim();
  const match = ID_REGEX.exec(stripped);
  if (!match) return null;
  const [, subject, yearStr, seqStr] = match;
  if (!subject || !yearStr || !seqStr) return null;
  return { subject, year: Number.parseInt(yearStr, 10), seq: Number.parseInt(seqStr, 10) };
}

/** Round-trip a URL id back to the canonical "openxiv:..." form. */
export function urlToOpenxivId(urlId: string): string | null {
  const parsed = parseOpenxivId(urlId);
  if (!parsed) return null;
  return formatOpenxivId(parsed.subject, parsed.year, parsed.seq);
}
