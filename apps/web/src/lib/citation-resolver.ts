export type CitationTargetKind = 'arxiv' | 'doi';

export interface CitationTarget {
  kind: CitationTargetKind;
  raw: string;
  value: string;
  url: string;
}

interface CitationMatch extends CitationTarget {
  start: number;
  end: number;
}

const MODERN_ARXIV_RE = /\barXiv:\s*([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)/gi;
const BARE_MODERN_ARXIV_RE = /(?<![\w.])([0-9]{4}\.[0-9]{4,5}(?:v\d+)?)(?![\w.])/g;
const LEGACY_ARXIV_RE = /\b([a-z-]+(?:\.[A-Z]{2})?\/[0-9]{7}(?:v\d+)?)/g;
const DOI_RE = /\b10\.[0-9]{4,9}\/[-._;()/:A-Z0-9]+/gi;
const EXISTING_ANCHOR_RE = /(<a\b[\s\S]*?<\/a>)/gi;

/**
 * Extract resolvable IDs from a bibliography string.
 *
 * The resolver is intentionally local and deterministic. Crossref lookup can
 * be layered on asynchronously later, but OpenXiv rendering should never block
 * on external citation services.
 */
export function resolveCitationTargets(text: string): CitationTarget[] {
  return collectCitationMatches(text).map(({ kind, raw, value, url }) => ({
    kind,
    raw,
    value,
    url,
  }));
}

export function linkCitationText(text: string): string {
  return text
    .split(EXISTING_ANCHOR_RE)
    .map((segment) => {
      if (/^<a\b/i.test(segment)) return segment;
      return linkPlainTextSegment(segment);
    })
    .join('');
}

function linkPlainTextSegment(text: string): string {
  const matches = collectCitationMatches(text);
  if (matches.length === 0) return text;

  let out = '';
  let cursor = 0;
  for (const match of matches) {
    out += text.slice(cursor, match.start);
    out += `<a class="paper-citation-link" href="${escapeHtmlAttr(match.url)}" rel="noopener noreferrer" target="_blank" data-citation-kind="${match.kind}">${escapeHtml(match.raw)}</a>`;
    cursor = match.end;
  }
  out += text.slice(cursor);
  return out;
}

function collectCitationMatches(text: string): CitationMatch[] {
  const matches: CitationMatch[] = [];

  for (const match of text.matchAll(MODERN_ARXIV_RE)) {
    const raw = match[0];
    const value = match[1];
    if (!value || match.index === undefined) continue;
    matches.push({
      kind: 'arxiv',
      raw,
      value,
      url: `https://arxiv.org/abs/${value}`,
      start: match.index,
      end: match.index + raw.length,
    });
  }

  for (const match of text.matchAll(BARE_MODERN_ARXIV_RE)) {
    const raw = match[0];
    const value = match[1];
    if (!value || match.index === undefined) continue;
    matches.push({
      kind: 'arxiv',
      raw,
      value,
      url: `https://arxiv.org/abs/${value}`,
      start: match.index,
      end: match.index + raw.length,
    });
  }

  for (const match of text.matchAll(LEGACY_ARXIV_RE)) {
    const raw = match[0];
    const value = match[1];
    if (!value || match.index === undefined) continue;
    matches.push({
      kind: 'arxiv',
      raw,
      value,
      url: `https://arxiv.org/abs/${value}`,
      start: match.index,
      end: match.index + raw.length,
    });
  }

  for (const match of text.matchAll(DOI_RE)) {
    const rawWithPunctuation = match[0];
    const trimmed = trimTrailingPunctuation(rawWithPunctuation);
    if (!trimmed || match.index === undefined) continue;
    matches.push({
      kind: 'doi',
      raw: trimmed,
      value: trimmed,
      url: `https://doi.org/${trimmed}`,
      start: match.index,
      end: match.index + trimmed.length,
    });
  }

  return matches.sort((a, b) => a.start - b.start || b.end - a.end).filter(nonOverlapping());
}

function nonOverlapping() {
  let lastEnd = -1;
  return (match: CitationMatch): boolean => {
    if (match.start < lastEnd) return false;
    lastEnd = match.end;
    return true;
  };
}

function trimTrailingPunctuation(value: string): string {
  let out = value;
  while (/[.,;:]$/.test(out)) out = out.slice(0, -1);
  while (out.endsWith(')') && !hasMatchingOpenParen(out)) out = out.slice(0, -1);
  return out;
}

function hasMatchingOpenParen(value: string): boolean {
  return value.split('(').length >= value.split(')').length;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtmlAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}
