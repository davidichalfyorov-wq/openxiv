import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  stampLeftSidebar,
  mergeCoverAndBody,
  detectExistingSidebar,
  extractOpenxivIdFromPdf,
} from './pdf-sidebar.js';

async function makeBlankPdf(pages: number): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pages; i++) pdf.addPage([595.276, 841.89]);
  return Buffer.from(await pdf.save());
}

describe('stampLeftSidebar', () => {
  it('preserves page count', async () => {
    const input = await makeBlankPdf(3);
    const inputPdf = await PDFDocument.load(input);
    expect(inputPdf.getPageCount()).toBe(3);
    const out = await stampLeftSidebar(input, {
      openxivId: 'openxiv:cs.AI.2026.00001',
      version: 1,
      primaryCategory: 'cs.AI',
      postedAt: '2026-05-18T00:00:00Z',
    });
    expect(out.stamped).toBe(true);
    const outPdf = await PDFDocument.load(out.buffer);
    expect(outPdf.getPageCount()).toBe(3);
  });

  it('returns the buffer larger than input (added text)', async () => {
    const input = await makeBlankPdf(1);
    const out = await stampLeftSidebar(input, {
      openxivId: 'cs.AI.2026.00001',
      version: 2,
      primaryCategory: 'cs.LG',
      postedAt: '2026-05-18',
    });
    expect(out.buffer.length).toBeGreaterThan(input.length);
  });

  it('accepts both prefixed and bare openxiv ids', async () => {
    const input = await makeBlankPdf(1);
    const a = await stampLeftSidebar(input, {
      openxivId: 'openxiv:math.AG.2026.00001',
      version: 1,
      primaryCategory: 'math.AG',
      postedAt: '2026-05-18',
    });
    const b = await stampLeftSidebar(input, {
      openxivId: 'math.AG.2026.00001',
      version: 1,
      primaryCategory: 'math.AG',
      postedAt: '2026-05-18',
    });
    // Both buffers are similar in size; the openxiv: prefix is added
    // when missing, so the stamps end up rendering the same text.
    expect(Math.abs(a.buffer.length - b.buffer.length)).toBeLessThan(50);
  });

  it('detectExistingSidebar is a stable no-op (returns false)', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage();
    expect(await detectExistingSidebar(page)).toBe(false);
  });

  it('handles a zero-page PDF without throwing', async () => {
    const empty = await PDFDocument.create();
    const bytes = Buffer.from(await empty.save());
    // pdf-lib may or may not synthesise a single placeholder page on
    // save — we don't care about that detail; the load-bearing
    // contract is "the function doesn't throw on the degenerate input".
    await expect(
      stampLeftSidebar(bytes, {
        openxivId: 'cs.AI.2026.00001',
        version: 1,
        primaryCategory: 'cs.AI',
        postedAt: '2026-05-18',
      }),
    ).resolves.toBeDefined();
  });
});

describe('mergeCoverAndBody', () => {
  it('places the cover first and preserves body page count', async () => {
    const cover = await makeBlankPdf(1);
    const body = await makeBlankPdf(5);
    const merged = await mergeCoverAndBody(cover, body);
    const parsed = await PDFDocument.load(merged);
    expect(parsed.getPageCount()).toBe(6);
  });

  it('preserves body metadata (title) on the merged document', async () => {
    const cover = await makeBlankPdf(1);
    const body = await PDFDocument.create();
    body.setTitle('Body Title');
    body.addPage();
    const bodyBytes = Buffer.from(await body.save());
    const merged = await mergeCoverAndBody(cover, bodyBytes);
    const parsed = await PDFDocument.load(merged);
    expect(parsed.getTitle()).toBe('Body Title');
  });

  it('unions keywords from cover and body (both surfaces preserved)', async () => {
    const coverDoc = await PDFDocument.create();
    coverDoc.setKeywords(['cs.AI', 'issn:3120-9556']);
    coverDoc.addPage();
    const cover = Buffer.from(await coverDoc.save());
    const bodyDoc = await PDFDocument.create();
    bodyDoc.setKeywords(['neural-networks', 'transformers']);
    bodyDoc.addPage();
    const body = Buffer.from(await bodyDoc.save());
    const merged = await mergeCoverAndBody(cover, body);
    const parsed = await PDFDocument.load(merged);
    const keywords = parsed.getKeywords() ?? '';
    expect(keywords).toContain('cs.AI');
    expect(keywords).toContain('issn:3120-9556');
    expect(keywords).toContain('neural-networks');
    expect(keywords).toContain('transformers');
  });

  it('injects openxivId into keywords and survives round-trip extraction', async () => {
    const coverDoc = await PDFDocument.create();
    coverDoc.setKeywords(['cs.AI']);
    coverDoc.addPage();
    const cover = Buffer.from(await coverDoc.save());
    const bodyDoc = await PDFDocument.create();
    bodyDoc.setTitle('Body Title');
    bodyDoc.addPage();
    const body = Buffer.from(await bodyDoc.save());
    const merged = await mergeCoverAndBody(cover, body, {
      openxivId: 'openxiv:cs.AI.2026.00001',
    });
    const id = await extractOpenxivIdFromPdf(merged);
    expect(id).toBe('openxiv:cs.AI.2026.00001');
  });

  it('normalises a bare openxiv id to the prefixed form before embedding', async () => {
    const cover = await makeBlankPdf(1);
    const body = await makeBlankPdf(1);
    const merged = await mergeCoverAndBody(cover, body, {
      openxivId: 'cs.AI.2026.00001',
    });
    const id = await extractOpenxivIdFromPdf(merged);
    expect(id).toBe('openxiv:cs.AI.2026.00001');
  });

  it('does not embed openxivId when meta is omitted (back-compat)', async () => {
    const cover = await makeBlankPdf(1);
    const body = await makeBlankPdf(1);
    const merged = await mergeCoverAndBody(cover, body);
    const id = await extractOpenxivIdFromPdf(merged);
    expect(id).toBeNull();
  });

  it('cover Subject ("OpenXiv preprint — id") wins over body Subject', async () => {
    const coverDoc = await PDFDocument.create();
    coverDoc.setSubject('OpenXiv preprint — openxiv:cs.AI.2026.00001');
    coverDoc.addPage();
    const cover = Buffer.from(await coverDoc.save());
    const bodyDoc = await PDFDocument.create();
    bodyDoc.setSubject('LaTeX default subject');
    bodyDoc.addPage();
    const body = Buffer.from(await bodyDoc.save());
    const merged = await mergeCoverAndBody(cover, body);
    const parsed = await PDFDocument.load(merged);
    expect(parsed.getSubject()).toBe('OpenXiv preprint — openxiv:cs.AI.2026.00001');
  });

  it('falls back to body Subject only when cover supplies none', async () => {
    const cover = await makeBlankPdf(1);
    const bodyDoc = await PDFDocument.create();
    bodyDoc.setSubject('Body fallback');
    bodyDoc.addPage();
    const body = Buffer.from(await bodyDoc.save());
    const merged = await mergeCoverAndBody(cover, body);
    const parsed = await PDFDocument.load(merged);
    expect(parsed.getSubject()).toBe('Body fallback');
  });
});

describe('extractOpenxivIdFromPdf (round-trip detector)', () => {
  it('returns null when the PDF has no keywords at all', async () => {
    const bytes = await makeBlankPdf(1);
    expect(await extractOpenxivIdFromPdf(bytes)).toBeNull();
  });

  it('returns null when keywords are set but no openxiv: marker present', async () => {
    const pdf = await PDFDocument.create();
    pdf.setKeywords(['cs.AI', 'transformers']);
    pdf.addPage();
    const bytes = Buffer.from(await pdf.save());
    expect(await extractOpenxivIdFromPdf(bytes)).toBeNull();
  });

  it('returns the first openxiv: keyword when multiple are present', async () => {
    const pdf = await PDFDocument.create();
    pdf.setKeywords(['cs.AI', 'openxiv:cs.AI.2026.00001', 'issn:3120-9556']);
    pdf.addPage();
    const bytes = Buffer.from(await pdf.save());
    expect(await extractOpenxivIdFromPdf(bytes)).toBe('openxiv:cs.AI.2026.00001');
  });
});

void StandardFonts;
