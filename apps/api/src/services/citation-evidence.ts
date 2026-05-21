import type { TrustPassportInputs } from '@openxiv/shared';
import type { TrustPassportCheckItem } from './trust-passport-bundle.js';
import type { FileNode } from './tex-detect.js';

export interface CitationEvidenceSection {
  readonly title: string;
  readonly content: string;
}

export type CitationContentEvidence = Pick<
  TrustPassportInputs,
  'hasReferenceSection' | 'citationMarkerCount' | 'referenceEntryCount' | 'resolvedReferenceCount'
>;

interface CitationRef {
  readonly key: string;
  readonly ref: string;
  readonly sort: number;
}

interface ReferenceEntry {
  readonly ref: string;
  readonly text: string;
  readonly sort: number;
}

interface ReferenceStart {
  readonly key: string;
  readonly ref: string;
  readonly text: string;
  readonly sort: number;
}

interface ReferenceCatalog {
  readonly entries: Map<string, ReferenceEntry>;
  readonly primaryEntries: ReferenceEntry[];
}

const REFERENCE_HEADING_RE =
  /^(?:#{1,6}\s*)?(?:\d+(?:\.\d+)*\.?\s+)?(?:references|bibliography|works cited|literature cited)\s*[:.]?$/i;
const THEBIBLIOGRAPHY_RE = /\\begin\{thebibliography}/i;
const DOI_RE = /\b10\.\d{4,9}\/[^\s<>"'{}]+/i;
const ARXIV_RE =
  /(?:arxiv:\s*|https?:\/\/arxiv\.org\/(?:abs|pdf)\/)([a-z-]+\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?/i;
const ARXIV_ID_RE = /^(?:[a-z-]+\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?$/i;
const URL_RE = /\bhttps?:\/\/[^\s<>"')\]}]+/i;
const THEBIBLIOGRAPHY_ENV_RE = /\\begin\{thebibliography}[\s\S]*?\\end\{thebibliography}/gi;

export function extractCitationContentEvidence(
  sections: ReadonlyArray<CitationEvidenceSection>,
): CitationContentEvidence {
  const corpus = splitCitationCorpus(sections);
  const catalog = parseReferenceCatalog(corpus.referenceText);

  return {
    hasReferenceSection: corpus.hasReferenceSection,
    citationMarkerCount: extractCitationRefs(corpus.bodyText, { dedupe: false }).length,
    referenceEntryCount: catalog.primaryEntries.length,
    resolvedReferenceCount: catalog.primaryEntries.filter((entry) => resolveReferenceEntry(entry.text).resolved)
      .length,
  };
}

export function extractCitationEvidenceItemsFromSections(
  sections: ReadonlyArray<CitationEvidenceSection>,
): TrustPassportCheckItem[] {
  const corpus = splitCitationCorpus(sections);
  return extractCitationEvidenceItems(corpus.bodyText, corpus.referenceText);
}

export function extractCitationSectionsFromSourceFiles(
  files: ReadonlyArray<Pick<FileNode, 'path' | 'content'>>,
): CitationEvidenceSection[] {
  const texFiles = files.filter((file) => /\.tex$/i.test(file.path) && file.content.trim());
  const bibFiles = files.filter((file) => /\.bib$/i.test(file.path) && file.content.trim());
  const bblFiles = files.filter((file) => /\.bbl$/i.test(file.path) && file.content.trim());

  const bodyParts: string[] = [];
  const referenceParts: string[] = [];
  const bibliographyTargets = new Set<string>();

  for (const file of texFiles) {
    const content = file.content;
    for (const target of bibliographyTargetsFromTex(content)) {
      bibliographyTargets.add(target);
    }
    for (const match of content.matchAll(THEBIBLIOGRAPHY_ENV_RE)) {
      if (match[0]?.trim()) referenceParts.push(match[0]);
    }
    const body = content.replace(THEBIBLIOGRAPHY_ENV_RE, '\n');
    if (body.trim()) bodyParts.push(`% ${file.path}\n${body}`);
  }

  const selectedBibFiles = selectBibliographyFiles(bibFiles, bibliographyTargets);
  for (const file of selectedBibFiles) referenceParts.push(file.content);
  for (const file of bblFiles) referenceParts.push(file.content);

  const sections: CitationEvidenceSection[] = [];
  if (bodyParts.length > 0) {
    sections.push({ title: 'Source', content: bodyParts.join('\n\n') });
  }
  if (referenceParts.length > 0) {
    sections.push({ title: 'Bibliography', content: referenceParts.join('\n\n') });
  } else if (bibliographyTargets.size > 0) {
    sections.push({ title: 'Bibliography', content: '' });
  }
  return sections;
}

export function isReferenceSection(title: string, content: string): boolean {
  if (isReferenceHeading(title)) return true;
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && isReferenceHeading(lines[0] ?? '');
}

function splitCitationCorpus(sections: ReadonlyArray<CitationEvidenceSection>): {
  readonly bodyText: string;
  readonly referenceText: string;
  readonly hasReferenceSection: boolean;
} {
  const bodyParts: string[] = [];
  const referenceParts: string[] = [];
  let hasReferenceSection = false;

  for (const section of sections) {
    const title = section.title ?? '';
    const content = section.content ?? '';
    if (isReferenceHeading(title)) {
      hasReferenceSection = true;
      referenceParts.push([title, content].filter(Boolean).join('\n'));
      continue;
    }

    const split = splitSectionReferences(content);
    if (split.referenceText.trim()) {
      hasReferenceSection = true;
      if (split.bodyText.trim()) {
        bodyParts.push([title, split.bodyText].filter(Boolean).join('\n'));
      }
      referenceParts.push(split.referenceText);
    } else {
      bodyParts.push([title, content].filter(Boolean).join('\n'));
    }
  }

  return {
    bodyText: bodyParts.join('\n'),
    referenceText: referenceParts.join('\n'),
    hasReferenceSection,
  };
}

function splitSectionReferences(content: string): {
  readonly bodyText: string;
  readonly referenceText: string;
} {
  const lines = content.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => isReferenceHeading(line));
  if (headingIndex >= 0) {
    return {
      bodyText: lines.slice(0, headingIndex).join('\n'),
      referenceText: lines.slice(headingIndex).join('\n'),
    };
  }

  const inferredIndex = findInferredReferenceStart(lines);
  if (inferredIndex >= 0) {
    return {
      bodyText: lines.slice(0, inferredIndex).join('\n'),
      referenceText: lines.slice(inferredIndex).join('\n'),
    };
  }

  return { bodyText: content, referenceText: '' };
}

function findInferredReferenceStart(lines: readonly string[]): number {
  for (let i = 0; i < lines.length; i += 1) {
    const first = (lines[i] ?? '').trim();
    if (!first || !referenceStartFromLine(first, i + 1)) continue;

    let starts = 0;
    let resolved = 0;
    let inspected = 0;
    for (const raw of lines.slice(i)) {
      const line = raw.trim();
      if (!line) continue;
      inspected += 1;
      if (referenceStartFromLine(line, i + starts + 1)) starts += 1;
      if (resolveReferenceEntry(line).resolved) resolved += 1;
      if (inspected >= 16) break;
    }

    const nearTail = i >= Math.floor(lines.length * 0.3);
    const allReferenceLike = i === 0 && starts >= 2 && resolved > 0;
    if ((nearTail && starts >= 2) || allReferenceLike) return i;
    if (nearTail && starts >= 1 && resolved >= 1 && lines.length - i <= 8) return i;
  }
  return -1;
}

function extractCitationEvidenceItems(bodyText: string, referenceText: string): TrustPassportCheckItem[] {
  const catalog = parseReferenceCatalog(referenceText);
  const citationRefs = extractCitationRefs(bodyText, { dedupe: true });
  const targets =
    citationRefs.length > 0
      ? citationRefs
      : catalog.primaryEntries.map((entry) => ({
          key: referenceMapKey(entry.ref),
          ref: entry.ref,
          sort: entry.sort,
        }));

  return targets.slice(0, 50).map((target) => {
    const entry = catalog.entries.get(target.key);
    if (!entry) {
      return citationItem({
        ref: target.ref,
        resolved: null,
        via: 'unresolved',
        confidence: 'low',
        reason: 'Reference entry not found in extracted bibliography.',
      });
    }
    return citationItem({ ref: target.ref, ...resolveReferenceEntry(entry.text) });
  });
}

function citationItem(input: {
  ref: string;
  resolved: string | null;
  via: 'doi' | 'arxiv' | 'url' | 'unresolved';
  confidence: 'high' | 'medium' | 'low';
  reason?: string;
}): TrustPassportCheckItem {
  const passed = input.resolved !== null;
  return {
    label: `Citation ${input.ref}`,
    ref: input.ref,
    resolved: input.resolved,
    via: input.via,
    confidence: input.confidence,
    ...(input.reason ? { reason: input.reason } : {}),
    passed,
    status: passed ? 'pass' : 'fail',
    note: passed
      ? `Resolved ${input.ref} via ${input.via.toUpperCase()}.`
      : (input.reason ?? 'Citation could not be resolved from extracted references.'),
    weight: 1,
    value: passed ? 1 : 0,
    severity: passed ? 'info' : 'medium',
    source: 'pipeline',
    ...(passed ? {} : { action: 'Add a DOI, arXiv id, or stable URL to this reference.' }),
  };
}

function extractCitationRefs(
  text: string,
  opts: { readonly dedupe: boolean },
): CitationRef[] {
  const candidates: Array<CitationRef & { readonly index: number }> = [];
  for (const match of text.matchAll(/\[((?:\d{1,4}\s*(?:[-,;]\s*)?)+)\]/g)) {
    let localSort = 0;
    for (const n of expandNumericCitationMarker(match[1] ?? '')) {
      candidates.push({
        key: `num:${n}`,
        ref: `[${n}]`,
        index: match.index ?? 0,
        sort: localSort++,
      });
    }
  }

  for (const match of text.matchAll(/\[([^[\]\n]{2,300})]/g)) {
    const group = match[1] ?? '';
    if (/^(?:\d{1,4}\s*(?:[-,;]\s*)?)+$/.test(group.trim())) continue;
    let localSort = 0;
    for (const key of bibtexKeysFromBracketGroup(group)) {
      candidates.push({
        key: `tex:${key}`,
        ref: `{${key}}`,
        index: match.index ?? 0,
        sort: localSort++,
      });
    }
  }

  const texCiteRe =
    /\\(?:cite[a-z]*|parencite|textcite|autocite|footcite|supercite|citep|citet)\*?(?:\s*\[[^\]]*])*{([^}]+)}/gi;
  for (const match of text.matchAll(texCiteRe)) {
    let localSort = 0;
    for (const rawKey of (match[1] ?? '').split(',')) {
      const clean = rawKey.trim();
      if (!clean) continue;
      candidates.push({
        key: `tex:${clean}`,
        ref: `{${clean}}`,
        index: match.index ?? 0,
        sort: localSort++,
      });
    }
  }

  for (const match of text.matchAll(/\(([^()]{3,220}(?:19|20)\d{2}[a-z]?[^()]*)\)/g)) {
    const group = match[1] ?? '';
    let localSort = 0;
    for (const part of group.split(/[;]/)) {
      const ay = authorYearFromText(part);
      if (!ay) continue;
      candidates.push({
        key: ay.key,
        ref: ay.ref,
        index: match.index ?? 0,
        sort: localSort++,
      });
    }
  }
  for (const match of text.matchAll(/\b([A-Z][A-Za-z.'-]+)\s+\(((?:19|20)\d{2}[a-z]?)\)/g)) {
    const author = match[1];
    const year = match[2];
    if (!author || !year) continue;
    candidates.push({
      key: authorYearKey(author, year),
      ref: `(${author}, ${year})`,
      index: match.index ?? 0,
      sort: 0,
    });
  }

  const ordered = candidates.sort((a, b) => a.index - b.index || a.sort - b.sort);
  if (!opts.dedupe) {
    return ordered.map((candidate, sort) => ({
      key: candidate.key,
      ref: candidate.ref,
      sort,
    }));
  }

  const seen = new Map<string, CitationRef>();
  let order = 0;
  for (const candidate of ordered) {
    if (!seen.has(candidate.key)) {
      seen.set(candidate.key, {
        key: candidate.key,
        ref: candidate.ref,
        sort: order++,
      });
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.sort - b.sort);
}

function expandNumericCitationMarker(value: string): number[] {
  const out: number[] = [];
  for (const part of value.split(/[;,]/)) {
    const range = part.trim().match(/^(\d{1,4})\s*-\s*(\d{1,4})$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (Number.isInteger(start) && Number.isInteger(end) && end >= start && end - start <= 20) {
        for (let n = start; n <= end; n += 1) out.push(n);
      }
      continue;
    }
    const n = Number(part.trim());
    if (Number.isInteger(n) && n > 0) out.push(n);
  }
  return out;
}

function parseReferenceCatalog(text: string): ReferenceCatalog {
  const primaryEntries: ReferenceEntry[] = [];
  let active: ReferenceStart | null = null;
  const activeLines: string[] = [];

  const flush = () => {
    if (!active) return;
    primaryEntries.push({
      ref: active.ref,
      text: [active.text, ...activeLines].join(' ').trim(),
      sort: active.sort,
    });
    active = null;
    activeLines.length = 0;
  };

  let fallbackSort = 10000;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || isReferenceHeading(trimmed) || THEBIBLIOGRAPHY_RE.test(trimmed)) {
      if (!trimmed) flush();
      continue;
    }
    if (/\\end\{thebibliography}/i.test(trimmed)) {
      flush();
      continue;
    }

    const start = referenceStartFromLine(trimmed, fallbackSort);
    if (start) {
      flush();
      active = start;
      if (start.sort === fallbackSort) fallbackSort += 1;
      continue;
    }

    if (active) activeLines.push(trimmed);
  }
  flush();

  if (primaryEntries.length === 0) {
    let sort = 1;
    for (const block of text.split(/\n\s*\n/)) {
      const clean = block.replace(/\s+/g, ' ').trim();
      if (!clean || !resolveReferenceEntry(clean).resolved) continue;
      primaryEntries.push({ ref: `[${sort}]`, text: clean, sort });
      sort += 1;
    }
  }

  const entries = new Map<string, ReferenceEntry>();
  for (const entry of primaryEntries) {
    entries.set(referenceMapKey(entry.ref), entry);
    const ay = authorYearFromText(entry.text);
    if (ay && !entries.has(ay.key)) entries.set(ay.key, entry);
  }
  return { entries, primaryEntries };
}

function referenceStartFromLine(line: string, fallbackSort: number): ReferenceStart | null {
  const bracketed = line.match(/^\[(\d{1,4})]\s*(.*)$/);
  if (bracketed) {
    const n = Number(bracketed[1]);
    return { key: `num:${n}`, ref: `[${n}]`, text: bracketed[2] ?? '', sort: n };
  }

  const numbered = line.match(/^(\d{1,4})[.)]\s+(.+)$/);
  if (numbered) {
    const n = Number(numbered[1]);
    const text = numbered[2] ?? '';
    return { key: `num:${n}`, ref: `[${n}]`, text, sort: n };
  }

  const bibitem = line.match(/^\\bibitem(?:\[[^\]]*])?{([^}]+)}\s*(.*)$/);
  if (bibitem) {
    const key = bibitem[1] ?? '';
    return {
      key: `tex:${key}`,
      ref: `{${key}}`,
      text: bibitem[2] ?? '',
      sort: fallbackSort,
    };
  }

  const bibtex = line.match(/^@\w+\s*{\s*([^,\s]+)\s*,?\s*(.*)$/);
  if (bibtex) {
    const key = bibtex[1] ?? '';
    return {
      key: `tex:${key}`,
      ref: `{${key}}`,
      text: bibtex[2] ?? '',
      sort: fallbackSort,
    };
  }

  const ay = authorYearReferenceStartFromLine(line);
  if (ay && looksLikeBibliographicText(line)) {
    return { key: ay.key, ref: ay.ref, text: line, sort: fallbackSort };
  }

  return null;
}

function resolveReferenceEntry(text: string): {
  resolved: string | null;
  via: 'doi' | 'arxiv' | 'url' | 'unresolved';
  confidence: 'high' | 'medium' | 'low';
  reason?: string;
} {
  const doi = text.match(DOI_RE);
  if (doi?.[0]) {
    return {
      resolved: cleanIdentifier(doi[0]),
      via: 'doi',
      confidence: 'high',
    };
  }
  const arxiv = text.match(ARXIV_RE);
  if (arxiv?.[1]) {
    return {
      resolved: `arXiv:${arxiv[1]}`,
      via: 'arxiv',
      confidence: 'high',
    };
  }
  const bibtexArxiv = arxivFromBibtexEprint(text);
  if (bibtexArxiv) {
    return {
      resolved: `arXiv:${bibtexArxiv}`,
      via: 'arxiv',
      confidence: 'high',
    };
  }
  const url = text.match(URL_RE);
  if (url?.[0]) {
    return {
      resolved: cleanIdentifier(url[0]),
      via: 'url',
      confidence: 'medium',
    };
  }
  return {
    resolved: null,
    via: 'unresolved',
    confidence: 'low',
    reason: 'No DOI, arXiv, or stable URL found in reference entry.',
  };
}

function isReferenceHeading(value: string): boolean {
  return REFERENCE_HEADING_RE.test(value.trim());
}

function looksLikeBibliographicText(text: string): boolean {
  return (
    DOI_RE.test(text) ||
    ARXIV_RE.test(text) ||
    arxivFromBibtexEprint(text) !== null ||
    URL_RE.test(text) ||
    /\b(?:19|20)\d{2}[a-z]?\b/.test(text) ||
    /^[A-Z][A-Za-z.'-]+,\s+(?:[A-Z]\.|[A-Z][A-Za-z.'-]+)/.test(text) ||
    /^[A-Z]\.\s+[A-Z][A-Za-z.'-]+/.test(text)
  );
}

function bibliographyTargetsFromTex(content: string): string[] {
  const out = new Set<string>();
  const source = content.replace(/%.*$/gm, '');
  const re = /\\(?:bibliography|addbibresource)\b\s*(?:\[[^\]]*]\s*)?\{([^}]+)}/gi;
  for (const match of source.matchAll(re)) {
    for (const raw of (match[1] ?? '').split(',')) {
      const target = normalizeBibliographyTarget(raw);
      if (target) out.add(target);
    }
  }
  return [...out];
}

function selectBibliographyFiles(
  bibFiles: ReadonlyArray<Pick<FileNode, 'path' | 'content'>>,
  targets: ReadonlySet<string>,
): ReadonlyArray<Pick<FileNode, 'path' | 'content'>> {
  if (bibFiles.length === 0) return [];
  if (targets.size === 0) return bibFiles;

  const matched = bibFiles.filter((file) => {
    const normalized = normalizeBibliographyTarget(file.path);
    const basename = normalized.split('/').pop() ?? normalized;
    for (const target of targets) {
      const targetBase = target.split('/').pop() ?? target;
      if (normalized === target || normalized.endsWith(`/${target}`)) return true;
      if (basename === targetBase) return true;
    }
    return false;
  });
  return matched.length > 0 ? matched : bibFiles;
}

function normalizeBibliographyTarget(value: string): string {
  return value
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/\.(bib|bbl)$/i, '')
    .toLowerCase();
}

function bibtexKeysFromBracketGroup(group: string): string[] {
  const parts = group
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return [];

  const keys: string[] = [];
  for (const part of parts) {
    if (!/^[A-Za-z][A-Za-z0-9_.:/-]{1,100}$/.test(part)) return [];
    keys.push(part);
  }

  const hasCitationKeyShape = keys.some(
    (key) => key.includes(':') || /(?:19|20)\d{2}/.test(key),
  );
  return hasCitationKeyShape ? keys : [];
}

function arxivFromBibtexEprint(text: string): string | null {
  const eprint = text.match(/\beprint\s*=\s*[{"]\s*([^}",\s]+)\s*[}"]/i)?.[1];
  if (!eprint) return null;
  const archiveIsArxiv =
    /\barchiveprefix\s*=\s*[{"]\s*arxiv\s*[}"]/i.test(text) ||
    /\beprinttype\s*=\s*[{"]\s*arxiv\s*[}"]/i.test(text);
  const cleaned = eprint.trim().replace(/v\d+$/i, '');
  if (!archiveIsArxiv && !ARXIV_ID_RE.test(cleaned)) return null;
  return ARXIV_ID_RE.test(cleaned) ? cleaned : null;
}

function authorYearFromText(text: string): { readonly key: string; readonly ref: string } | null {
  const trimmed = text.trim();
  const direct =
    authorYearReferenceStartMatch(trimmed) ??
    trimmed.match(/\b([A-Z][A-Za-z.'-]{1,})(?:\s+et\s+al\.)?,\s*((?:19|20)\d{2}[a-z]?)\b/) ??
    trimmed.match(/\b([A-Z][A-Za-z.'-]{1,})\s+\(((?:19|20)\d{2}[a-z]?)\)/);
  const author = direct?.[1];
  const year = direct?.[2];
  if (!author || !year) return null;
  return { key: authorYearKey(author, year), ref: `(${author}, ${year})` };
}

function authorYearReferenceStartFromLine(
  line: string,
): { readonly key: string; readonly ref: string } | null {
  const match = authorYearReferenceStartMatch(line.trim());
  const author = match?.[1];
  const year = match?.[2];
  if (!author || !year) return null;
  return { key: authorYearKey(author, year), ref: `(${author}, ${year})` };
}

function authorYearReferenceStartMatch(text: string): RegExpMatchArray | null {
  return (
    text.match(/^([A-Z][A-Za-z.'-]{1,})(?:\s+et\s+al\.)?\s*\(((?:19|20)\d{2}[a-z]?)\)/) ??
    text.match(
      /^([A-Z][A-Za-z.'-]{1,}),\s+(?:[A-Z](?:\.)?|[A-Z][A-Za-z.'-]+).*?\(?((?:19|20)\d{2}[a-z]?)\)?/,
    )
  );
}

function authorYearKey(author: string, year: string): string {
  return `ay:${author.toLowerCase()}:${year.toLowerCase()}`;
}

function referenceMapKey(ref: string): string {
  const numeric = ref.match(/^\[(\d+)]$/);
  if (numeric?.[1]) return `num:${numeric[1]}`;
  const tex = ref.match(/^{(.+)}$/);
  if (tex?.[1]) return `tex:${tex[1]}`;
  return ref;
}

function cleanIdentifier(value: string): string {
  let out = value.trim();
  out = out.replace(/[.,;:]+$/g, '');
  while ((out.endsWith(')') && !out.includes('(')) || (out.endsWith(']') && !out.includes('['))) {
    out = out.slice(0, -1);
  }
  return out;
}
