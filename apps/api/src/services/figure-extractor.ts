import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchWithTimeoutRetry } from '@openxiv/clients';
import { Errors, type AppResultAsync, fromPromise } from '@openxiv/shared';
import type { FigureBbox, PaperFigureType } from '@openxiv/db';

/**
 * Tier-2 figure extraction. Wraps two binaries:
 *
 *   1. **GROBID** `processFulltextDocument` — POSTed the original PDF
 *      with `teiCoordinates=figure&teiCoordinates=table`. GROBID emits
 *      TEI XML whose <figure>/<table> elements (and their <graphic>
 *      children) carry a `coords="P,X,Y,W,H"` attribute in PDF user-
 *      space points. (P is 1-based page, X/Y is top-left origin.)
 *
 *   2. **pdftocairo** (poppler-utils) — for each figure with valid
 *      coords, render the cropped region of the source PDF to a
 *      300-dpi PNG. We shell out rather than embed a Node renderer
 *      (`pdfjs-dist + canvas`) because poppler is well-tested, ~10× the
 *      throughput, and already idiomatic in the GROBID world.
 *
 * Failure semantics: this service is **fail-closed**. Any failure
 * (GROBID 5xx, GROBID timeout, TEI parse error, pdftocairo non-zero,
 * temp dir disk-full) yields a successful `Result` containing an empty
 * array. The caller treats "no figures" as "no figures detected" — a
 * paper without figures is still published; the worker just skips the
 * upsert. The cascade matches the pdf-finalize philosophy: a tier-2
 * enrichment never blocks the main publish pipeline.
 *
 * Multi-page figures: skipped in MVP. A figure whose bbox crosses a
 * page boundary in GROBID's TEI gets emitted as multiple `<graphic>`
 * children; we take the first one with `coords` set.
 */

export interface ExtractedFigure {
  /** 0-based sequential index in the order GROBID emitted them. */
  idx: number;
  /** 1-based PDF page the figure lives on. */
  page: number;
  /** PDF user-space coordinates in points (1pt = 1/72in). */
  bbox: FigureBbox;
  /** Cleaned caption text. May be null when GROBID found no <figDesc>. */
  caption: string | null;
  type: PaperFigureType;
  /** PNG bytes of the cropped region, 300 dpi. */
  png: Buffer;
}

export interface FigureExtractorConfig {
  /** GROBID base URL (e.g. http://grobid:8070). */
  grobidUrl: string;
  /** Soft cap on the whole pipeline. Default 60s. */
  timeoutMs?: number;
  /** Hard cap on the number of figures we crop per paper. Default 32. */
  maxFigures?: number;
  /** Render DPI for the crop. Default 300. */
  renderDpi?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const GROBID_REQUEST_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_FIGURES = 32;
const DEFAULT_RENDER_DPI = 300;

export interface FigureExtractor {
  extractFigures(pdf: Buffer): AppResultAsync<ExtractedFigure[]>;
}

export function makeFigureExtractor(cfg: FigureExtractorConfig): FigureExtractor {
  return {
    extractFigures(pdf) {
      return fromPromise(
        extractImpl(pdf, cfg).catch((e: unknown) => {
          // Fail-closed: log and return empty.
          console.warn(
            '[figure-extractor] extraction failed:',
            (e as Error)?.message ?? String(e),
          );
          return [] as ExtractedFigure[];
        }),
        (cause) => Errors.internal('figure-extractor', cause),
      );
    },
  };
}

async function extractImpl(pdf: Buffer, cfg: FigureExtractorConfig): Promise<ExtractedFigure[]> {
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxFigures = cfg.maxFigures ?? DEFAULT_MAX_FIGURES;
  const dpi = cfg.renderDpi ?? DEFAULT_RENDER_DPI;
  const start = Date.now();

  const tmpRoot = await mkdtemp(join(tmpdir(), 'openxiv-fig-'));
  const pdfPath = join(tmpRoot, 'input.pdf');
  try {
    await writeFile(pdfPath, pdf);

    // ---- GROBID ----
    const tei = await callGrobidWithCoords(pdf, cfg.grobidUrl, timeoutMs);
    if (Date.now() - start > timeoutMs) return [];
    const captionAnchored = await inferCaptionAnchoredFigureCrops(pdfPath, tei);
    const parsed = (captionAnchored.length > 0 ? captionAnchored : parseFigureBlocks(tei)).slice(
      0,
      maxFigures,
    );
    if (parsed.length === 0) return [];

    // ---- Crop ----
    const out: ExtractedFigure[] = [];
    for (const fig of parsed) {
      if (Date.now() - start > timeoutMs) break;
      try {
        const png = await cropToPng(pdfPath, fig.bbox, dpi);
        if (png.length > 0) {
          out.push({
            idx: out.length,
            page: fig.bbox.p,
            bbox: fig.bbox,
            caption: fig.caption,
            type: fig.type,
            png,
          });
        }
      } catch (e) {
        // Single figure failure shouldn't kill the batch.
        console.warn(
          `[figure-extractor] crop fail page=${fig.bbox.p}:`,
          (e as Error)?.message ?? e,
        );
      }
    }
    return out;
  } finally {
    rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// GROBID
// ---------------------------------------------------------------------------

async function callGrobidWithCoords(
  pdf: Buffer,
  grobidUrl: string,
  timeoutMs: number,
): Promise<string> {
  const form = new FormData();
  form.append('input', new Blob([pdf], { type: 'application/pdf' }), 'paper.pdf');
  // Tell GROBID to annotate figures+tables with their PDF coordinates.
  // Multiple `teiCoordinates` form fields stack into a list.
  form.append('teiCoordinates', 'figure');
  form.append('teiCoordinates', 'table');
  form.append('teiCoordinates', 'graphic');
  form.append('consolidateHeader', '0');
  form.append('consolidateCitations', '0');

  const res = await fetchWithTimeoutRetry(`${grobidUrl}/api/processFulltextDocument`, {
    method: 'POST',
    body: form,
    timeoutMs: Math.min(timeoutMs, GROBID_REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`grobid ${res.status}: ${detail.slice(0, 500)}`);
  }
  return await res.text();
}

// ---------------------------------------------------------------------------
// TEI parsing
// ---------------------------------------------------------------------------

interface ParsedFigure {
  bbox: FigureBbox;
  caption: string | null;
  type: PaperFigureType;
}

interface CaptionedFigureBlock {
  captionBbox: FigureBbox;
  caption: string | null;
  type: PaperFigureType;
}

interface PdfTextBlock {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
  text: string;
}

interface PdfTextPage {
  page: number;
  width: number;
  height: number;
  blocks: PdfTextBlock[];
}

/**
 * Match `<figure>...</figure>` and `<table>...</table>` blocks at any
 * depth. GROBID emits these only inside `<body>` so we don't bother
 * scoping. The block contents are mined for the first usable
 * `coords="P,X,Y,W,H"` (preferring an inner `<graphic>` over the
 * element-level attribute, since the graphic bounds the *image*
 * whereas the element-level bbox includes the caption text).
 *
 * Exported for unit tests against fixture TEI.
 */
export function parseFigureBlocks(tei: string): ParsedFigure[] {
  const out: ParsedFigure[] = [];
  const blockRe =
    /<(figure|table)\b([^>]*)>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(tei)) !== null) {
    const tag = m[1];
    const attrs = m[2] ?? '';
    const body = m[3] ?? '';
    // Figures may carry type="table" — when the parent is <figure
    // type="table">, GROBID treats it as a table even though the tag
    // is <figure>. Honour the attribute.
    let type: PaperFigureType = tag === 'table' ? 'table' : 'figure';
    const typeAttr = /\btype="([^"]+)"/i.exec(attrs)?.[1];
    if (typeAttr === 'table') type = 'table';
    // Prefer <graphic coords> inside the element (tighter crop of
    // just the image), fall back to element-level coords.
    const graphicCoords = /<graphic\b[^>]*\bcoords="([^"]+)"/i.exec(body)?.[1];
    const elementCoords = /\bcoords="([^"]+)"/i.exec(attrs)?.[1];
    const coordsStr = graphicCoords ?? elementCoords;
    if (!coordsStr) continue;
    // GROBID may emit semicolon-separated coord groups for figures that
    // span multiple regions (e.g. a wide figure split across two text
    // columns). Take the first non-empty group.
    const firstGroup = coordsStr.split(';').find((g) => g.trim().length > 0);
    if (!firstGroup) continue;
    const bbox = parseCoords(firstGroup);
    if (!bbox) continue;

    // Caption: <figDesc> wins; fall back to <head>.
    const figDesc = innerTextOnce(body, /<figDesc\b[^>]*>([\s\S]*?)<\/figDesc>/i);
    const head = innerTextOnce(body, /<head\b[^>]*>([\s\S]*?)<\/head>/i);
    const caption = (figDesc ?? head ?? '').trim() || null;

    out.push({ bbox, caption, type });
  }
  return out;
}

async function inferCaptionAnchoredFigureCrops(
  pdfPath: string,
  tei: string,
): Promise<ParsedFigure[]> {
  const captionBlocks = parseCaptionedFigureBlocks(tei);
  if (captionBlocks.length === 0) return [];
  let pages: PdfTextPage[];
  try {
    pages = await readPdfTextLayout(pdfPath);
  } catch (e) {
    console.warn(
      '[figure-extractor] pdftotext layout failed:',
      (e as Error)?.message ?? e,
    );
    return [];
  }
  const byPage = new Map(pages.map((page) => [page.page, page]));
  const out: ParsedFigure[] = [];
  for (const block of captionBlocks) {
    const page = byPage.get(block.captionBbox.p);
    if (!page) continue;
    const bbox = inferGraphicBboxAboveCaption(page, block.captionBbox);
    if (!bbox) continue;
    out.push({ bbox, caption: block.caption, type: block.type });
  }
  return out;
}

function parseCaptionedFigureBlocks(tei: string): CaptionedFigureBlock[] {
  const out: CaptionedFigureBlock[] = [];
  const blockRe =
    /<(figure|table)\b([^>]*)>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(tei)) !== null) {
    const tag = m[1];
    const attrs = m[2] ?? '';
    const body = m[3] ?? '';
    let type: PaperFigureType = tag === 'table' ? 'table' : 'figure';
    const typeAttr = /\btype="([^"]+)"/i.exec(attrs)?.[1];
    if (typeAttr === 'table') type = 'table';

    const figDesc = innerTextOnce(body, /<figDesc\b[^>]*>([\s\S]*?)<\/figDesc>/i);
    const head = innerTextOnce(body, /<head\b[^>]*>([\s\S]*?)<\/head>/i);
    const label = innerTextOnce(body, /<label\b[^>]*>([\s\S]*?)<\/label>/i);
    if (!looksLikeRealFigureCaption(type, head, label, figDesc)) continue;

    const coordsStr = /\bcoords="([^"]+)"/i.exec(attrs)?.[1];
    if (!coordsStr) continue;
    const captionBbox = unionCoordGroups(coordsStr);
    if (!captionBbox) continue;
    out.push({
      captionBbox,
      caption: (figDesc ?? head ?? '').trim() || null,
      type,
    });
  }
  return out;
}

function looksLikeRealFigureCaption(
  type: PaperFigureType,
  head: string | null,
  label: string | null,
  figDesc: string | null,
): boolean {
  const text = `${head ?? ''} ${label ?? ''} ${figDesc ?? ''}`
    .replace(/\s+/g, ' ')
    .trim();
  if (type === 'table') return /\btable\s*[\dIVXLC]+[\s:.)-]/i.test(text);
  return /\bfig(?:ure)?\.?\s*[\dIVXLC]+[\s:.)-]/i.test(text);
}

function unionCoordGroups(coordsStr: string): FigureBbox | null {
  const groups = coordsStr
    .split(';')
    .map((group) => parseCoords(group))
    .filter((bbox): bbox is FigureBbox => bbox !== null);
  if (groups.length === 0) return null;
  const page = groups[0]!.p;
  const samePage = groups.filter((bbox) => bbox.p === page);
  if (samePage.length === 0) return null;
  const xMin = Math.min(...samePage.map((bbox) => bbox.x));
  const yMin = Math.min(...samePage.map((bbox) => bbox.y));
  const xMax = Math.max(...samePage.map((bbox) => bbox.x + bbox.w));
  const yMax = Math.max(...samePage.map((bbox) => bbox.y + bbox.h));
  return { p: page, x: xMin, y: yMin, w: xMax - xMin, h: yMax - yMin };
}

function inferGraphicBboxAboveCaption(
  page: PdfTextPage,
  captionBbox: FigureBbox,
): FigureBbox | null {
  const captionTop = captionBbox.y;
  const candidateBlocks = page.blocks
    .filter((block) => {
      if (block.yMax > captionTop - 2) return false;
      if (block.yMin < 24) return false;
      if (isPageFurnitureBlock(page, block)) return false;
      return true;
    })
    .sort((a, b) => b.yMax - a.yMax);

  const included: PdfTextBlock[] = [];
  let clusterTop = captionTop;
  for (const block of candidateBlocks) {
    const width = block.xMax - block.xMin;
    if (included.length === 0) {
      if (captionTop - block.yMax > 72) break;
      if (width > page.width * 0.72) continue;
    } else {
      const gap = clusterTop - block.yMax;
      if (gap > 55) break;
      if (block.xMin <= captionBbox.x + 8 && width > page.width * 0.48) break;
      if (width > page.width * 0.72) break;
    }
    included.push(block);
    clusterTop = Math.min(clusterTop, block.yMin);
    if (captionTop - clusterTop > page.height * 0.58) break;
  }
  if (included.length < 2) return null;

  const xMin = Math.min(...included.map((block) => block.xMin));
  const yMin = Math.min(...included.map((block) => block.yMin));
  const xMax = Math.max(...included.map((block) => block.xMax));
  const yMax = Math.max(...included.map((block) => block.yMax));
  if (xMax - xMin < 48 || yMax - yMin < 24) return null;

  const xPad = Math.min(42, page.width * 0.07);
  const x = clamp(xMin - xPad, 0, page.width - 1);
  const y = clamp(yMin - 18, 0, page.height - 1);
  const right = clamp(xMax + xPad, x + 1, page.width);
  const bottom = clamp(Math.min(yMax + 16, captionTop - 4), y + 1, page.height);
  return {
    p: captionBbox.p,
    x,
    y,
    w: right - x,
    h: bottom - y,
  };
}

function isPageFurnitureBlock(page: PdfTextPage, block: PdfTextBlock): boolean {
  const width = block.xMax - block.xMin;
  const height = block.yMax - block.yMin;
  if (block.xMax < page.width * 0.08 || block.xMin > page.width * 0.92) return true;
  return width < 18 && height > 48;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function readPdfTextLayout(pdfPath: string): Promise<PdfTextPage[]> {
  const outPath = `${pdfPath}-bbox-layout.html`;
  await runPdfToText(['-bbox-layout', pdfPath, outPath]);
  const html = await readFile(outPath, 'utf8');
  return parsePdfTextLayout(html);
}

function parsePdfTextLayout(html: string): PdfTextPage[] {
  const pages: PdfTextPage[] = [];
  const pageRe = /<page\b([^>]*)>([\s\S]*?)<\/page>/gi;
  let pageMatch: RegExpExecArray | null;
  while ((pageMatch = pageRe.exec(html)) !== null) {
    const attrs = pageMatch[1] ?? '';
    const body = pageMatch[2] ?? '';
    const width = getNumericXmlAttr(attrs, 'width');
    const height = getNumericXmlAttr(attrs, 'height');
    if (width === null || height === null) continue;
    const blocks: PdfTextBlock[] = [];
    const blockRe = /<block\b([^>]*)>([\s\S]*?)<\/block>/gi;
    let blockMatch: RegExpExecArray | null;
    while ((blockMatch = blockRe.exec(body)) !== null) {
      const blockAttrs = blockMatch[1] ?? '';
      const blockBody = blockMatch[2] ?? '';
      const xMin = getNumericXmlAttr(blockAttrs, 'xMin');
      const yMin = getNumericXmlAttr(blockAttrs, 'yMin');
      const xMax = getNumericXmlAttr(blockAttrs, 'xMax');
      const yMax = getNumericXmlAttr(blockAttrs, 'yMax');
      if (xMin === null || yMin === null || xMax === null || yMax === null) continue;
      const text = innerText(blockBody);
      if (!text) continue;
      blocks.push({ xMin, yMin, xMax, yMax, text });
    }
    pages.push({ page: pages.length + 1, width, height, blocks });
  }
  return pages;
}

function getNumericXmlAttr(attrs: string, name: string): number | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*"([^"]+)"`, 'i').exec(attrs);
  if (!match?.[1]) return null;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : null;
}

function innerText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCoords(s: string): FigureBbox | null {
  const parts = s.split(',').map((p) => Number(p.trim()));
  if (parts.length < 5 || parts.some((n) => !Number.isFinite(n))) return null;
  const [p, x, y, w, h] = parts as [number, number, number, number, number];
  if (p < 1 || w <= 0 || h <= 0 || x < 0 || y < 0) return null;
  return { p: Math.floor(p), x, y, w, h };
}

function innerTextOnce(haystack: string, re: RegExp): string | null {
  const m = re.exec(haystack);
  if (!m) return null;
  return (m[1] ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// pdftocairo crop
// ---------------------------------------------------------------------------

/**
 * Crop a PDF region to PNG using pdftocairo. PDF points → pixels at
 * the requested DPI is `pts * dpi / 72`. pdftocairo's `-x/-y/-W/-H`
 * flags accept pixels at the rendered resolution, top-left origin —
 * which matches GROBID's coordinate convention, so no axis flip.
 *
 * The output naming with `-singlefile` writes `${prefix}.png` (no
 * page suffix). We let pdftocairo manage the rasterisation and read
 * back the result rather than holding it on stdout.
 */
async function cropToPng(pdfPath: string, bbox: FigureBbox, dpi: number): Promise<Buffer> {
  const scale = dpi / 72;
  const x = Math.max(0, Math.round(bbox.x * scale));
  const y = Math.max(0, Math.round(bbox.y * scale));
  const w = Math.max(1, Math.round(bbox.w * scale));
  const h = Math.max(1, Math.round(bbox.h * scale));
  // Output to a sibling file. Caller already provides a tmp dir.
  const outPrefix = `${pdfPath}-p${bbox.p}-${x}-${y}-${w}-${h}`;
  await runPdfToCairo([
    '-png',
    '-r',
    String(dpi),
    '-f',
    String(bbox.p),
    '-l',
    String(bbox.p),
    '-x',
    String(x),
    '-y',
    String(y),
    '-W',
    String(w),
    '-H',
    String(h),
    '-singlefile',
    pdfPath,
    outPrefix,
  ]);
  return await readFile(`${outPrefix}.png`);
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

function runPdfToText(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('pdftotext', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 8192) stderr = stderr.slice(-8192);
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pdftotext exit ${code}: ${stderr.trim()}`));
    });
  });
}

// Internal test surface.
export const __testing = {
  parseFigureBlocks,
  parseCaptionedFigureBlocks,
  parsePdfTextLayout,
  inferGraphicBboxAboveCaption,
  parseCoords,
};
