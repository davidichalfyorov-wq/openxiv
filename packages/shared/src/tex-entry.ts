export interface LatexEntryFile {
  /** Relative path inside an archive, using either POSIX or Windows separators. */
  readonly path: string;
  /** UTF-8 source contents. Binary files should pass an empty string. */
  readonly content: string;
}

export type LatexEntryResult<T extends LatexEntryFile = LatexEntryFile> =
  | { ok: true; entry: T }
  | { ok: false; error: 'no_documentclass' }
  | { ok: false; error: 'multiple_documentclass'; files: string[] };

export const TEX_DOCUMENT_HEAD_LINES = 200;

export function stripTexComment(line: string): string {
  let out = '';
  let i = 0;
  while (i < line.length) {
    const ch = line[i]!;
    if (ch !== '%') {
      out += ch;
      i++;
      continue;
    }
    let bs = 0;
    let j = out.length - 1;
    while (j >= 0 && out[j] === '\\') {
      bs++;
      j--;
    }
    if (bs % 2 === 1) {
      out += '%';
      i++;
      continue;
    }
    break;
  }
  return out;
}

export function looksLikeManuscript(content: string): boolean {
  const head = content.split(/\r?\n/, TEX_DOCUMENT_HEAD_LINES);
  for (const raw of head) {
    const stripped = stripTexComment(raw);
    if (/\\documentclass\b/.test(stripped)) return true;
  }
  return false;
}

export function detectLatexEntry<T extends LatexEntryFile>(
  files: readonly T[],
): LatexEntryResult<T> {
  const candidates = files
    .filter((file) => /\.tex$/i.test(normalizePath(file.path)))
    .filter((file) => Boolean(file.content))
    .filter((file) => looksLikeManuscript(file.content));

  if (candidates.length === 0) return { ok: false, error: 'no_documentclass' };
  if (candidates.length === 1) return { ok: true, entry: candidates[0]! };

  const ranked = candidates
    .map((file) => ({
      file,
      path: normalizePath(file.path),
      score: scoreLatexEntry(file),
    }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

  const [best, second] = ranked;
  if (best && second && best.score >= second.score + 25) {
    return { ok: true, entry: best.file };
  }

  return {
    ok: false,
    error: 'multiple_documentclass',
    files: ranked.map((candidate) => candidate.path).sort(),
  };
}

function scoreLatexEntry(file: LatexEntryFile): number {
  const normalized = normalizePath(file.path);
  const parts = normalized.split('/').filter(Boolean);
  const basename = parts[parts.length - 1]?.toLowerCase() ?? '';
  const stem = basename.replace(/\.tex$/i, '');
  const content = file.content;
  let score = 100 - Math.min(70, Math.max(0, parts.length - 1) * 8);

  if (stem === 'main') score += 60;
  else if (['paper', 'manuscript', 'article', 'submission'].includes(stem)) score += 45;
  else if (/^(main|paper|manuscript|article|submission)[_-]?\d+$/i.test(stem)) score += 40;
  else if (/^(ms|draft)$/i.test(stem)) score += 25;

  if (
    /^(supp|supplement|supplementary|appendix|appendices|response|cover|letter|template|sample|example|demo|readme|notes?)$/i.test(
      stem,
    )
  ) {
    score -= 55;
  }

  for (const part of parts.slice(0, -1)) {
    const lower = part.toLowerCase();
    if (['src', 'source', 'sources', 'paper', 'manuscript', 'submission'].includes(lower)) {
      score += 8;
    }
    if (
      [
        'supp',
        'supplement',
        'supplements',
        'supplemental',
        'supplementary',
        'supporting',
        'supporting-information',
      ].includes(lower)
    ) {
      score -= 85;
    }
    if (['example', 'examples', 'sample', 'samples', 'template', 'templates', 'demo'].includes(lower)) {
      score -= 65;
    }
    if (
      [
        'build',
        'cache',
        'dist',
        'node_modules',
        'out',
        'target',
        'tmp',
        'temp',
        '__macosx',
        '.git',
        '.latexmk',
      ].includes(lower)
    ) {
      score -= 120;
    }
  }

  if (/\\documentclass(?:\s*\[[^\]]*\])?\s*\{standalone\}/i.test(content)) score -= 35;
  if (/\\begin\{document\}/.test(content)) score += 30;
  if (/\\title\b/.test(content)) score += 8;
  if (/\\author\b/.test(content)) score += 8;
  if (/\\begin\{abstract\}/i.test(content)) score += 6;
  if (/\\maketitle\b/.test(content)) score += 4;
  if (/\\(?:bibliography|addbibresource)\b/.test(content)) score += 4;
  if (/\\includegraphics\b/.test(content)) score += 3;

  return score;
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/\/+/g, '/');
}
