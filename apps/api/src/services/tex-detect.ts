/**
 * Auto-detect the entry `.tex` in a freshly-extracted source bundle.
 *
 * Resolution rules:
 *   1. Scan all `.tex` files in the extracted tree, so common zip
 *      wrapper folders and deeper `source/` layouts do not matter.
 *   2. For each `.tex` file: read up to the first 200 lines and look
 *      for a `\documentclass` directive that is NOT inside a comment
 *      (`split('%')[0]` strips trailing comments first).
 *   3. Exactly one candidate → success.
 *   4. Zero candidates → `no_documentclass` (paper is missing).
 *   5. Multiple equally plausible candidates → `multiple_documentclass`.
 *      Clear supplements/examples/templates are deprioritized so an
 *      otherwise valid paper archive does not fail preflight.
 *
 * The detector is **pure** — it consumes a `FileNode[]` so the caller
 * stays in control of disk I/O. The companion-files check uses the
 * same `FileNode[]` to look up referenced figures / .bib without
 * re-walking the tree.
 *
 * Comments: `%` at any position in a line starts a TeX comment unless
 * it's preceded by `\`. The detector handles the escape: it walks
 * character-by-character to find the first unescaped `%` and slices
 * there.
 */

import {
  detectLatexEntry,
  stripTexComment,
} from '@openxiv/shared';

export { looksLikeManuscript, stripTexComment } from '@openxiv/shared';

export interface FileNode {
  /** Relative path inside the archive, POSIX separators (`/`). */
  path: string;
  /** UTF-8 source contents. Binary files supply an empty string. */
  content: string;
  /** Raw bytes when the extractor can safely keep them in memory. */
  bytes?: Buffer;
}

export type DetectResult =
  | { ok: true; entry: FileNode }
  | { ok: false; error: 'no_documentclass' }
  | { ok: false; error: 'multiple_documentclass'; files: string[] };

export interface TexMetadata {
  readonly title?: string;
  readonly abstract?: string;
  readonly authors: Array<{ displayName: string; orcid?: string; affiliation?: string }>;
  readonly date?: string;
  readonly keywords: string[];
  readonly bodyText: string;
}

/** Detect the single LaTeX entry file in an extracted bundle. */
export function detectEntryTex(files: FileNode[]): DetectResult {
  return detectLatexEntry(files);
}

// ---------------------------------------------------------------------------
// Metadata fallback (GROBID failure path)
// ---------------------------------------------------------------------------

/**
 * Pull the metadata that authors usually write directly into the entry TeX.
 *
 * This is intentionally conservative: it reads explicit `\title{}`,
 * `\author{}`, `abstract`, and `hypersetup{pdfkeywords={...}}` fields. It
 * does not infer bibliographic metadata from filenames or archive paths.
 */
export function extractTexMetadata(content: string): TexMetadata {
  const source = applySimpleMacros(stripTexComments(content));
  const hypersetup = firstCommandArg(source, 'hypersetup') ?? '';

  const title =
    cleanTexText(firstCommandArg(source, 'title')) ||
    cleanTexText(bracedValueForKey(hypersetup, 'pdftitle')) ||
    undefined;
  const abstract = cleanTexAbstract(environmentBody(source, 'abstract')) || undefined;

  const authors = extractAuthors(source);
  const pdfAuthor = cleanTexText(bracedValueForKey(hypersetup, 'pdfauthor'));
  const authorFallback = pdfAuthor
    ? splitAuthorNames(pdfAuthor).map((displayName) => ({ displayName }))
    : [];

  const date = parseTexDate(firstCommandArg(source, 'date'));
  const keywords = extractKeywords(source, hypersetup);

  const bodyText = [title, abstract, keywords.join(', ')].filter(Boolean).join('\n\n');
  return {
    ...(title ? { title } : {}),
    ...(abstract ? { abstract } : {}),
    authors: authors.length > 0 ? authors : authorFallback,
    ...(date ? { date } : {}),
    keywords,
    bodyText,
  };
}

// ---------------------------------------------------------------------------
// Companion-file inspection (loose .tex uploads)
// ---------------------------------------------------------------------------

/**
 * Compile regex source paths used in `\includegraphics`,
 * `\bibliography`, `\addbibresource`, `\input`, `\include`.
 *
 * Exported for unit testing.
 */
export function findReferencedPaths(content: string): string[] {
  const source = stripTexComments(content);
  const out = new Set<string>();
  // Generic helper — pulls the inner `{...}` argument for a command.
  const collect = (re: RegExp): void => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const arg = (m[1] ?? '').trim();
      if (!arg) continue;
      // Multiple comma-separated args (e.g. \bibliography{a,b}).
      for (const item of arg.split(',')) {
        const v = item.trim();
        if (v) out.add(v);
      }
    }
  };
  collect(/\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g);
  collect(/\\bibliography\s*\{([^}]+)\}/g);
  collect(/\\addbibresource\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g);
  collect(/\\input\s*\{([^}]+)\}/g);
  collect(/\\include\s*\{([^}]+)\}/g);
  return [...out];
}

/**
 * For a single-`.tex` upload, compute the list of referenced files
 * that the user did NOT bundle alongside.
 *
 * `present` is the set of (lowercased, basename-only) names that came
 * up in the upload other than the main .tex. The match is fuzzy on
 * purpose — LaTeX's path resolver tries several extensions and search
 * paths, so we compare basenames + accept a missing extension as a
 * match against any extension.
 *
 * The function returns `[]` when nothing is missing (no companions
 * needed → accept). Otherwise the missing list lands in the user
 * message.
 */
export function missingCompanions(
  refs: string[],
  present: Iterable<string>,
): string[] {
  const presentSet = new Set<string>();
  for (const p of present) {
    const lower = p.toLowerCase();
    presentSet.add(lower);
    // Also store the basename so a ref to `fig1` matches `fig1.pdf`.
    const base = lower.replace(/^.*\//, '');
    presentSet.add(base);
    // And the basename without extension.
    presentSet.add(base.replace(/\.[^.]+$/, ''));
  }
  const out: string[] = [];
  for (const r of refs) {
    const lower = r.toLowerCase();
    const base = lower.replace(/^.*\//, '');
    const baseNoExt = base.replace(/\.[^.]+$/, '');
    if (presentSet.has(lower)) continue;
    if (presentSet.has(base)) continue;
    if (presentSet.has(baseNoExt)) continue;
    out.push(r);
  }
  return out.sort();
}

function stripTexComments(content: string): string {
  return content
    .split(/\r?\n/)
    .map(stripTexComment)
    .join('\n');
}

function commandArgs(source: string, command: string): string[] {
  return commandArgSpans(source, [command]).map((s) => s.value);
}

function commandArgSpans(
  source: string,
  commands: string[],
): Array<{ command: string; value: string; start: number; end: number }> {
  const names = commands.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`\\\\(${names})\\b\\s*(?:\\[[^\\]]*\\]\\s*)?\\{`, 'g');
  const spans: Array<{ command: string; value: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const open = m.index + m[0].length - 1;
    const value = readBalancedBraces(source, open);
    if (value) {
      spans.push({ command: m[1]!, value: value.value, start: m.index, end: value.end });
      re.lastIndex = value.end;
    }
  }
  return spans;
}

function firstCommandArg(source: string, command: string): string | undefined {
  return commandArgs(source, command)[0];
}

function environmentBody(source: string, env: string): string | undefined {
  const re = new RegExp(`\\\\begin\\{${env}\\}([\\s\\S]*?)\\\\end\\{${env}\\}`, 'i');
  return re.exec(source)?.[1];
}

function bracedValueForKey(source: string, key: string): string | undefined {
  const re = new RegExp(`${key}\\s*=\\s*\\{`, 'i');
  const m = re.exec(source);
  if (!m) return undefined;
  const open = m.index + m[0].length - 1;
  return readBalancedBraces(source, open)?.value;
}

function readBalancedBraces(
  source: string,
  open: number,
): { value: string; end: number } | null {
  if (source[open] !== '{') return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i]!;
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        return { value: source.slice(open + 1, i), end: i + 1 };
      }
    }
  }
  return null;
}

function extractAuthors(source: string): Array<{ displayName: string; affiliation?: string }> {
  const out: Array<{ displayName: string; affiliation?: string }> = [];
  let pending: number[] = [];
  const spans = commandArgSpans(source, ['author', 'affiliation', 'address']).sort((a, b) => a.start - b.start);
  for (const span of spans) {
    if (span.command === 'author') {
      const parsed = parseAuthorArg(span.value);
      pending = [];
      for (const name of parsed.names) {
        const author: { displayName: string; affiliation?: string } = { displayName: name };
        if (parsed.affiliation) author.affiliation = parsed.affiliation;
        out.push(author);
        pending.push(out.length - 1);
      }
      continue;
    }
    const affiliation = cleanTexText(span.value);
    if (!affiliation) continue;
    const targets = pending.length > 0 ? pending : out.map((_a, i) => i);
    for (const idx of targets) {
      const author = out[idx];
      if (!author) continue;
      author.affiliation = mergeAffiliation(author.affiliation, affiliation);
    }
  }
  return out;
}

function parseAuthorArg(input: string): { names: string[]; affiliation?: string } {
  const thanks = commandArgs(input, 'thanks').map(cleanTexText).filter(Boolean);
  const withoutThanks = input.replace(/\\thanks\b\s*(?:\[[^\]]*\]\s*)?\{(?:[^{}]|\{[^{}]*\})*\}/g, ' ');
  const parts = withoutThanks.split(/\\\\(?:\s*\[[^\]]*\])?\s*/);
  const authorPart = parts.shift() ?? withoutThanks;
  const tailAffiliations = parts
    .map(cleanTexText)
    .filter((s) => s && !looksLikeEmailOnly(s) && !/^orcid\b/i.test(s));
  const names = splitAuthorNames(authorPart);
  const affiliation = unique([...thanks, ...tailAffiliations]).join('; ') || undefined;
  return { names, ...(affiliation ? { affiliation } : {}) };
}

function splitAuthorNames(input: string): string[] {
  const normalized = input
    .replace(/\\and\b/g, ' and ')
    .replace(/\band\b/gi, ' and ');
  const andPieces = normalized.split(/\s+and\s+/i).map(cleanTexText).filter(Boolean);
  const rawPieces = andPieces.length > 1 ? andPieces : [normalized];
  const out: string[] = [];
  for (const piece of rawPieces) {
    const cleaned = cleanTexText(piece);
    if (!cleaned) continue;
    const commaPieces = cleaned.split(/\s*,\s*/).filter(Boolean);
    const splitOnComma =
      commaPieces.length > 2 ||
      (commaPieces.length === 2 && commaPieces.every((p) => p.trim().split(/\s+/).length >= 2));
    if (splitOnComma) out.push(...commaPieces.map(cleanTexText).filter(Boolean));
    else out.push(cleaned);
  }
  return unique(out);
}

function mergeAffiliation(existing: string | undefined, next: string): string {
  return unique([...(existing ? existing.split(/\s*;\s*/) : []), next]).join('; ');
}

function looksLikeEmailOnly(value: string): boolean {
  const stripped = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(stripped);
}

function parseTexDate(input?: string): string | undefined {
  if (input === undefined) return undefined;
  if (/\\today\b/.test(input)) return new Date().toISOString().slice(0, 10);
  const cleaned = cleanTexText(input);
  if (!cleaned) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(cleaned)) return cleaned.replace(/\//g, '-');
  const parsed = new Date(cleaned);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return cleaned;
}

function extractKeywords(source: string, hypersetup: string): string[] {
  const chunks: string[] = [];
  const pdfKeywords = bracedValueForKey(hypersetup, 'pdfkeywords');
  if (pdfKeywords) chunks.push(pdfKeywords);
  for (const command of ['keywords', 'keyword', 'pacs', 'PACS', 'msc', 'MSC', 'subjclass']) {
    chunks.push(...commandArgs(source, command));
  }
  chunks.push(...labelBlocks(source, /^keywords?\s*:/i));
  chunks.push(...labelBlocks(source, /^(?:MSC|PACS)(?:\s+\d{4})?\s*:/i));
  return unique(
    chunks.flatMap((chunk) =>
      cleanTexText(chunk)
        .replace(/^(?:keywords?|MSC|PACS)(?:\s+\d{4})?\s*:\s*/i, '')
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

function labelBlocks(source: string, label: RegExp): string[] {
  const lines = source.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const first = cleanTexText(lines[i]);
    if (!label.test(first)) continue;
    const parts = [first];
    for (let j = i + 1; j < lines.length; j++) {
      const raw = lines[j] ?? '';
      const cleaned = cleanTexText(raw);
      if (!cleaned) break;
      if (/^(?:MSC|PACS|keywords?)\b/i.test(cleaned)) break;
      if (/^\\(?:section|subsection|tableofcontents|begin|end)\b/.test(raw.trim())) break;
      parts.push(cleaned);
    }
    out.push(parts.join(' '));
  }
  return out;
}

function applySimpleMacros(input: string): string {
  const macros = new Map<string, string>([
    ['LaTeX', 'LaTeX'],
    ['TeX', 'TeX'],
  ]);
  const commandDef = /\\(?:re)?newcommand\s*\{\\([A-Za-z]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = commandDef.exec(input)) !== null) {
    const name = m[1];
    let pos = m.index + m[0].length;
    while (/\s/.test(input[pos] ?? '')) pos++;
    if (input[pos] === '[') continue;
    const value = readBalancedBraces(input, pos);
    if (name && value?.value && !/#/.test(value.value)) {
      macros.set(name, value.value);
      commandDef.lastIndex = value.end;
    }
  }
  const def = /\\def\\([A-Za-z]+)\s*/g;
  while ((m = def.exec(input)) !== null) {
    const name = m[1];
    const value = readBalancedBraces(input, m.index + m[0].length);
    if (name && value?.value && !/#/.test(value.value)) {
      macros.set(name, value.value);
      def.lastIndex = value.end;
    }
  }
  let out = input;
  for (const [name, value] of macros) {
    out = out.replace(new RegExp(`\\\\${name}(?![A-Za-z])`, 'g'), value);
  }
  return out;
}

function cleanTexAbstract(input?: string): string {
  if (!input) return '';
  const math: string[] = [];
  const stash = (value: string): string => {
    const token = `@@OPENXIV_MATH_${math.length}@@`;
    math.push(value);
    return token;
  };

  let out = input
    .replace(/\\noindent\b/g, ' ')
    .replace(/\\(?:cite|citep|citet|citealp|parencite|textcite)\b(?:\s*\[[^\]]*\])?\s*\{([^{}]*)\}/g, (_m, keys: string) =>
      `[${keys.split(',').map((key) => key.trim()).filter(Boolean).join(', ')}]`,
    )
    .replace(/\\\[((?:.|\n)*?)\\\]/g, (_m, body: string) => stash(`\\[${normalizeMath(body)}\\]`))
    .replace(/\$\$((?:.|\n)*?)\$\$/g, (_m, body: string) => stash(`\\[${normalizeMath(body)}\\]`))
    .replace(/\\\(((?:.|\n)*?)\\\)/g, (_m, body: string) => stash(`\\(${normalizeMath(body)}\\)`))
    .replace(/(?<!\\)\$((?:\\.|[^$]){1,1000}?)(?<!\\)\$/g, (_m, body: string) =>
      stash(`\\(${normalizeMath(body)}\\)`),
    );

  out = cleanTexText(out);
  for (let i = 0; i < math.length; i++) {
    out = out.replace(`@@OPENXIV_MATH_${i}@@`, math[i]!);
  }
  return out;
}

function normalizeMath(input: string): string {
  return input
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
}

function cleanTexText(input?: string): string {
  if (!input) return '';
  let out = input
    .replace(/\\(?:label|ref|cite|url|href|email)\b(?:\s*\[[^\]]*\])?\s*\{([^{}]*)\}/g, '$1')
    .replace(/\\[()]/g, '')
    .replace(/\\,/g, ' ')
    .replace(/\\ /g, ' ')
    .replace(/\\&/g, '&')
    .replace(/\\%/g, '%')
    .replace(/\\['"`^~=cHuUv]\s*\{?([A-Za-z])\}?/g, '$1')
    .replace(/---/g, '-')
    .replace(/--/g, '-')
    .replace(/~/g, ' ')
    .replace(/\\\\(?:\s*\[[^\]]*\])?\s*/g, ' ')
    .replace(/\\(?=\s)/g, ' ');

  for (let i = 0; i < 6; i++) {
    const next = out.replace(/\\[a-zA-Z*]+(?:\s*\[[^\]]*\])?\s*\{([^{}]*)\}/g, '$1');
    if (next === out) break;
    out = next;
  }

  return out
    .replace(/\\[a-zA-Z*]+(?:\s*\[[^\]]*\])?/g, ' ')
    .replace(/[{}$]/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}
