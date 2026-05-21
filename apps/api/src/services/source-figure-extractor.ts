import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, posix as pathPosix } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { extractToFileNodes } from './archive-extract.js';
import type { FileNode } from './tex-detect.js';

export interface SourceFigureAsset {
  idx: number;
  data: Buffer;
  contentType: string;
  extension: string;
  caption: string | null;
  originalPath: string;
}

interface SourceFigureCandidate {
  path: string;
  bytes: Buffer;
  kind: 'direct' | 'pdf' | 'svg';
  extension: string;
  contentType: string;
}

interface TexGraphicRef {
  baseDir: string;
  target: string;
  searchDirs: string[];
}

export interface SourceFigureExtractorOptions {
  maxFigures?: number;
}

const DEFAULT_MAX_SOURCE_FIGURES = 64;

const DIRECT_IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export async function extractFiguresFromSourceArchive(
  source: Buffer,
  filename: string,
  options: SourceFigureExtractorOptions = {},
): Promise<SourceFigureAsset[]> {
  const files = await extractToFileNodes(source, filename);
  const candidates = collectSourceFigureCandidates(files).slice(
    0,
    options.maxFigures ?? DEFAULT_MAX_SOURCE_FIGURES,
  );
  const out: SourceFigureAsset[] = [];
  for (const candidate of candidates) {
    try {
      const rendered = await renderSourceFigure(candidate);
      out.push({
        idx: out.length,
        ...rendered,
        caption: captionFromPath(candidate.path),
        originalPath: candidate.path,
      });
    } catch (e) {
      console.warn(
        '[source-figures] skipped source figure:',
        candidate.path,
        (e as Error)?.message ?? e,
      );
    }
  }
  return out;
}

function collectSourceFigureCandidates(files: FileNode[]): SourceFigureCandidate[] {
  const mediaAssets: SourceFigureCandidate[] = [];
  for (const file of files) {
    if (!file.bytes || file.bytes.length === 0) continue;
    if (shouldIgnoreArchivePath(file.path)) continue;
    const ext = extname(file.path).toLowerCase();
    const directType = DIRECT_IMAGE_TYPES[ext];
    if (directType) {
      mediaAssets.push({
        path: file.path,
        bytes: file.bytes,
        kind: 'direct',
        extension: ext.slice(1),
        contentType: directType,
      });
      continue;
    }
    if (ext === '.pdf') {
      mediaAssets.push({
        path: file.path,
        bytes: file.bytes,
        kind: 'pdf',
        extension: 'png',
        contentType: 'image/png',
      });
      continue;
    }
    if (ext === '.svg') {
      mediaAssets.push({
        path: file.path,
        bytes: file.bytes,
        kind: 'svg',
        extension: 'png',
        contentType: 'image/png',
      });
    }
  }
  const refs = collectTexGraphicRefs(files);
  if (refs.length > 0) {
    return matchReferencedAssets(refs, mediaAssets);
  }
  return mediaAssets
    .filter(isSafeFallbackAsset)
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}

function collectTexGraphicRefs(files: FileNode[]): TexGraphicRef[] {
  const refs: TexGraphicRef[] = [];
  for (const file of files) {
    if (!/\.tex$/i.test(file.path) || !file.content) continue;
    const baseDir = dirname(normalizeArchivePath(file.path));
    const content = stripLatexComments(file.content);
    const searchDirs = ['', ...extractGraphicspathDirs(content)];
    const includeRe = /\\includegraphics\*?\s*(?:\[[^\]]*\]\s*)*\{([^}]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = includeRe.exec(content)) !== null) {
      const target = (m[1] ?? '').trim();
      if (!target) continue;
      refs.push({ baseDir: baseDir === '.' ? '' : baseDir, target, searchDirs });
    }
  }
  return refs;
}

function extractGraphicspathDirs(content: string): string[] {
  const dirs: string[] = [];
  const graphicspathRe = /\\graphicspath\s*\{((?:\s*\{[^{}]*\}\s*)+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = graphicspathRe.exec(content)) !== null) {
    const body = m[1] ?? '';
    const dirRe = /\{([^{}]*)\}/g;
    let d: RegExpExecArray | null;
    while ((d = dirRe.exec(body)) !== null) {
      const dir = (d[1] ?? '').trim();
      if (dir) dirs.push(dir);
    }
  }
  return dirs;
}

function matchReferencedAssets(
  refs: TexGraphicRef[],
  mediaAssets: SourceFigureCandidate[],
): SourceFigureCandidate[] {
  const out: SourceFigureCandidate[] = [];
  const used = new Set<string>();
  for (const ref of refs) {
    for (const candidate of mediaAssets) {
      const key = normalizeArchivePath(candidate.path).toLowerCase();
      if (used.has(key)) continue;
      if (!texRefMatchesCandidate(ref, candidate.path)) continue;
      out.push(candidate);
      used.add(key);
      break;
    }
  }
  return out;
}

function texRefMatchesCandidate(ref: TexGraphicRef, candidatePath: string): boolean {
  const candidate = normalizeArchivePath(candidatePath).toLowerCase();
  const candidateNoExt = stripExtension(candidate);
  for (const dir of ref.searchDirs) {
    const resolved = normalizeArchivePath([ref.baseDir, dir, ref.target].filter(Boolean).join('/'));
    const lower = resolved.toLowerCase();
    if (extname(lower)) {
      if (candidate === lower) return true;
    } else if (candidateNoExt === lower) {
      return true;
    }
  }
  return false;
}

function isSafeFallbackAsset(candidate: SourceFigureCandidate): boolean {
  const normalized = normalizeArchivePath(candidate.path).toLowerCase();
  const parts = normalized.split('/');
  if (
    parts.some((part) =>
      [
        '.cache',
        '.git',
        'build',
        'cache',
        'dist',
        'node_modules',
        'out',
        'output',
        'supplement',
        'supplemental',
        'supplements',
        'supplementary',
        'supporting',
        'supporting-information',
        'target',
        'temp',
        'tmp',
      ].includes(part),
    )
  ) {
    return false;
  }
  const leaf = basename(normalized);
  const stem = stripExtension(leaf);
  if (
    [
      'article',
      'compiled',
      'main',
      'manuscript',
      'paper',
      'preprint',
      'source',
      'submission',
    ].includes(stem)
  ) {
    return false;
  }
  if (/(^|[-_.])(appendix|cover|icon|license|logo|readme|supplement|supplementary)([-_.]|$)/i.test(stem)) {
    return false;
  }
  return true;
}

function normalizeArchivePath(path: string): string {
  const normalized = pathPosix.normalize(path.replaceAll('\\', '/')).replace(/^\/+/, '');
  return normalized === '.' ? '' : normalized.replace(/^\.\//, '');
}

function stripExtension(path: string): string {
  return path.replace(/\.[^.\/]+$/, '');
}

function stripLatexComments(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|[^\\])%.*/, '$1'))
    .join('\n');
}

async function renderSourceFigure(
  candidate: SourceFigureCandidate,
): Promise<{ data: Buffer; contentType: string; extension: string }> {
  if (candidate.kind === 'direct') {
    return {
      data: candidate.bytes,
      contentType: candidate.contentType,
      extension: candidate.extension,
    };
  }
  if (candidate.kind === 'svg') {
    const rendered = new Resvg(candidate.bytes, {
      fitTo: { mode: 'width', value: 1400 },
    }).render();
    return { data: rendered.asPng(), contentType: 'image/png', extension: 'png' };
  }
  const png = await rasterizePdfFirstPage(candidate.bytes);
  return { data: png, contentType: 'image/png', extension: 'png' };
}

async function rasterizePdfFirstPage(pdf: Buffer): Promise<Buffer> {
  const work = await mkdtemp(join(tmpdir(), 'openxiv-source-fig-'));
  const pdfPath = join(work, 'figure.pdf');
  const outPrefix = join(work, 'figure');
  try {
    await writeFile(pdfPath, pdf);
    await runPdfToCairo([
      '-png',
      '-r',
      '180',
      '-f',
      '1',
      '-l',
      '1',
      '-singlefile',
      pdfPath,
      outPrefix,
    ]);
    return await readFile(`${outPrefix}.png`);
  } finally {
    rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

function runPdfToCairo(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('pdftocairo', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 8192) stderr = stderr.slice(-8192);
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pdftocairo exit ${code}: ${stderr.trim()}`));
    });
  });
}

function shouldIgnoreArchivePath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/');
  if (normalized.startsWith('__MACOSX/')) return true;
  return normalized.split('/').some((part) => part === '.DS_Store' || part.startsWith('._'));
}

function captionFromPath(path: string): string | null {
  const leaf = basename(path).trim();
  return leaf ? `Source figure: ${leaf}` : null;
}

export function sourceFigureUploadKey(input: {
  paperId: string;
  version: number;
  figure: SourceFigureAsset;
}): string {
  const sha = createHash('sha256').update(input.figure.data).digest('hex').slice(0, 12);
  return `papers/${input.paperId}/v${input.version}-source-fig-${input.figure.idx}-${sha}.${input.figure.extension}`;
}

export const __testing = {
  collectSourceFigureCandidates,
  shouldIgnoreArchivePath,
  captionFromPath,
  collectTexGraphicRefs,
  isSafeFallbackAsset,
};
