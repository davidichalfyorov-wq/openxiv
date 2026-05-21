import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import QRCode from 'qrcode';
import { OPENXIV_ISSN } from '@openxiv/shared';

/**
 * Pre-rasterised brand logo (PNG, 1508 px wide, alpha-channel transparent
 * background). Read once at module init; pdf-lib re-encodes per document
 * but the source bytes are stable so we don't pay disk I/O per cover.
 *
 * Source: apps/web/public/brand/logo-full.svg, rendered by
 * `scripts/rasterize-brand.ts` (commit when the SVG changes).
 */
const LOGO_PNG_BYTES = readFileSync(
  resolve(import.meta.dirname, 'brand', 'logo-full.png'),
);

/**
 * Generate the OpenXiv cover page for a paper.
 *
 * The cover is prepended to the original PDF by `pdf-finalize`. It is a
 * single A4 portrait page (595 × 842 pt) carrying the bibliographic
 * record + a QR code that resolves to the canonical abs URL.
 *
 * Design constraints:
 *   - Pure pdf-lib (no Chromium/Puppeteer). Generation runs inside a
 *     BullMQ worker on the API container; spawning a browser per job
 *     would blow the memory budget.
 *   - Idempotent. Same input → same byte output. The finalize worker
 *     uses this property to skip re-uploads when nothing has changed.
 *   - Fonts are pdf-lib's built-in StandardFonts (Times-Roman /
 *     Helvetica). Embedding a custom serif would double the cover blob
 *     size for negligible aesthetic gain.
 *   - DOI missing → cell shows the openxiv:{id} identifier + footnote
 *     "DOI deposited later". Never invents a DOI; the suffix policy is
 *     opaque so we can't synthesise one from the title.
 */

export interface CoverInput {
  /** Stable id of the form `openxiv:{subject}.{YYYY}.{NNNNN}`. */
  openxivId: string;
  /** Resolves to https://openxiv.net/abs/{openxivUrlId}. */
  openxivUrlId: string;
  title: string;
  abstract: string | null;
  authors: ReadonlyArray<{
    displayName: string;
    affiliation?: string | null;
    orcid?: string | null;
  }>;
  primaryCategory: string;
  crossListings: ReadonlyArray<string>;
  license: string;
  version: number;
  /** Publication moment as ISO-8601. */
  postedAt: string;
  /**
   * Canonical DOI (`10.X/openxiv.{openxiv_id}`) or `null` when deposit
   * hasn't happened. Renders the "DOI deposited later" footnote when null.
   */
  doi: string | null;
  /**
   * Disclosure tier as recorded on the AT-proto disclosure record. The
   * cover surfaces it prominently so a reader doesn't have to dig into
   * the abs page for the AI-use posture.
   */
  disclosureLevel: 'none' | 'assistant' | 'coauthor' | 'primary' | null;
  /**
   * Snapshot cover evidence. The PDF cover is immutable once generated, so
   * it carries the lane states known at finalize time. The live abstract
   * page remains authoritative when the evidence changes later.
   */
  trust: {
    transparency: TrustLaneState;
    identity: TrustLaneState;
    provenance: TrustLaneState;
    citations: TrustLaneState;
    math: TrustLaneState;
    integrity: TrustLaneState;
  } | null;
  /** Public web base, e.g. https://openxiv.net. */
  publicBase: string;
}

export type TrustLaneState = 'strong' | 'partial' | 'absent' | 'pending';

export interface CoverOutput {
  /** Single A4 page as a standalone PDF, ready to merge with the source. */
  buffer: Buffer;
  /** SHA-256 of the cover bytes; cached to short-circuit re-runs. */
  contentHash: string;
}

// pdf-lib units are PostScript points: 72 per inch. A4 = 595 × 842 pt.
const A4 = { width: 595.276, height: 841.89 };
const MARGIN = { x: 48, y: 56 };
const COL = {
  innerLeft: MARGIN.x,
  innerRight: A4.width - MARGIN.x,
  contentWidth: A4.width - MARGIN.x * 2,
};

/**
 * Editorial Brutalist palette. Single accent (deep teal) anchors the
 * masthead band and primary citation chip; warning amber surfaces the
 * preprint disclaimer; everything else lives in neutral text greys so
 * the title and authors have all the visual weight.
 */
const COLOR = {
  text: rgb(0.07, 0.07, 0.075),
  muted: rgb(0.36, 0.36, 0.42),
  accent: rgb(0.0, 0.41, 0.79),
  border: rgb(0.84, 0.84, 0.86),
  warn: rgb(0.78, 0.36, 0.0),
  mastheadBg: rgb(0.08, 0.075, 0.075),
  mastheadFg: rgb(0.98, 0.98, 0.97),
  warnChip: rgb(0.91, 0.64, 0.24),
  warnChipText: rgb(0.15, 0.09, 0.02),
  trustStrong: rgb(0.86, 0.94, 0.86),
  trustPartial: rgb(0.99, 0.92, 0.78),
  trustAbsent: rgb(0.94, 0.94, 0.95),
  trustPending: rgb(0.86, 0.92, 0.98),
  orcid: rgb(0.65, 0.81, 0.22),
};

const MASTHEAD_HEIGHT = 68;
const FOOTER_BAND_HEIGHT = 22;

export async function generateCoverPdf(input: CoverInput): Promise<CoverOutput> {
  const pdf = await PDFDocument.create();
  // Deterministic metadata: producer string drives identity; creationDate
  // is set from `postedAt` so two runs against the same paper produce
  // byte-identical output.
  pdf.setTitle(input.title);
  pdf.setAuthor(input.authors.map((a) => a.displayName).join('; '));
  pdf.setSubject(`OpenXiv preprint — ${input.openxivId}`);
  pdf.setKeywords([
    input.primaryCategory,
    ...input.crossListings,
    `issn:${OPENXIV_ISSN}`,
    `trust-passport:${passportUrl(input)}`,
  ]);
  pdf.setProducer('OpenXiv pdf-cover');
  pdf.setCreator('OpenXiv');
  const postedDate = new Date(input.postedAt);
  pdf.setCreationDate(postedDate);
  pdf.setModificationDate(postedDate);

  const page = pdf.addPage([A4.width, A4.height]);
  const fontRegular = await pdf.embedFont(StandardFonts.TimesRoman);
  const fontBold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const fontSans = await pdf.embedFont(StandardFonts.Helvetica);
  const fontSansBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logoImage = await pdf.embedPng(LOGO_PNG_BYTES);

  // Editorial Brutalist layout: full-bleed dark masthead, generous body
  // whitespace, full-bleed footer band. Body sections track a single
  // descending cursor; bands are absolutely positioned.

  drawMasthead(page, input, logoImage, fontSansBold);

  let y = A4.height - MASTHEAD_HEIGHT - 28;

  // 1. Categories + version line (right-aligned), establishes the
  //    citation context before the title.
  drawCategoryLine(page, y, input, fontSans, fontSansBold);
  y -= 26;

  // 2. Title — the only visually heavy block; everything below is
  //    metadata that supports the citation surface.
  y = drawTitle(page, y, input.title, fontBold);

  // 3. Authors with ORCID dots + affiliations.
  y -= 22;
  y = drawAuthors(page, y, input.authors, fontRegular, fontSans, fontSansBold);

  // 4. Metadata panel — boxed, hairline border.
  y -= 26;
  y = drawMetadataPanel(page, y, input, fontSans, fontSansBold);

  // 5. Disclosure + static evidence chips on a single row group.
  y -= 18;
  y = drawTrustRow(page, y, input, fontSans, fontSansBold);

  // 6. Footer: canonical URL, citation hint, QR. Then the dark bottom band.
  await drawFooter(pdf, page, input, fontSans, fontSansBold);

  const bytes = await pdf.save();
  const buffer = Buffer.from(bytes);
  // Hash for idempotency. SHA-256 is overkill but cheap; we can compare
  // by string equality.
  const crypto = await import('node:crypto');
  const contentHash = crypto.createHash('sha256').update(buffer).digest('hex');
  return { buffer, contentHash };
}

// ---------------------------------------------------------------------------
// Section renderers. Each returns the new `y` after drawing (the cursor).
// ---------------------------------------------------------------------------

/**
 * Full-bleed dark masthead band carrying brand logo + the loud
 * NOT PEER-REVIEWED warning chip. This is the visual anchor of the
 * cover; everything below reads as supporting metadata.
 */
function drawMasthead(
  page: PDFPage,
  input: CoverInput,
  logo: PDFImage,
  fontSansBold: PDFFont,
): void {
  const top = A4.height;
  const bandY = top - MASTHEAD_HEIGHT;
  page.drawRectangle({
    x: 0,
    y: bandY,
    width: A4.width,
    height: MASTHEAD_HEIGHT,
    color: COLOR.mastheadBg,
  });

  // Logo, vertically centered. Scale to 40pt height, keep aspect ratio.
  const logoH = 40;
  const logoW = (logo.width / logo.height) * logoH;
  page.drawImage(logo, {
    x: MARGIN.x,
    y: bandY + (MASTHEAD_HEIGHT - logoH) / 2,
    width: logoW,
    height: logoH,
  });

  // Right side: NOT PEER-REVIEWED warning chip. Amber pill, vertically
  // centered. Two-tier label so a glance gives the document type, a
  // closer look gives the verification status.
  const chipPad = 10;
  const chipText = 'PREPRINT · NOT PEER-REVIEWED';
  const chipFontSize = 9;
  const chipTextWidth = fontSansBold.widthOfTextAtSize(chipText, chipFontSize);
  const chipW = chipTextWidth + chipPad * 2;
  const chipH = 22;
  const chipX = A4.width - MARGIN.x - chipW;
  const chipY = bandY + (MASTHEAD_HEIGHT - chipH) / 2;
  page.drawRectangle({
    x: chipX,
    y: chipY,
    width: chipW,
    height: chipH,
    color: COLOR.warnChip,
  });
  page.drawText(chipText, {
    x: chipX + chipPad,
    y: chipY + 7,
    size: chipFontSize,
    font: fontSansBold,
    color: COLOR.warnChipText,
  });
}

/**
 * Right-aligned line above the title: subject codes, version, and the
 * openxiv id rendered as a monospace-ish citation key. Establishes the
 * citation context before the eye reaches the title.
 */
function drawCategoryLine(
  page: PDFPage,
  y: number,
  input: CoverInput,
  fontSans: PDFFont,
  fontSansBold: PDFFont,
): void {
  const cats = [input.primaryCategory, ...input.crossListings].join(' · ');
  const leftText = cats;
  const rightText = `v${input.version} · ${input.openxivId}`;

  page.drawText(leftText, {
    x: MARGIN.x,
    y,
    size: 10,
    font: fontSansBold,
    color: COLOR.accent,
  });
  const rw = fontSans.widthOfTextAtSize(rightText, 10);
  page.drawText(rightText, {
    x: COL.innerRight - rw,
    y,
    size: 10,
    font: fontSans,
    color: COLOR.muted,
  });
  // Hairline under the row.
  page.drawLine({
    start: { x: MARGIN.x, y: y - 6 },
    end: { x: COL.innerRight, y: y - 6 },
    thickness: 0.5,
    color: COLOR.border,
  });
}

function drawTitle(page: PDFPage, y: number, title: string, font: PDFFont): number {
  const lines = wrap(title, 26, font, COL.contentWidth);
  let cursor = y;
  for (const line of lines.slice(0, 4)) {
    cursor -= 30;
    page.drawText(line, { x: MARGIN.x, y: cursor, size: 26, font, color: COLOR.text });
  }
  return cursor;
}

function drawAuthors(
  page: PDFPage,
  y: number,
  authors: CoverInput['authors'],
  fontRegular: PDFFont,
  fontSans: PDFFont,
  fontSansBold: PDFFont,
): number {
  // Authors as a wrapped line. ORCID iD appears as a small green disc
  // before each name when set — recognisable signal without text noise.
  let cursor = y;
  const dotSize = 6;
  const lineHeight = 15;
  let x = MARGIN.x;
  for (const author of authors.slice(0, 16)) {
    if (author.orcid) {
      page.drawCircle({
        x: x + dotSize / 2,
        y: cursor + 4,
        size: dotSize / 2,
        color: COLOR.orcid,
      });
      x += dotSize + 4;
    }
    const name = author.displayName;
    const nameW = fontSansBold.widthOfTextAtSize(name, 12);
    if (x + nameW > COL.innerRight) {
      cursor -= lineHeight;
      x = MARGIN.x;
      if (author.orcid) {
        page.drawCircle({
          x: x + dotSize / 2,
          y: cursor + 4,
          size: dotSize / 2,
          color: COLOR.orcid,
        });
        x += dotSize + 4;
      }
    }
    page.drawText(name, {
      x,
      y: cursor,
      size: 12,
      font: fontSansBold,
      color: COLOR.text,
    });
    x += nameW;
    page.drawText('  ·  ', {
      x,
      y: cursor,
      size: 12,
      font: fontSans,
      color: COLOR.muted,
    });
    x += fontSans.widthOfTextAtSize('  ·  ', 12);
  }

  // Affiliations on the line below (first 4 unique).
  const affs = Array.from(
    new Set(authors.map((a) => a.affiliation).filter(Boolean) as string[]),
  ).slice(0, 4);
  if (affs.length > 0) {
    cursor -= 16;
    page.drawText(affs.join(' · '), {
      x: MARGIN.x,
      y: cursor,
      size: 10,
      font: fontSans,
      color: COLOR.muted,
    });
  }
  return cursor;
}

/**
 * Boxed metadata panel. Hairline border + tiny-caps labels in the left
 * column, regular values on the right. Two columns so the panel doesn't
 * dominate vertical space.
 */
function drawMetadataPanel(
  page: PDFPage,
  y: number,
  input: CoverInput,
  fontSans: PDFFont,
  fontSansBold: PDFFont,
): number {
  // Build column rows. DOI gets pride of place; if pending, we surface
  // the openxiv id as the citation key with the warn tone, never invent
  // a synthetic DOI string.
  const leftRows: Array<{ label: string; value: string; tone?: 'warn' | 'accent' }> = [
    input.doi
      ? { label: 'DOI', value: input.doi, tone: 'accent' }
      : { label: 'Cite as', value: input.openxivId, tone: 'warn' },
    { label: 'ISSN', value: `${OPENXIV_ISSN} (online)` },
    { label: 'License', value: input.license },
  ];
  const rightRows: Array<{ label: string; value: string }> = [
    { label: 'Posted', value: input.postedAt.slice(0, 10) },
    { label: 'Version', value: `v${input.version}` },
    {
      label: 'Subject',
      value:
        input.crossListings.length === 0
          ? input.primaryCategory
          : `${input.primaryCategory} (+${input.crossListings.length} cross-listed)`,
    },
  ];

  const rowH = 18;
  const colW = (COL.contentWidth - 24) / 2;
  const panelH = rowH * Math.max(leftRows.length, rightRows.length) + 16;
  const panelTop = y;
  const panelBottom = y - panelH;

  page.drawRectangle({
    x: MARGIN.x,
    y: panelBottom,
    width: COL.contentWidth,
    height: panelH,
    borderColor: COLOR.border,
    borderWidth: 0.6,
  });

  const drawCol = (rows: typeof leftRows, x: number): void => {
    let cy = panelTop - 12;
    for (const row of rows) {
      page.drawText(row.label.toUpperCase(), {
        x,
        y: cy,
        size: 7,
        font: fontSansBold,
        color: COLOR.muted,
      });
      const valColor =
        row.tone === 'warn'
          ? COLOR.warn
          : row.tone === 'accent'
            ? COLOR.accent
            : COLOR.text;
      page.drawText(row.value, {
        x,
        y: cy - 10,
        size: 10,
        font: fontSans,
        color: valColor,
      });
      cy -= rowH;
    }
  };
  drawCol(leftRows, MARGIN.x + 14);
  drawCol(rightRows, MARGIN.x + 14 + colW + 12);

  return panelBottom;
}

/**
 * AI disclosure plus the cover evidence chips requested for the static PDF.
 * Social review remains live-only because it can change after publication.
 */
function drawTrustRow(
  page: PDFPage,
  y: number,
  input: CoverInput,
  fontSans: PDFFont,
  fontSansBold: PDFFont,
): number {
  let cursor = y;
  // Disclosure label, left-aligned.
  page.drawText('AI DISCLOSURE', {
    x: MARGIN.x,
    y: cursor,
    size: 7,
    font: fontSansBold,
    color: COLOR.muted,
  });
  const disclosureValue = input.disclosureLevel
    ? input.disclosureLevel.toUpperCase()
    : 'NOT RECORDED';
  page.drawText(disclosureValue, {
    x: MARGIN.x,
    y: cursor - 12,
    size: 11,
    font: fontSansBold,
    color: input.disclosureLevel ? COLOR.text : COLOR.warn,
  });
  cursor -= 26;

  if (input.trust) {
    page.drawText('COVER EVIDENCE', {
      x: MARGIN.x,
      y: cursor,
      size: 7,
      font: fontSansBold,
      color: COLOR.muted,
    });
    cursor -= 14;
    const lanes: Array<[string, TrustLaneState]> = [
      ['transparency', input.trust.transparency],
      ['identity', input.trust.identity],
      ['provenance', input.trust.provenance],
      ['citations', input.trust.citations],
      ['math', input.trust.math],
      ['integrity', input.trust.integrity],
    ];
    let chipX = MARGIN.x;
    let chipY = cursor;
    for (const [label, state] of lanes) {
      const chipText = `${label.toUpperCase()} · ${state}`;
      const tw = fontSansBold.widthOfTextAtSize(chipText, 8);
      const cw = tw + 14;
      const ch = 18;
      if (chipX > MARGIN.x && chipX + cw > COL.innerRight) {
        chipX = MARGIN.x;
        chipY -= 22;
      }
      const bg =
        state === 'strong'
          ? COLOR.trustStrong
          : state === 'partial'
            ? COLOR.trustPartial
            : state === 'pending'
              ? COLOR.trustPending
              : COLOR.trustAbsent;
      page.drawRectangle({
        x: chipX,
        y: chipY - 6,
        width: cw,
        height: ch,
        color: bg,
        borderColor: COLOR.border,
        borderWidth: 0.4,
      });
      page.drawText(chipText, {
        x: chipX + 7,
        y: chipY,
        size: 8,
        font: fontSansBold,
        color: COLOR.text,
      });
      chipX += cw + 6;
    }
    cursor = chipY - 22;
  }
  return cursor;
}

function passportUrl(input: CoverInput): string {
  return `${input.publicBase.replace(/\/+$/, '')}/abs/${input.openxivUrlId}/passport`;
}

async function drawFooter(
  pdf: PDFDocument,
  page: PDFPage,
  input: CoverInput,
  fontSans: PDFFont,
  fontSansBold: PDFFont,
): Promise<void> {
  const canonical = `${input.publicBase}/abs/${input.openxivUrlId}`;
  // 1. Dark footer band, full-bleed.
  page.drawRectangle({
    x: 0,
    y: 0,
    width: A4.width,
    height: FOOTER_BAND_HEIGHT,
    color: COLOR.mastheadBg,
  });
  const bandText = `OpenXiv · ISSN ${OPENXIV_ISSN} · ${input.publicBase.replace(/^https?:\/\//, '')}`;
  page.drawText(bandText, {
    x: MARGIN.x,
    y: 7,
    size: 8,
    font: fontSansBold,
    color: COLOR.mastheadFg,
  });
  const rightText = 'Cover page · auto-generated';
  const rtw = fontSans.widthOfTextAtSize(rightText, 8);
  page.drawText(rightText, {
    x: A4.width - MARGIN.x - rtw,
    y: 7,
    size: 8,
    font: fontSans,
    color: COLOR.mastheadFg,
  });

  // 2. QR code in bottom-right (just above the footer band).
  const qrSize = 72;
  const qrPng = await QRCode.toBuffer(canonical, {
    margin: 0,
    width: qrSize * 4,
    color: { dark: '#141313', light: '#ffffff' },
    errorCorrectionLevel: 'M',
  });
  const qrImg = await pdf.embedPng(qrPng);
  const qrX = COL.innerRight - qrSize;
  const qrY = FOOTER_BAND_HEIGHT + 12;
  page.drawImage(qrImg, { x: qrX, y: qrY, width: qrSize, height: qrSize });

  // QR caption underneath, scan-instruction.
  page.drawText('scan to open', {
    x: qrX + (qrSize - fontSans.widthOfTextAtSize('scan to open', 8)) / 2,
    y: qrY - 10,
    size: 8,
    font: fontSans,
    color: COLOR.muted,
  });

  // 3. Canonical URL block, left side of the QR.
  const blockY = qrY + qrSize - 12;
  page.drawText('CANONICAL RECORD', {
    x: MARGIN.x,
    y: blockY,
    size: 7,
    font: fontSansBold,
    color: COLOR.muted,
  });
  page.drawText(canonical, {
    x: MARGIN.x,
    y: blockY - 14,
    size: 11,
    font: fontSansBold,
    color: COLOR.accent,
  });
  page.drawText(`Cite as: ${input.openxivId}`, {
    x: MARGIN.x,
    y: blockY - 30,
    size: 9,
    font: fontSans,
    color: COLOR.text,
  });
  page.drawText('Live verification record is maintained on the canonical abstract page.', {
    x: MARGIN.x,
    y: blockY - 44,
    size: 8,
    font: fontSansBold,
    color: COLOR.text,
  });
  if (input.doi === null) {
    page.drawText(
      'DOI will be deposited and back-filled once Crossref membership clears.',
      {
        x: MARGIN.x,
        y: blockY - 58,
        size: 8,
        font: fontSans,
        color: COLOR.muted,
      },
    );
  }
}

/**
 * Wrap a string into lines whose rendered width at `size` ≤ `maxWidth`.
 * Greedy by word; if a single word is wider than `maxWidth` it is
 * left as its own line (pdf-lib will draw it past the margin but the
 * margin is generous enough that this only happens for pathological
 * input like a no-space URL).
 *
 * Exported for tests.
 */
export function wrap(text: string, size: number, font: PDFFont, maxWidth: number): string[] {
  const words = text.replace(/\s+/g, ' ').split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const tentative = current ? `${current} ${word}` : word;
    const width = font.widthOfTextAtSize(tentative, size);
    if (width <= maxWidth) {
      current = tentative;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export const __testing = { A4, MARGIN, COL };
