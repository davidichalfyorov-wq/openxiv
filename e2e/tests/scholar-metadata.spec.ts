import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Scholar metadata regression gate (P1 #5).
 *
 * Google Scholar's crawler is a non-JS HTTP client. If the citation meta tags
 * or the abstract text disappear from the SSR HTML, Scholar silently drops
 * the paper from its index and we have no way to know without re-checking
 * by hand. This test parses the raw SSR HTML response (NOT the post-hydration
 * DOM) and asserts the contract Scholar expects.
 *
 * The test discovers a published paper at runtime — it does NOT depend on a
 * specific seeded id, so the gate keeps working as the corpus changes. If no
 * published papers exist (empty staging cluster), the test is skipped rather
 * than failing — the regression we're guarding against requires the SSR
 * shape to break for an actually-published paper.
 *
 * The test does NOT execute JavaScript. Anything that has to appear in HTML
 * for Scholar must be in the initial response — that matches what Scholar's
 * crawler actually sees.
 */

function pickMetas(html: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(
    `<meta\\s+[^>]*name=["']${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}["'][^>]*content=["']([^"']*)["']`,
    'gi',
  );
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]!);
  return out;
}

function pickFirstMeta(html: string, name: string): string | null {
  return pickMetas(html, name)[0] ?? null;
}

function pickCanonical(html: string): string | null {
  const m = /<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i.exec(html);
  return m ? m[1]! : null;
}

async function findPublishedAbsId(request: APIRequestContext): Promise<string | null> {
  // Prefer an explicit override (lets a CI job pin a known fixture).
  const override = process.env['E2E_SAMPLE_ABS_ID'];
  if (override) return override;
  const res = await request.get('/api-proxy/papers?limit=100');
  if (!res.ok()) return null;
  const data = (await res.json()) as { items: Array<{ openxivUrlId: string | null; status: string; id: string }> };
  // A valid Scholar-metadata test requires a paper with at least one author
  // attached. Bulk-seeded fixtures may have bare paper rows with no authors;
  // we skip those and find one with metadata. We probe up to 50 candidates
  // before giving up — that's the longest reasonable walk for a real corpus.
  // Walk all published candidates until we find one with at least one
  // author. A real corpus may have many bare bulk-seeded rows interleaved
  // with full ones; we don't want a partial seed to silently skip the test.
  const candidates = data.items.filter((x) => x.status === 'published' && x.openxivUrlId);
  for (const p of candidates) {
    const detailRes = await request.get(`/api-proxy/papers/${encodeURIComponent(p.openxivUrlId!)}`);
    if (!detailRes.ok()) continue;
    const detail = (await detailRes.json()) as { authors: unknown[] };
    if (Array.isArray(detail.authors) && detail.authors.length > 0) {
      return p.openxivUrlId!;
    }
  }
  return null;
}

test.describe('Scholar metadata on /p/{id}', () => {
  test('SSR HTML carries every required citation_* tag, canonical, and visible abstract', async ({ request }) => {
    const sampleId = await findPublishedAbsId(request);
    test.skip(!sampleId, 'no published paper with an openxiv id is available — nothing to assert on');
    const res = await request.get(`/p/${sampleId}`);
    expect(res.status(), 'paper page must serve 200 — bad fixture or web server down').toBe(200);
    const html = await res.text();

    // The page should not be a 404 page. Catching the obvious-wrong cases first
    // gives a much friendlier failure than missing meta tags would.
    expect(html, 'abs page rendered a "paper not found" stub').not.toMatch(/Paper not found/);

    // 1. Core citation_* meta tags.
    expect(pickFirstMeta(html, 'citation_title'), 'citation_title missing').toBeTruthy();
    const authors = pickMetas(html, 'citation_author');
    expect(authors.length, 'at least one citation_author meta required').toBeGreaterThan(0);
    const pubDate = pickFirstMeta(html, 'citation_publication_date');
    // Google Scholar's Highwire convention is YYYY/MM/DD with slashes, not
    // hyphens. Don't ship a paper with hyphens — Scholar will silently
    // refuse to index it.
    expect(pubDate, 'citation_publication_date missing').toMatch(/^\d{4}\/\d{2}\/\d{2}$/);

    // citation_pdf_url presence is best-effort: a paper with a PDF version
    // MUST expose it; without one (test fixtures sometimes lack a real PDF)
    // the tag is simply absent — that's not a Scholar regression.
    const pdfUrl = pickFirstMeta(html, 'citation_pdf_url');
    if (pdfUrl !== null) {
      expect(pdfUrl, 'citation_pdf_url must be an absolute URL when set').toMatch(/^https?:\/\//);
    }

    // 2. Canonical link points at /p and uses the web origin (NOT the API port).
    const canonical = pickCanonical(html);
    expect(canonical, 'canonical link missing').toBeTruthy();
    expect(canonical, 'canonical must point at /p and use the web origin').toMatch(
      new RegExp(`/p/${sampleId!.replace(/\./g, '\\.')}$`),
    );

    // 3. Visible abstract — must be in SSR HTML, not behind a JS island.
    // We look for an <h2> with "Abstract"; loose on whitespace to survive
    // Astro's prerender.
    expect(html, 'Abstract heading missing from SSR HTML').toMatch(/<h2[^>]*>\s*Abstract\s*</);

    // citation_abstract meta — some crawlers prefer it over visible text.
    const citationAbstract = pickFirstMeta(html, 'citation_abstract');
    expect(citationAbstract, 'citation_abstract meta missing').toBeTruthy();
    expect(citationAbstract!.length, 'citation_abstract suspiciously short').toBeGreaterThan(5);

    // 4. Journal title / publisher — Scholar uses these to group by venue.
    expect(pickFirstMeta(html, 'citation_journal_title')).toBe('OpenXiv');
    expect(pickFirstMeta(html, 'citation_publisher')).toBe('OpenXiv');
    expect(pickFirstMeta(html, 'citation_issn')).toBe('3120-9556');
    expect(pickFirstMeta(html, 'citation_language')).toBe('en');
    expect(pickFirstMeta(html, 'citation_technical_report_institution')).toBe('OpenXiv');
    expect(pickFirstMeta(html, 'dc.title'), 'dc.title missing').toBeTruthy();
    expect(pickMetas(html, 'dc.creator').length, 'dc.creator missing').toBeGreaterThan(0);
    expect(pickFirstMeta(html, 'dc.date'), 'dc.date missing').toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(pickFirstMeta(html, 'dc.identifier'), 'dc.identifier missing').toBeTruthy();
    expect(pickMetas(html, 'dc.subject').length, 'dc.subject missing').toBeGreaterThan(0);

    // 5. JSON-LD ScholarlyArticle should still parse and have the same title.
    const jsonLdMatch = /<script\s+type="application\/ld\+json"[^>]*>([^<]+)<\/script>/.exec(html);
    expect(jsonLdMatch, 'JSON-LD block missing').toBeTruthy();
    const ld = JSON.parse(jsonLdMatch![1]!);
    expect(ld['@type'], 'JSON-LD @type must be ScholarlyArticle').toBe('ScholarlyArticle');
    expect(ld.headline, 'JSON-LD headline missing').toBeTruthy();
    expect(ld.headline, 'JSON-LD headline mismatches citation_title').toBe(
      pickFirstMeta(html, 'citation_title'),
    );

    // 6. Saga internals must NOT leak. Anonymous visitors must never see the
    // per-stage booleans that we hide for the submitter/admin view.
    expect(html, 'saga internals leaked to anonymous DOM').not.toMatch(/Submission saga/);
    expect(html, 'raw stage names leaked').not.toMatch(/paperPersisted|stagePaperPersisted/);
  });
});
