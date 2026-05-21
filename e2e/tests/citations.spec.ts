import { expect, test, type APIRequestContext } from '@playwright/test';
import { parse as parseBibtex } from '@retorquere/bibtex-parser';
import { Cite } from '@citation-js/core';
import '@citation-js/plugin-ris';
import { requireProductionOpenXivBaseUrl } from './live-env.js';

async function findPublishedPaper(request: APIRequestContext): Promise<string | null> {
  const override = process.env['E2E_SAMPLE_ABS_ID'];
  if (override) return override;
  const res = await request.get('/api-proxy/papers?limit=100');
  if (!res.ok()) return null;
  const data = (await res.json()) as { items: Array<{ openxivUrlId: string | null; status: string; id: string }> };
  return data.items.find((x) => x.status === 'published' && x.openxivUrlId)?.openxivUrlId ?? null;
}

const formats = ['bibtex', 'ris', 'endnote', 'apa', 'mla', 'chicago', 'ieee'] as const;
const RUN_LIVE = process.env['E2E_CITATION_LIVE'] === '1';

test.describe('Cite this paper', () => {
  test('API returns every citation format and parser-valid BibTeX/RIS', async ({ request }) => {
    if (RUN_LIVE) requireProductionOpenXivBaseUrl();
    const sampleId = await findPublishedPaper(request);
    if (RUN_LIVE) expect(sampleId, 'live citation e2e requires a published paper or E2E_SAMPLE_ABS_ID').toBeTruthy();
    test.skip(!sampleId, 'no published paper available for citation e2e');

    for (const format of formats) {
      const res = await request.get(`/api-proxy/papers/${encodeURIComponent(sampleId!)}/citation?format=${format}`);
      const text = await res.text();
      expect(res.ok(), `${format} endpoint ${res.status()}: ${text.slice(0, 500)}`).toBe(true);
      expect(text.length, `${format} citation text`).toBeGreaterThan(20);
      if (format === 'bibtex') {
        const parsed = parseBibtex(text);
        expect(parsed.errors, 'BibTeX parser errors').toHaveLength(0);
        expect(parsed.entries, 'BibTeX entries').toHaveLength(1);
      }
      if (format === 'ris') {
        const parsed = new Cite(text);
        expect(parsed.data, 'RIS parser entries').toHaveLength(1);
      }
    }
  });

  test('modal switches formats, copies, and downloads citation files', async ({ page, request, context }) => {
    if (RUN_LIVE) requireProductionOpenXivBaseUrl();
    const sampleId = await findPublishedPaper(request);
    if (RUN_LIVE) expect(sampleId, 'live citation e2e requires a published paper or E2E_SAMPLE_ABS_ID').toBeTruthy();
    test.skip(!sampleId, 'no published paper available for citation e2e');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(`/p/${sampleId}`);
    await page.getByRole('button', { name: 'Cite' }).click();
    await expect(page.getByRole('dialog', { name: 'Cite this paper' })).toBeVisible();

    for (const label of ['BibTeX', 'RIS', 'EndNote', 'APA 7', 'MLA 9', 'Chicago 17', 'IEEE']) {
      await page.getByRole('tab', { name: label }).click();
      await expect(page.locator('[data-cite-output]')).not.toHaveText(/Loading citation/);
      await expect(page.locator('[data-cite-output]')).not.toHaveText(/Citation unavailable/);
    }

    await page.getByRole('tab', { name: 'BibTeX' }).click();
    await page.getByRole('button', { name: 'Copy' }).click();
    await expect(page.locator('[data-cite-status]')).toContainText(/Copied|Select and copy/);
    const [bibDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download' }).click(),
    ]);
    expect(bibDownload.suggestedFilename()).toMatch(/\.bib$/);

    await page.getByRole('tab', { name: 'RIS' }).click();
    const [risDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download' }).click(),
    ]);
    expect(risDownload.suggestedFilename()).toMatch(/\.ris$/);
  });
});
