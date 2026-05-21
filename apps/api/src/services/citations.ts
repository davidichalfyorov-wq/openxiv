import type { PaperAuthorRecord, PaperRecord, PaperVersionRecord } from '@openxiv/db';
import { openxivIdToUrl } from '@openxiv/shared';

export const CITATION_FORMATS = [
  'bibtex',
  'ris',
  'endnote',
  'apa',
  'mla',
  'chicago',
  'ieee',
] as const;

export type CitationFormat = (typeof CITATION_FORMATS)[number];

export interface CitationPaper {
  readonly paper: PaperRecord;
  readonly authors: PaperAuthorRecord[];
  readonly keywords: string[];
  readonly latestVersion: PaperVersionRecord | null;
}

export interface CitationOptions {
  readonly publicBase: string;
}

export function normalizeCitationFormat(input: string | undefined): CitationFormat {
  const normalized = (input ?? 'bibtex').trim().toLowerCase();
  if ((CITATION_FORMATS as readonly string[]).includes(normalized)) {
    return normalized as CitationFormat;
  }
  return 'bibtex';
}

export function citationFileExtension(format: CitationFormat): string {
  switch (format) {
    case 'bibtex':
      return 'bib';
    case 'ris':
      return 'ris';
    case 'endnote':
      return 'enw';
    case 'apa':
    case 'mla':
    case 'chicago':
    case 'ieee':
      return 'txt';
  }
}

export function generateCitation(
  input: CitationPaper,
  format: CitationFormat,
  opts: CitationOptions,
): string {
  const model = buildCitationModel(input, opts);
  switch (format) {
    case 'bibtex':
      return renderBibtex(model);
    case 'ris':
      return renderRis(model);
    case 'endnote':
      return renderEndNote(model);
    case 'apa':
      return renderApa(model);
    case 'mla':
      return renderMla(model);
    case 'chicago':
      return renderChicago(model);
    case 'ieee':
      return renderIeee(model);
  }
}

interface CitationModel {
  readonly title: string;
  readonly authors: string[];
  readonly year: string;
  readonly date: string;
  readonly journal: string;
  readonly doi: string | null;
  readonly url: string;
  readonly id: string;
  readonly key: string;
  readonly keywords: string[];
  readonly pages: number | null;
}

function buildCitationModel(input: CitationPaper, opts: CitationOptions): CitationModel {
  const paper = input.paper;
  const id = paper.openxivId ?? paper.id;
  const urlId = paper.openxivId ? openxivIdToUrl(paper.openxivId) : paper.id;
  const url = `${opts.publicBase.replace(/\/$/, '')}/p/${encodeURIComponent(urlId)}`;
  const dateObj = paper.publishedAt ?? paper.createdAt;
  const date = dateObj.toISOString().slice(0, 10);
  return {
    title: compact(paper.title),
    authors: input.authors
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((a) => compact(a.displayName))
      .filter(Boolean),
    year: date.slice(0, 4),
    date,
    journal: 'OpenXiv',
    doi: paper.doi?.trim() || null,
    url,
    id,
    key: citationKey(id, paper.title),
    keywords: input.keywords.map(compact).filter(Boolean),
    pages: input.latestVersion?.pageCount ?? null,
  };
}

function renderBibtex(m: CitationModel): string {
  const fields = [
    ['title', `{${escapeBibtex(m.title)}}`],
    ['author', `{${m.authors.map(escapeBibtex).join(' and ') || 'OpenXiv'}}`],
    ['year', `{${m.year}}`],
    ['journal', `{${m.journal}}`],
    ['url', `{${escapeBibtex(m.url)}}`],
    m.doi ? ['doi', `{${escapeBibtex(m.doi)}}`] : null,
    ['note', `{OpenXiv id: ${escapeBibtex(m.id)}}`],
    m.keywords.length > 0 ? ['keywords', `{${m.keywords.map(escapeBibtex).join('; ')}}`] : null,
  ].filter((x): x is [string, string] => Boolean(x));

  const body = fields.map(([key, value]) => `  ${key} = ${value},`).join('\n');
  return `@article{${m.key},\n${body}\n}`;
}

function renderRis(m: CitationModel): string {
  const lines = [
    'TY  - JOUR',
    `T1  - ${m.title}`,
    ...m.authors.map((a) => `AU  - ${a}`),
    `PY  - ${m.year}`,
    `DA  - ${m.date}`,
    `JO  - ${m.journal}`,
    `UR  - ${m.url}`,
    m.doi ? `DO  - ${m.doi}` : null,
    `ID  - ${m.id}`,
    ...m.keywords.map((k) => `KW  - ${k}`),
    'ER  - ',
  ].filter(Boolean);
  return lines.join('\n');
}

function renderEndNote(m: CitationModel): string {
  const lines = [
    '%0 Journal Article',
    `%T ${m.title}`,
    ...m.authors.map((a) => `%A ${a}`),
    `%D ${m.year}`,
    `%8 ${m.date}`,
    `%J ${m.journal}`,
    `%U ${m.url}`,
    m.doi ? `%R ${m.doi}` : null,
    `%7 OpenXiv id: ${m.id}`,
    ...m.keywords.map((k) => `%K ${k}`),
  ].filter(Boolean);
  return lines.join('\n');
}

function renderApa(m: CitationModel): string {
  const authors = apaAuthors(m.authors);
  return `${authors} (${m.year}). ${m.title}. ${m.journal}. ${doiOrUrl(m)}`;
}

function renderMla(m: CitationModel): string {
  const authors = mlaAuthors(m.authors);
  return `${authors}. "${m.title}." ${m.journal}, ${m.year}, ${doiOrUrl(m)}.`;
}

function renderChicago(m: CitationModel): string {
  const authors = chicagoAuthors(m.authors);
  return `${authors}. "${m.title}." ${m.journal} (${m.year}). ${doiOrUrl(m)}.`;
}

function renderIeee(m: CitationModel): string {
  const authors = ieeeAuthors(m.authors);
  return `${authors}, "${m.title}," ${m.journal}, ${m.year}. [Online]. Available: ${doiOrUrl(m)}`;
}

function apaAuthors(authors: string[]): string {
  if (authors.length === 0) return 'OpenXiv';
  if (authors.length > 20) return `${lastName(authors[0]!)} et al.`;
  const formatted = authors.map((a) => {
    const parts = splitName(a);
    return `${parts.last}, ${parts.first
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => `${p[0]!.toUpperCase()}.`)
      .join(' ')}`.trim();
  });
  if (formatted.length === 1) return formatted[0]!;
  if (formatted.length === 2) return `${formatted[0]} & ${formatted[1]}`;
  return `${formatted.slice(0, -1).join(', ')}, & ${formatted[formatted.length - 1]}`;
}

function mlaAuthors(authors: string[]): string {
  if (authors.length === 0) return 'OpenXiv';
  const first = splitName(authors[0]!);
  if (authors.length === 1) return `${first.last}, ${first.first}`.trim();
  if (authors.length === 2) return `${first.last}, ${first.first}, and ${authors[1]}`;
  return `${first.last}, ${first.first}, et al.`;
}

function chicagoAuthors(authors: string[]): string {
  if (authors.length === 0) return 'OpenXiv';
  if (authors.length === 1) return authors[0]!;
  if (authors.length === 2) return `${authors[0]} and ${authors[1]}`;
  return `${authors[0]} et al.`;
}

function ieeeAuthors(authors: string[]): string {
  if (authors.length === 0) return 'OpenXiv';
  if (authors.length > 6) return `${initials(authors[0]!)} et al.`;
  return authors.map(initials).join(', ');
}

function initials(name: string): string {
  const parts = splitName(name);
  const first = parts.first
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => `${p[0]!.toUpperCase()}.`)
    .join(' ');
  return `${first} ${parts.last}`.trim();
}

function doiOrUrl(m: CitationModel): string {
  return m.doi ? `https://doi.org/${m.doi.replace(/^https?:\/\/doi\.org\//i, '')}` : m.url;
}

function splitName(name: string): { first: string; last: string } {
  const parts = compact(name).split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: '', last: parts[0] ?? name };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1]! };
}

function lastName(name: string): string {
  return splitName(name).last;
}

function citationKey(id: string, title: string): string {
  const raw = id.replace(/^openxiv:/, '') || title;
  const key = raw
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return key || 'openxiv';
}

function escapeBibtex(input: string): string {
  return input
    .normalize('NFC')
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/[{}]/g, (m) => `\\${m}`)
    .replace(/([#$%&_])/g, '\\$1')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/~/g, '\\textasciitilde{}');
}

function compact(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}
