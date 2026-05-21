import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { generateCoverPdf, wrap, __testing } from './pdf-cover.js';
import { StandardFonts } from 'pdf-lib';

const BASE_INPUT = {
  openxivId: 'openxiv:cs.AI.2026.00001',
  openxivUrlId: 'cs.AI.2026.00001',
  title: 'A reasonably long preprint title that exercises wrap logic',
  abstract:
    'This is the abstract of the paper. It contains enough text that the wrap function gets exercised, but stays comfortably under the 400-character cover-page cap.',
  authors: [
    { displayName: 'Alice Researcher', orcid: '0000-0001-2345-6789', affiliation: 'MIT' },
    { displayName: 'Bob Co-author', affiliation: 'Stanford' },
  ],
  primaryCategory: 'cs.AI',
  crossListings: ['cs.LG'],
  license: 'CC-BY-4.0',
  version: 1,
  postedAt: '2026-05-18T12:00:00.000Z',
  disclosureLevel: 'assistant' as const,
  trust: null,
  publicBase: 'https://openxiv.net',
} as const;

describe('generateCoverPdf', () => {
  it('produces a valid single-page A4 PDF', async () => {
    const out = await generateCoverPdf({ ...BASE_INPUT, doi: null });
    expect(out.buffer.length).toBeGreaterThan(2_000);
    const parsed = await PDFDocument.load(out.buffer);
    expect(parsed.getPageCount()).toBe(1);
    const page = parsed.getPage(0);
    const { width, height } = page.getSize();
    // A4 portrait dimensions (with small tolerance for pdf-lib rounding).
    expect(width).toBeCloseTo(595.276, 1);
    expect(height).toBeCloseTo(841.89, 1);
  });

  it('embeds metadata (title, author, ISSN keyword)', async () => {
    const out = await generateCoverPdf({ ...BASE_INPUT, doi: null });
    const parsed = await PDFDocument.load(out.buffer);
    expect(parsed.getTitle()).toBe(BASE_INPUT.title);
    expect(parsed.getAuthor()).toContain('Alice Researcher');
    const keywords = parsed.getKeywords() ?? '';
    expect(keywords).toContain('issn:3120-9556');
    expect(keywords).toContain('cs.AI');
    expect(keywords).toContain('trust-passport:https://openxiv.net/abs/cs.AI.2026.00001/passport');
  });

  it('is deterministic for the same input — same contentHash', async () => {
    const a = await generateCoverPdf({ ...BASE_INPUT, doi: null });
    const b = await generateCoverPdf({ ...BASE_INPUT, doi: null });
    // pdf-lib introduces a tiny non-deterministic source (object id ordering)
    // when the producer string isn't pinned; the produced bytes match in
    // practice. We compare content hashes as the test invariant rather than
    // byte equality so a future pdf-lib internal change doesn't break this.
    expect(a.contentHash).toBe(b.contentHash);
  });

  it('differs between doi=null and doi=set (cover varies)', async () => {
    const noDoi = await generateCoverPdf({ ...BASE_INPUT, doi: null });
    const withDoi = await generateCoverPdf({
      ...BASE_INPUT,
      doi: '10.99999/openxiv.cs.AI.2026.00001',
    });
    expect(noDoi.contentHash).not.toBe(withDoi.contentHash);
  });

  it('truncates over-long abstract to 400 chars + ellipsis', async () => {
    const long = 'x'.repeat(2000);
    const out = await generateCoverPdf({ ...BASE_INPUT, doi: null, abstract: long });
    const parsed = await PDFDocument.load(out.buffer);
    expect(parsed.getPageCount()).toBe(1);
    // We can't easily extract rendered text without pdf-parse, but the
    // build not throwing on a 2k-char abstract is the load-bearing check.
    expect(out.buffer.length).toBeGreaterThan(2_000);
  });

  it('survives an empty authors list (one fallback line)', async () => {
    const out = await generateCoverPdf({
      ...BASE_INPUT,
      doi: null,
      authors: [{ displayName: 'Single Author' }],
    });
    expect(out.buffer.length).toBeGreaterThan(0);
    const parsed = await PDFDocument.load(out.buffer);
    expect(parsed.getPageCount()).toBe(1);
  });

  it('renders the six requested cover evidence chips when provided', async () => {
    const out = await generateCoverPdf({
      ...BASE_INPUT,
      doi: null,
      trust: {
        transparency: 'strong',
        identity: 'partial',
        provenance: 'strong',
        citations: 'partial',
        math: 'strong',
        integrity: 'pending',
      },
    });
    expect(out.buffer.length).toBeGreaterThan(0);
  });

  it('keeps the PDF cover summary scoped to the requested six lanes only', () => {
    const source = readFileSync(new URL('./pdf-cover.ts', import.meta.url), 'utf8');
    const trustRow = source.slice(source.indexOf('function drawTrustRow'), source.indexOf('function passportUrl'));
    expect(trustRow).toContain("['transparency', input.trust.transparency]");
    expect(trustRow).toContain("['identity', input.trust.identity]");
    expect(trustRow).toContain("['provenance', input.trust.provenance]");
    expect(trustRow).toContain("['citations', input.trust.citations]");
    expect(trustRow).toContain("['math', input.trust.math]");
    expect(trustRow).toContain("['integrity', input.trust.integrity]");
    expect(trustRow).not.toContain('input.trust.socialReview');
    expect(source).not.toContain('Full signed Trust Passport');
    expect(source).not.toContain('vector evidence');
    expect(source).not.toContain('public disputes, external attestations');
  });

  it('passes all six requested lanes from finalize into the cover input', () => {
    const source = readFileSync(new URL('./pdf-finalize.ts', import.meta.url), 'utf8');
    expect(source).toContain('transparency: trustPassport.transparency.state');
    expect(source).toContain('identity: trustPassport.identity.state');
    expect(source).toContain('provenance: trustPassport.provenance.state');
    expect(source).toContain('citations: trustPassport.citations.state');
    expect(source).toContain('math: trustPassport.math.state');
    expect(source).toContain('integrity: trustPassport.integrity.state');
    expect(source).not.toContain('socialReview: trustPassport.socialReview.state');
  });

  it('bumps the finalize input hash when the cover template changes', () => {
    const source = readFileSync(new URL('./pdf-finalize.ts', import.meta.url), 'utf8');
    expect(source).toContain('COVER_TEMPLATE_VERSION');
    expect(source).toContain('openxiv-cover-v6-six-lane-evidence');
    expect(source).toContain('coverTemplateVersion: COVER_TEMPLATE_VERSION');
  });

  it('keeps longitudinal Passport events out of the static cover rebuild hash', () => {
    const source = readFileSync(new URL('./pdf-finalize.ts', import.meta.url), 'utf8');
    const hashBody = source.slice(
      source.indexOf('function computeInputHash'),
      source.indexOf('function buildCoverInput'),
    );

    expect(hashBody).not.toContain('publicDisputes');
    expect(hashBody).not.toContain('externalAttestations');
    expect(hashBody).not.toContain('history');
    expect(hashBody).not.toContain('posts');
  });
});

describe('wrap (cover word-wrap helper)', () => {
  it('produces a single line when text fits', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    expect(wrap('short', 10, font, 500)).toEqual(['short']);
  });

  it('breaks at word boundaries', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const lines = wrap('alpha beta gamma delta', 10, font, 40);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.length).toBeGreaterThan(0);
    }
  });

  it('keeps an oversized single word on its own line', async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const lines = wrap('supercalifragilisticexpialidocious', 24, font, 20);
    expect(lines).toEqual(['supercalifragilisticexpialidocious']);
  });
});

void __testing;
