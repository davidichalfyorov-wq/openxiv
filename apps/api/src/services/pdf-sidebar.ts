import { PDFDocument, StandardFonts, degrees, rgb, type PDFPage } from 'pdf-lib';

/**
 * Stamp the left-edge OpenXiv branding sidebar onto every page of the
 * source PDF.
 *
 * Layout per page:
 *   - Rotated text -90°, anchored on the left margin (x ≈ 18 pt).
 *   - Vertically centred on the page height.
 *   - Font: Helvetica 9pt, hex #555 grey so it does not compete with
 *     the page content. ArXiv uses a similar treatment for `arXiv:....`.
 *
 * The text reads:
 *   "openxiv:{id}v{version} [{primary_category}] {YYYY-MM-DD}"
 *
 * Detection guard: if the source PDF already carries rotated text in
 * the left-edge zone (typical of an uploaded arXiv submission), we
 * leave it alone — the author's preference wins and we don't want a
 * double-strip. The detection is a coarse heuristic; it produces false
 * positives on academic templates that put rotated content there too,
 * but a no-op is the safe failure mode.
 */

export interface SidebarInput {
  /** "openxiv:cs.AI.2026.00001" (no "openxiv:" prefix is also accepted). */
  openxivId: string;
  version: number;
  primaryCategory: string;
  /** ISO-8601 date or timestamp. */
  postedAt: string;
}

export interface SidebarOutput {
  buffer: Buffer;
  /** True iff at least one page actually received a sidebar. */
  stamped: boolean;
  /** Pages where stamping was skipped because rotated content was detected. */
  skippedPages: number[];
}

/**
 * Stamps the sidebar on every page of `pdfBuffer`. Returns a brand-new
 * buffer; the input is not mutated.
 */
export async function stampLeftSidebar(
  pdfBuffer: Buffer | Uint8Array,
  input: SidebarInput,
): Promise<SidebarOutput> {
  const pdf = await PDFDocument.load(pdfBuffer, { updateMetadata: false });
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  const date = input.postedAt.slice(0, 10);
  const idPrefix = input.openxivId.startsWith('openxiv:')
    ? input.openxivId
    : `openxiv:${input.openxivId}`;
  const stamp = `${idPrefix}v${input.version} [${input.primaryCategory}] ${date}`;

  const pages = pdf.getPages();
  const skippedPages: number[] = [];
  let stamped = false;
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!;
    // Detection: bail if there's already a sidebar-shaped chunk of text
    // in the left strip. pdf-lib's API exposes neither text extraction
    // nor a low-level content-stream peek, so the heuristic is "is the
    // page substantially shorter on the left edge than expected" — which
    // we can't reliably compute either. We therefore skip detection in
    // v1 and rely on the convention that authors uploading arXiv-stamped
    // PDFs accept the OpenXiv strip overlapping. The hook is exposed so
    // a later iteration can wire it without changing the call surface.
    if (await detectExistingSidebar(page)) {
      skippedPages.push(i);
      continue;
    }
    const { width, height } = page.getSize();
    // Anchor: rotated -90° so the text reads bottom-to-top. We position
    // the *origin* of the rotated text such that the string spans the
    // vertical centre of the page.
    const stampWidth = font.widthOfTextAtSize(stamp, 9);
    const yOrigin = (height + stampWidth) / 2;
    page.drawText(stamp, {
      x: 18,
      y: yOrigin,
      size: 9,
      font,
      color: rgb(0.34, 0.34, 0.34),
      rotate: degrees(-90),
    });
    // A vanishingly-faint vertical separator just to the right of the
    // stamp; helps the eye see "this is an OpenXiv strip" without
    // hijacking the page content.
    page.drawLine({
      start: { x: 36, y: 32 },
      end: { x: 36, y: height - 32 },
      thickness: 0.25,
      color: rgb(0.84, 0.84, 0.86),
      opacity: 0.6,
    });
    void width;
    stamped = true;
  }

  const bytes = await pdf.save();
  return { buffer: Buffer.from(bytes), stamped, skippedPages };
}

/**
 * Heuristic sidebar detector. Today it returns `false` for every page
 * (no detection performed). A future iteration can read the page's
 * content stream and look for rotated text in the left 36pt strip.
 *
 * Keeping the signature async + Promise<boolean> lets that iteration
 * land without touching call sites. Exported for tests.
 */
export async function detectExistingSidebar(_page: PDFPage): Promise<boolean> {
  return false;
}

export interface MergeMetadataInjection {
  /**
   * Canonical OpenXiv id (e.g. `openxiv:cs.AI.2026.00001`). Embedded in
   * the merged PDF's XMP `/Keywords` and re-affirmed in `/Subject` so
   * a downstream scraper that reads `pdf.getKeywords()` or
   * `pdf.getSubject()` recovers the binding back to the database row
   * even after the body's own metadata wins on title / author.
   */
  openxivId: string;
}

/**
 * Merge a cover page with a sidebar-stamped body. Returns a single PDF
 * whose first page is the cover and whose subsequent pages are the
 * body.
 *
 * Metadata policy:
 *   - **Title / Author**: body wins (Tectonic-generated PDFs carry the
 *     paper's real title from `\title{…}` and author list — those are
 *     more accurate than whatever the cover page sets).
 *   - **Subject**: cover wins by default (it carries the canonical
 *     "OpenXiv preprint — {openxivId}" string). Falls back to body's
 *     Subject only when the cover supplied none.
 *   - **Keywords**: union of cover's keywords and body's keywords PLUS
 *     the explicit `openxivId` marker — so the published PDF always
 *     carries `[primaryCategory, …crossListings, issn:3120-9556,
 *     openxiv:<id>]` regardless of what Tectonic emitted.
 *   - **ModificationDate**: cover wins (its mod date == postedAt; gives
 *     deterministic blob hashes on idempotent re-runs).
 *
 * A round-trip check (`getKeywords().includes('openxiv:<id>')`) becomes
 * the canonical "is this PDF an OpenXiv preprint" test.
 */
export async function mergeCoverAndBody(
  coverPdf: Buffer | Uint8Array,
  bodyPdf: Buffer | Uint8Array,
  meta?: MergeMetadataInjection,
): Promise<Buffer> {
  const cover = await PDFDocument.load(coverPdf, { updateMetadata: false });
  const body = await PDFDocument.load(bodyPdf, { updateMetadata: false });
  const out = await PDFDocument.create();
  // Copy cover pages first (typically 1).
  const coverPages = await out.copyPages(cover, cover.getPageIndices());
  for (const p of coverPages) out.addPage(p);
  // Then body pages in order.
  const bodyPages = await out.copyPages(body, body.getPageIndices());
  for (const p of bodyPages) out.addPage(p);
  // Title / Author: body wins.
  const bodyTitle = body.getTitle();
  if (bodyTitle) out.setTitle(bodyTitle);
  const bodyAuthor = body.getAuthor();
  if (bodyAuthor) out.setAuthor(bodyAuthor);
  // Subject: cover wins (carries "OpenXiv preprint — {openxivId}").
  const coverSubject = cover.getSubject();
  const bodySubject = body.getSubject();
  if (coverSubject) out.setSubject(coverSubject);
  else if (bodySubject) out.setSubject(bodySubject);
  // Keywords: union of both PDFs + explicit openxivId marker.
  const coverKws = (cover.getKeywords() ?? '')
    .split(/[,;]\s*|\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const bodyKws = (body.getKeywords() ?? '')
    .split(/[,;]\s*|\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const merged = new Set<string>();
  for (const k of coverKws) merged.add(k);
  for (const k of bodyKws) merged.add(k);
  if (meta?.openxivId) {
    // Normalise to the `openxiv:<id>` shape so the round-trip parser
    // can detect the marker without having to know the exact id ahead
    // of time. Accepts both bare id and prefixed forms.
    const tagged = meta.openxivId.startsWith('openxiv:')
      ? meta.openxivId
      : `openxiv:${meta.openxivId}`;
    merged.add(tagged);
  }
  if (merged.size > 0) out.setKeywords([...merged]);
  // Pin deterministic mod date to the cover's (which == postedAt).
  const coverMod = cover.getModificationDate();
  if (coverMod) out.setModificationDate(coverMod);

  const bytes = await out.save();
  return Buffer.from(bytes);
}

/**
 * Round-trip check: parse the merged PDF's keywords and return the
 * embedded OpenXiv id if present. Used by tests + future scrapers as
 * the canonical "is this OpenXiv?" probe.
 */
export async function extractOpenxivIdFromPdf(pdfBytes: Buffer | Uint8Array): Promise<string | null> {
  const pdf = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const kw = pdf.getKeywords();
  if (!kw) return null;
  const found = kw
    .split(/[,;]\s*|\s+/)
    .map((s) => s.trim())
    .find((s) => /^openxiv:/.test(s));
  return found ?? null;
}

export const __testing = { mergeCoverAndBody };
